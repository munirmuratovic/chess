import { applyMove, updateCastling, updateEnPassant } from "./board";
import { materialEval, PIECE_VALUE } from "./eval";
import { allLegalMoves, isInCheck } from "./moves";
import type { Board, Castling, Color, Move } from "./types";

// positive = good for black (maximizer)
function evaluate(board: Board): number {
  return -materialEval(board);
}

// ─── MVV-LVA capture score ────────────────────────────────────────────────────

function captureScore(board: Board, m: Move): number {
  const victim = board[m.to[0]][m.to[1]];
  const attacker = board[m.from[0]][m.from[1]];
  return victim
    ? 10 * PIECE_VALUE[victim.type] - PIECE_VALUE[attacker!.type]
    : 0;
}

// ─── Killer moves (2 per ply, encoded as 12-bit int in Uint16Array) ───────────
//   encoding: (from_r<<9)|(from_c<<6)|(to_r<<3)|to_c  — max 4095, 0 = empty

const MAX_PLY = 64;
const killers = new Uint16Array(MAX_PLY * 2);

function encMove(m: Move): number {
  return (m.from[0] << 9) | (m.from[1] << 6) | (m.to[0] << 3) | m.to[1];
}

function isKiller(m: Move, ply: number): boolean {
  const e = encMove(m),
    b = ply * 2;
  return killers[b] === e || killers[b + 1] === e;
}

function storeKiller(m: Move, ply: number): void {
  const e = encMove(m),
    b = ply * 2;
  if (killers[b] === e) return;
  killers[b + 1] = killers[b];
  killers[b] = e;
}

// ─── History heuristic ────────────────────────────────────────────────────────

const histTable = new Int32Array(64 * 64); // [from_sq * 64 + to_sq]

function histIdx(m: Move): number {
  return (m.from[0] * 8 + m.from[1]) * 64 + (m.to[0] * 8 + m.to[1]);
}

// ─── Move scoring: captures > killers > history ───────────────────────────────

function moveScore(board: Board, m: Move, ply: number): number {
  if (board[m.to[0]][m.to[1]]) return 20_000 + captureScore(board, m);
  if (isKiller(m, ply)) return 10_000;
  return histTable[histIdx(m)];
}

function sortMoves(board: Board, moves: Move[], ply: number): void {
  moves.sort((a, b) => moveScore(board, b, ply) - moveScore(board, a, ply));
}

// ─── Zobrist hashing ─────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

const _rng = mulberry32(0xdeadbeef);
const _CT: Record<string, number> = {
  wK: 0,
  wQ: 1,
  wR: 2,
  wB: 3,
  wN: 4,
  wP: 5,
  bK: 6,
  bQ: 7,
  bR: 8,
  bB: 9,
  bN: 10,
  bP: 11,
};
const _ZOB = Array.from({ length: 12 }, () =>
  Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => _rng())),
);
const _ZOB_TURN = _rng();

function boardHash(board: Board, maximizing: boolean): number {
  let h = maximizing ? _ZOB_TURN : 0;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p) h = (h ^ _ZOB[_CT[p.color + p.type]][r][c]) >>> 0;
    }
  return h;
}

// ─── Transposition table — fixed-size parallel typed arrays ──────────────────
// Replaces Map<number, TTEntry>: ~10× less memory, no GC, O(1) with bitmask.
// flag: 0=exact  1=lower bound (failed high)  2=upper bound (failed low)

const TT_SIZE = 1 << 18; // 262 144 slots ≈ 2.5 MB total
const TT_MASK = TT_SIZE - 1;
const tt_key = new Uint32Array(TT_SIZE); // 0 means empty
const tt_depth = new Int8Array(TT_SIZE);
const tt_score = new Int32Array(TT_SIZE); // score × 1000 stored as int
const tt_flag = new Uint8Array(TT_SIZE);

function ttClear(): void {
  tt_key.fill(0);
}

