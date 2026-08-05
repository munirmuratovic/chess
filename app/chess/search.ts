import { applyMove, updateCastling, updateEnPassant } from "./board";
import { looksLikeSacrifice } from "./annotate";
import { materialEval, pieceScore, PIECE_VALUE } from "./eval";
import { allLegalMoves, isInCheck } from "./moves";
import type { Board, Castling, Color, Move, PieceType } from "./types";

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

function moveScore(board: Board, m: Move, ply: number, ttMoveCode: number): number {
  const code = encMove(m);
  if (code === ttMoveCode) return 30_000;
  if (board[m.to[0]][m.to[1]]) return 20_000 + captureScore(board, m);
  if (isKiller(m, ply)) return 10_000;
  return histTable[histIdx(m)];
}

function sortMoves(board: Board, moves: Move[], ply: number, ttMoveCode: number): void {
  moves.sort((a, b) => moveScore(board, b, ply, ttMoveCode) - moveScore(board, a, ply, ttMoveCode));
}

// ─── Zobrist hashing ─────────────────────────────────────────────────────────
// Hash and material/PST score are threaded through the recursion and updated
// incrementally (O(1) per move) instead of being recomputed from the full
// 64-square board at every node. The old per-node recompute did a string
// concat + Record lookup (`_ZOB[p.color + p.type][r][c]`) 64 times PER NODE —
// by far the hottest cost in the tree, since it ran on every interior node,
// not just leaves. Incremental updates also fold castling rights + en
// passant square into the hash, which the old boardHash() silently omitted
// (a latent TT-collision bug: two positions with identical pieces/turn but
// different castling/en-passant rights hashed identically).

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

// piece code: 0-5 = white K,Q,R,B,N,P; 6-11 = black K,Q,R,B,N,P
const TYPE_IDX: Record<PieceType, number> = { K: 0, Q: 1, R: 2, B: 3, N: 4, P: 5 };
function pieceCode(color: Color, type: PieceType): number {
  return (color === "b" ? 6 : 0) + TYPE_IDX[type];
}

const zobPiece = new Uint32Array(12 * 64);
for (let i = 0; i < zobPiece.length; i++) zobPiece[i] = _rng();
const zobCastle = [_rng(), _rng(), _rng(), _rng()]; // wK, wQ, bK, bQ
const zobEP = new Uint32Array(64);
for (let i = 0; i < zobEP.length; i++) zobEP[i] = _rng();
const zobTurn = _rng();

function pieceHash(color: Color, type: PieceType, r: number, c: number): number {
  return zobPiece[pieceCode(color, type) * 64 + (r * 8 + c)];
}

function fullHash(
  board: Board,
  castling: Castling,
  enPassant: [number, number] | null,
  blackToMove: boolean,
): number {
  let h = blackToMove ? zobTurn : 0;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p) h ^= pieceHash(p.color, p.type, r, c);
    }
  if (castling.wK) h ^= zobCastle[0];
  if (castling.wQ) h ^= zobCastle[1];
  if (castling.bK) h ^= zobCastle[2];
  if (castling.bQ) h ^= zobCastle[3];
  if (enPassant) h ^= zobEP[enPassant[0] * 8 + enPassant[1]];
  return h >>> 0;
}

// Contribution of a single piece to evaluate()'s black-positive scale.
function contrib(type: PieceType, color: Color, r: number, c: number): number {
  return pieceScore(type, r, c, color) * (color === "w" ? -1 : 1);
}

// Hash/score delta for applying (from → to) on `board` (pre-move), given the
// already-computed post-move castling/en-passant rights. Must mirror
// applyMove()/updateCastling()/updateEnPassant() in board.ts exactly.
function hashAfterMove(
  hash: number,
  board: Board,
  castling: Castling,
  enPassant: [number, number] | null,
  nc: Castling,
  ne: [number, number] | null,
  from: [number, number],
  to: [number, number],
): number {
  const [fr, fc] = from,
    [tr, tc] = to;
  const moving = board[fr][fc]!;
  const target = board[tr][tc];
  let h = hash ^ zobTurn;

  h ^= pieceHash(moving.color, moving.type, fr, fc);
  if (target) h ^= pieceHash(target.color, target.type, tr, tc);

  const isEnPassantCap = moving.type === "P" && fc !== tc && target === null;
  if (isEnPassantCap) {
    const capturedColor: Color = moving.color === "w" ? "b" : "w";
    h ^= pieceHash(capturedColor, "P", fr, tc);
  }

  const isPromotion = moving.type === "P" && (tr === 0 || tr === 7);
  h ^= pieceHash(moving.color, isPromotion ? "Q" : moving.type, tr, tc);

  if (moving.type === "K" && Math.abs(tc - fc) === 2) {
    const rookFromC = tc === 6 ? 7 : 0;
    const rookToC = tc === 6 ? 5 : 3;
    h ^= pieceHash(moving.color, "R", tr, rookFromC);
    h ^= pieceHash(moving.color, "R", tr, rookToC);
  }

  if (castling.wK && !nc.wK) h ^= zobCastle[0];
  if (castling.wQ && !nc.wQ) h ^= zobCastle[1];
  if (castling.bK && !nc.bK) h ^= zobCastle[2];
  if (castling.bQ && !nc.bQ) h ^= zobCastle[3];

  if (enPassant) h ^= zobEP[enPassant[0] * 8 + enPassant[1]];
  if (ne) h ^= zobEP[ne[0] * 8 + ne[1]];

  return h >>> 0;
}