function ttProbe(
  hash: number,
  depth: number,
  alpha: number,
  beta: number,
): number | null {
  if (!hash) return null;
  const i = hash & TT_MASK;
  if (tt_key[i] !== hash) return null;
  if (tt_depth[i] < depth) return null;
  const s = tt_score[i] / 1000;
  if (tt_flag[i] === 0) return s;
  if (tt_flag[i] === 1 && s >= beta) return s;
  if (tt_flag[i] === 2 && s <= alpha) return s;
  return null;
}

function ttStore(
  hash: number,
  depth: number,
  score: number,
  flag: 0 | 1 | 2,
): void {
  if (!hash) return;
  const i = hash & TT_MASK;
  // Depth-preferred replacement: keep deeper entry unless it's a different position
  if (tt_key[i] !== 0 && tt_key[i] !== hash && tt_depth[i] > depth) return;
  tt_key[i] = hash;
  tt_depth[i] = depth;
  tt_score[i] = Math.round(score * 1000);
  tt_flag[i] = flag;
}

// ─── Quiescence search ────────────────────────────────────────────────────────
// Delta pruning: if standPat + queen's value still can't reach alpha, skip.

const Q_DELTA = 10; // queen value in our pawn-unit scale

function quiesce(
  board: Board,
  castling: Castling,
  enPassant: [number, number] | null,
  alpha: number,
  beta: number,
  maximizing: boolean,
): number {
  const pat = evaluate(board);

  if (maximizing) {
    if (pat >= beta) return pat;
    if (pat + Q_DELTA < alpha) return pat; // delta prune
    alpha = Math.max(alpha, pat);
  } else {
    if (pat <= alpha) return pat;
    if (pat - Q_DELTA > beta) return pat; // delta prune
    beta = Math.min(beta, pat);
  }

  const color: Color = maximizing ? "b" : "w";
  const caps = allLegalMoves(board, color, castling, enPassant)
    .filter((m) => board[m.to[0]][m.to[1]] !== null)
    .sort((a, b) => captureScore(board, b) - captureScore(board, a));

  let best = pat;
  for (const m of caps) {
    const nb = applyMove(board, m.from, m.to);
    const nc = updateCastling(castling, m.from, m.to);
    const ne = updateEnPassant(board, m.from, m.to);
    const score = quiesce(nb, nc, ne, alpha, beta, !maximizing);
    if (maximizing) {
      if (score > best) best = score;
      alpha = Math.max(alpha, best);
    } else {
      if (score < best) best = score;
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) break;
  }
  return best;
}

// ─── Minimax: α-β + TT + null move + killers + history + LMR ─────────────────

function minimax(
  board: Board,
  castling: Castling,
  enPassant: [number, number] | null,
  depth: number,
  alpha: number,
  beta: number,
  maximizing: boolean,
  ply: number,
  allowNull: boolean,
): number {
  if (depth === 0)
    return quiesce(board, castling, enPassant, alpha, beta, maximizing);

  const hash = boardHash(board, maximizing);
  const cached = ttProbe(hash, depth, alpha, beta);
  if (cached !== null) return cached;

  const color: Color = maximizing ? "b" : "w";
  const inCheck = isInCheck(board, color);

  // Null move pruning ────────────────────────────────────────────────────────
  // If we pass our turn and the opponent still can't beat beta, prune.
  // Skip when in check (passing in check is illegal) or at shallow depth.
  if (allowNull && !inCheck && depth >= 3) {
    const R = depth >= 6 ? 3 : 2;
    const nScore = minimax(
      board,
      castling,
      enPassant,
      depth - 1 - R,
      alpha,
      beta,
      !maximizing,
      ply + 1,
      false,
    );
    if (maximizing ? nScore >= beta : nScore <= alpha)
      return maximizing ? beta : alpha; // fail-hard cutoff
  }

  const moves = allLegalMoves(board, color, castling, enPassant);
  if (moves.length === 0) return inCheck ? (maximizing ? -9999 : 9999) : 0;

  sortMoves(board, moves, ply);

  const origAlpha = alpha,
    origBeta = beta;
  let best = maximizing ? -Infinity : Infinity;

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const nb = applyMove(board, m.from, m.to);
    const nc = updateCastling(castling, m.from, m.to);
    const ne = updateEnPassant(board, m.from, m.to);
    const isCapture = board[m.to[0]][m.to[1]] !== null;

    // Late Move Reduction ─────────────────────────────────────────────────────
    // Reduce depth for quiet, non-killer late moves; re-search full if promising.
    const doLMR =
      !inCheck && i >= 4 && depth >= 3 && !isCapture && !isKiller(m, ply);

    let score = minimax(
      nb,
      nc,
      ne,
      doLMR ? depth - 2 : depth - 1,
      alpha,
      beta,
      !maximizing,
      ply + 1,
      true,
    );

    if (doLMR && (maximizing ? score > alpha : score < beta))
      score = minimax(
        nb,
        nc,
        ne,
        depth - 1,
        alpha,
        beta,
        !maximizing,
        ply + 1,
        true,
      );

    if (maximizing) {
      if (score > best) best = score;
      if (best > alpha) alpha = best;
    } else {
      if (score < best) best = score;
      if (best < beta) beta = best;
    }

    if (beta <= alpha) {
      // Beta cutoff: reward this move in killers + history
      if (!isCapture) {
        storeKiller(m, ply);
        const hi = histIdx(m);
        histTable[hi] = Math.min(histTable[hi] + depth * depth, 16_000);
      }
      break;
    }
  }

  ttStore(hash, depth, best, best <= origAlpha ? 2 : best >= origBeta ? 1 : 0);
  return best;
}

// ─── Root search: iterative deepening + aspiration windows ───────────────────

export function getAiMove(
  board: Board,
  color: Color,
  castling: Castling,
  depth = 3,
  enPassant: [number, number] | null = null,
): Move | null {
  ttClear();
  killers.fill(0);
  histTable.fill(0);

  let moves = allLegalMoves(board, color, castling, enPassant);
  if (!moves.length) return null;

  moves.sort((a, b) => captureScore(board, b) - captureScore(board, a));

  const maximizing = color === "b";
  let bestMove = moves[0];
  let prevScore = 0;

  for (let d = 1; d <= depth; d++) {
    // Aspiration window: start with ±0.5 pawn around last iteration's score.
    // Widen to full window on failure (rare at shallow depth, effective at deeper).
    let aspAlpha = d >= 3 ? prevScore - 0.5 : -Infinity;
    let aspBeta = d >= 3 ? prevScore + 0.5 : Infinity;

    let dBest = maximizing ? -Infinity : Infinity;
    let dBestMove = moves[0];
    const scores = new Array<number>(moves.length);

    for (;;) {
      // retry loop on aspiration failure
      dBest = maximizing ? -Infinity : Infinity;

      for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        const nb = applyMove(board, m.from, m.to);
        const nc = updateCastling(castling, m.from, m.to);
        const ne = updateEnPassant(board, m.from, m.to);
        const score = minimax(
          nb,
          nc,
          ne,
          d - 1,
          aspAlpha,
          aspBeta,
          !maximizing,
          1,
          true,
        );
        scores[i] = score;
        if (maximizing ? score > dBest : score < dBest) {
          dBest = score;
          dBestMove = m;
        }
      }

      if (dBest <= aspAlpha) {
        aspAlpha = -Infinity;
        continue;
      } // fail low → widen
      if (dBest >= aspBeta) {
        aspBeta = Infinity;
        continue;
      } // fail high → widen
      break;
    }

    prevScore = dBest;
    bestMove = dBestMove;

    // Re-sort root moves for next depth using this iteration's scores
    const indexed = moves.map((m, i) => ({ m, s: scores[i] }));
    indexed.sort((a, b) => (maximizing ? b.s - a.s : a.s - b.s));
    moves = indexed.map((x) => x.m);
  }

  return bestMove;
}