function evalAfterMove(
  score: number,
  board: Board,
  from: [number, number],
  to: [number, number],
): number {
  const [fr, fc] = from,
    [tr, tc] = to;
  const moving = board[fr][fc]!;
  const target = board[tr][tc];
  let s = score;

  s -= contrib(moving.type, moving.color, fr, fc);
  if (target) s -= contrib(target.type, target.color, tr, tc);

  const isEnPassantCap = moving.type === "P" && fc !== tc && target === null;
  if (isEnPassantCap) {
    const capturedColor: Color = moving.color === "w" ? "b" : "w";
    s -= contrib("P", capturedColor, fr, tc);
  }

  const isPromotion = moving.type === "P" && (tr === 0 || tr === 7);
  s += contrib(isPromotion ? "Q" : moving.type, moving.color, tr, tc);

  if (moving.type === "K" && Math.abs(tc - fc) === 2) {
    const rookFromC = tc === 6 ? 7 : 0;
    const rookToC = tc === 6 ? 5 : 3;
    s -= contrib("R", moving.color, tr, rookFromC);
    s += contrib("R", moving.color, tr, rookToC);
  }

  return s;
}

interface NextPos {
  board: Board;
  castling: Castling;
  enPassant: [number, number] | null;
  hash: number;
  score: number;
}

// Single point of truth for "apply a move and update all derived state" —
// used by the root loop, minimax, and quiescence alike so hash/score always
// stay in sync with the board.
function makeMove(
  board: Board,
  castling: Castling,
  enPassant: [number, number] | null,
  hash: number,
  score: number,
  from: [number, number],
  to: [number, number],
): NextPos {
  const nb = applyMove(board, from, to);
  const nc = updateCastling(castling, from, to);
  const ne = updateEnPassant(board, from, to);
  const nHash = hashAfterMove(hash, board, castling, enPassant, nc, ne, from, to);
  const nScore = evalAfterMove(score, board, from, to);
  return { board: nb, castling: nc, enPassant: ne, hash: nHash, score: nScore };
}

// ─── Transposition table — fixed-size parallel typed arrays ──────────────────
// Replaces Map<number, TTEntry>: ~10× less memory, no GC, O(1) with bitmask.
// flag: 0=exact  1=lower bound (failed high)  2=upper bound (failed low)

const TT_SIZE = 1 << 19; // 524 288 slots ≈ 5 MB total
const TT_MASK = TT_SIZE - 1;
const tt_key = new Uint32Array(TT_SIZE); // 0 means empty
const tt_depth = new Int8Array(TT_SIZE);
const tt_score = new Int32Array(TT_SIZE); // score × 1000 stored as int
const tt_flag = new Uint8Array(TT_SIZE);
const tt_move = new Uint16Array(TT_SIZE); // encoded best move

export function ttClear(): void {
  tt_key.fill(0);
  tt_move.fill(0);
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

function ttProbeMove(hash: number): number {
  if (!hash) return 0;
  const i = hash & TT_MASK;
  return tt_key[i] === hash ? tt_move[i] : 0;
}

function ttStore(
  hash: number,
  depth: number,
  score: number,
  flag: 0 | 1 | 2,
  moveCode: number,
): void {
  if (!hash) return;
  const i = hash & TT_MASK;
  // Depth-preferred replacement: keep deeper entry unless it's a different position
  if (tt_key[i] !== 0 && tt_key[i] !== hash && tt_depth[i] > depth) return;
  tt_key[i] = hash;
  tt_depth[i] = depth;
  tt_score[i] = Math.round(score * 1000);
  tt_flag[i] = flag;
  tt_move[i] = moveCode;
}

// ─── Time budget ──────────────────────────────────────────────────────────────
// Iterative deepening can blow up combinatorially at high depth; without a
// wall-clock cap a "Grandmaster" search can run for minutes and pin a core.
// nodeCount is checked cheaply (every 2048 nodes) so aborting is near-instant
// once the deadline passes, without paying a Date.now()-per-node cost.

let deadline = Infinity;
let aborted = false;
let nodeCount = 0;

function timeUp(): boolean {
  nodeCount++;
  if ((nodeCount & 2047) === 0 && performance.now() > deadline) aborted = true;
  return aborted;
}

// ─── Quiescence search ────────────────────────────────────────────────────────
// Delta pruning: if standPat + queen's value still can't reach alpha, skip.

const Q_DELTA = 10; // queen value in our pawn-unit scale

function quiesce(
  board: Board,
  castling: Castling,
  enPassant: [number, number] | null,
  hash: number,
  score: number,
  alpha: number,
  beta: number,
  maximizing: boolean,
): number {
  if (timeUp()) return score;
  const pat = score;

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
    const next = makeMove(board, castling, enPassant, hash, score, m.from, m.to);
    const s = quiesce(
      next.board,
      next.castling,
      next.enPassant,
      next.hash,
      next.score,
      alpha,
      beta,
      !maximizing,
    );
    if (maximizing) {
      if (s > best) best = s;
      alpha = Math.max(alpha, best);
    } else {
      if (s < best) best = s;
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
  hash: number,
  score: number,
  depth: number,
  alpha: number,
  beta: number,
  maximizing: boolean,
  ply: number,
  allowNull: boolean,
): number {
  if (timeUp()) return score;
  if (depth === 0)
    return quiesce(board, castling, enPassant, hash, score, alpha, beta, maximizing);

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
      hash ^ zobTurn,
      score,
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

  const ttMoveCode = ttProbeMove(hash);
  sortMoves(board, moves, ply, ttMoveCode);

  const origAlpha = alpha,
    origBeta = beta;
  let best = maximizing ? -Infinity : Infinity;
  let bestMove: Move | null = null;

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const next = makeMove(board, castling, enPassant, hash, score, m.from, m.to);
    const isCapture = board[m.to[0]][m.to[1]] !== null;

    // Late Move Reduction ─────────────────────────────────────────────────────
    // Reduce depth for quiet, non-killer late moves; re-search full if promising.
    const doLMR =
      !inCheck && i >= 4 && depth >= 3 && !isCapture && !isKiller(m, ply);

    let s = minimax(
      next.board,
      next.castling,
      next.enPassant,
      next.hash,
      next.score,
      doLMR ? depth - 2 : depth - 1,
      alpha,
      beta,
      !maximizing,
      ply + 1,
      true,
    );

    if (doLMR && (maximizing ? s > alpha : s < beta))
      s = minimax(
        next.board,
        next.castling,
        next.enPassant,
        next.hash,
        next.score,
        depth - 1,
        alpha,
        beta,
        !maximizing,
        ply + 1,
        true,
      );

    if (maximizing) {
      if (s > best) {
        best = s;
        bestMove = m;
      }
      if (best > alpha) alpha = best;
    } else {
      if (s < best) {
        best = s;
        bestMove = m;
      }
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

  const bestMoveCode = bestMove ? encMove(bestMove) : 0;
  ttStore(hash, depth, best, best <= origAlpha ? 2 : best >= origBeta ? 1 : 0, bestMoveCode);
  return best;
}

// ─── Root search: iterative deepening + aspiration windows ───────────────────

export interface AiMoveScore {
  from: [number, number];
  to: [number, number];
  // White-positive pawn units. Only the top move's score is exact — other
  // root moves may be alpha/beta bounds (from the aspiration window), so
  // treat these as a rough signal (e.g. "is there a big gap to the 2nd best
  // move"), not as precise per-move evaluations.
  score: number;
}

export interface AiResult {
  move: Move | null;
  // Search evaluation of the resulting position, white-positive pawn units —
  // same scale/sign as materialEval, but reflects the actual search (tactics
  // included) rather than a snapshot of material only.
  score: number;
  // Every root move considered at the last fully-searched depth, see AiMoveScore's caveat.
  moveScores: AiMoveScore[];
}

export function getAiMove(
  board: Board,
  color: Color,
  castling: Castling,
  depth = 3,
  enPassant: [number, number] | null = null,
  timeLimitMs = Infinity,
): AiResult {
  killers.fill(0);
  histTable.fill(0);
  deadline = performance.now() + timeLimitMs;
  aborted = false;
  nodeCount = 0;

  let moves = allLegalMoves(board, color, castling, enPassant);
  if (!moves.length) {
    // No legal moves: checkmate favors whoever isn't stuck, stalemate is flat.
    if (!isInCheck(board, color)) return { move: null, score: 0, moveScores: [] };
    return { move: null, score: color === "b" ? 9999 : -9999, moveScores: [] };
  }

  moves.sort((a, b) => captureScore(board, b) - captureScore(board, a));

  const maximizing = color === "b";
  const rootHash = fullHash(board, castling, enPassant, maximizing);
  const rootScore = evaluate(board);
  let bestMove = moves[0];
  let prevScore = 0;
  let lastIterMoves: Move[] = moves;
  let lastIterScores: number[] = new Array(moves.length).fill(0);

  for (let d = 1; d <= depth; d++) {
    if (aborted) break; // out of time — keep the last fully-searched depth's move

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
        const next = makeMove(board, castling, enPassant, rootHash, rootScore, m.from, m.to);
        const score = minimax(
          next.board,
          next.castling,
          next.enPassant,
          next.hash,
          next.score,
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

    if (aborted) break; // this iteration timed out mid-search — discard its results

    prevScore = dBest;
    bestMove = dBestMove;
    lastIterMoves = moves;
    lastIterScores = scores;

    ttStore(rootHash, d, prevScore, 0, encMove(bestMove));

    // Re-sort root moves for next depth using this iteration's scores
    const indexed = moves.map((m, i) => ({ m, s: scores[i] }));
    indexed.sort((a, b) => (maximizing ? b.s - a.s : a.s - b.s));
    moves = indexed.map((x) => x.m);
  }

  // evaluate()/minimax operate on a black-positive scale; flip to white-positive.
  const moveScores: AiMoveScore[] = lastIterMoves.map((m, i) => ({
    from: m.from,
    to: m.to,
    score: -lastIterScores[i],
  }));
  return { move: bestMove, score: -prevScore, moveScores };
}

// ─── Single-move evaluation ───────────────────────────────────────────────────
// Exact evaluation (full window, not aspiration-bounded) of one specific
// move, used to score a move that wasn't the engine's own top pick (e.g. a
// human's move) for annotation purposes — getAiMove()'s per-root-move scores
// are too imprecise for that (see AiMoveScore).

export function evaluateMove(
  board: Board,
  color: Color,
  castling: Castling,
  move: Move,
  depth: number,
  enPassant: [number, number] | null = null,
  timeLimitMs = Infinity,
): number {
  killers.fill(0);
  histTable.fill(0);
  deadline = performance.now() + timeLimitMs;
  aborted = false;
  nodeCount = 0;

  const maximizing = color === "b";
  const hash = fullHash(board, castling, enPassant, maximizing);
  const score = evaluate(board);
  const next = makeMove(board, castling, enPassant, hash, score, move.from, move.to);
  const result = minimax(
    next.board,
    next.castling,
    next.enPassant,
    next.hash,
    next.score,
    Math.max(depth - 1, 0),
    -Infinity,
    Infinity,
    !maximizing,
    1,
    true,
  );
  return -result;
}

// ─── Styled move selection ────────────────────────────────────────────────────
// Same search as getAiMove, but among moves that are essentially tied for
// best (within EPS), prefers whichever would earn the flashiest annotate.ts
// badge: brilliant > great > best > good. This never sacrifices strength —
// the candidate pool is always near-best-eval moves — it just breaks ties in
// favor of the most "brilliant"-looking win instead of move-list order.
const STYLE_EPS = 0.05; // pawns; matches moveScores' per-root-move imprecision

export function getStyledAiMove(
  board: Board,
  color: Color,
  castling: Castling,
  depth = 3,
  enPassant: [number, number] | null = null,
  timeLimitMs = Infinity,
): AiResult {
  const result = getAiMove(board, color, castling, depth, enPassant, timeLimitMs);
  if (!result.move || result.moveScores.length <= 1) return result;

  const sign = color === "w" ? 1 : -1;
  const candidates = result.moveScores.map((ms) => ({
    move: { from: ms.from, to: ms.to } as Move,
    evalX: ms.score * sign,
  }));
  const bestEval = Math.max(...candidates.map((c) => c.evalX));
  const nearBest = candidates.filter((c) => c.evalX >= bestEval - STYLE_EPS);
  const secondBestEval = Math.max(
    -Infinity,
    ...candidates.filter((c) => c.evalX < bestEval - STYLE_EPS).map((c) => c.evalX),
  );

  const pick = (pool: typeof candidates) =>
    pool.reduce((a, b) => (b.evalX > a.evalX ? b : a));

  const brilliant = nearBest.filter(
    (c) => c.evalX > 1.5 && looksLikeSacrifice(board, color, c.move),
  );
  if (brilliant.length) return { ...result, move: pick(brilliant).move };

  if (bestEval - secondBestEval > 1.5) {
    return { ...result, move: pick(nearBest).move };
  }

  if (nearBest.some((c) => sameMove(c.move, result.move!))) return result;

  const good = candidates.filter((c) => bestEval - c.evalX <= 0.4);
  if (good.length) return { ...result, move: pick(good).move };

  return result;
}

function sameMove(a: Move, b: Move): boolean {
  return a.from[0] === b.from[0] && a.from[1] === b.from[1] && a.to[0] === b.to[0] && a.to[1] === b.to[1];
}
