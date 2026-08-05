import { applyMove } from './board';
import type { Board, Castling, Color, GameStatus, Move } from './types';

export function isSquareAttacked(board: Board, r: number, c: number, attackerColor: Color): boolean {
  // 1. Knight attacks
  const knightOffsets = [
    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
    [1, -2], [1, 2], [2, -1], [2, 1]
  ];
  for (let i = 0; i < 8; i++) {
    const [dr, dc] = knightOffsets[i];
    const nr = r + dr, nc = c + dc;
    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
      const p = board[nr][nc];
      if (p?.type === 'N' && p.color === attackerColor) return true;
    }
  }

  // 2. Pawn attacks
  const pawnDir = attackerColor === 'w' ? 1 : -1;
  for (const dc of [-1, 1]) {
    const nr = r + pawnDir, nc = c + dc;
    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
      const p = board[nr][nc];
      if (p?.type === 'P' && p.color === attackerColor) return true;
    }
  }

  // 3. Sliding attacks (Rook / Queen) - Orthogonal
  const orthoDirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let i = 0; i < 4; i++) {
    const [dr, dc] = orthoDirs[i];
    let nr = r + dr, nc = c + dc;
    while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
      const p = board[nr][nc];
      if (p) {
        if (p.color === attackerColor && (p.type === 'R' || p.type === 'Q')) return true;
        break;
      }
      nr += dr;
      nc += dc;
    }
  }

  // 4. Sliding attacks (Bishop / Queen) - Diagonal
  const diagDirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let i = 0; i < 4; i++) {
    const [dr, dc] = diagDirs[i];
    let nr = r + dr, nc = c + dc;
    while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
      const p = board[nr][nc];
      if (p) {
        if (p.color === attackerColor && (p.type === 'B' || p.type === 'Q')) return true;
        break;
      }
      nr += dr;
      nc += dc;
    }
  }

  // 5. King attacks
  const kingDirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1]
  ];
  for (let i = 0; i < 8; i++) {
    const [dr, dc] = kingDirs[i];
    const nr = r + dr, nc = c + dc;
    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
      const p = board[nr][nc];
      if (p?.type === 'K' && p.color === attackerColor) return true;
    }
  }

  return false;
}

export function pseudoMoves(board: Board, r: number, c: number, enPassant?: [number, number] | null): [number, number][] {
  const piece = board[r][c];
  if (!piece) return [];
  const { type, color } = piece;
  const opp = color === 'w' ? 'b' : 'w';
  const out: [number, number][] = [];

  if (type === 'R' || type === 'Q') {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let i = 0; i < 4; i++) {
      const [dr, dc] = dirs[i];
      let nr = r + dr, nc = c + dc;
      while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        const p = board[nr][nc];
        if (p) {
          if (p.color === opp) out.push([nr, nc]);
          break;
        }
        out.push([nr, nc]);
        nr += dr;
        nc += dc;
      }
    }
  }
  if (type === 'B' || type === 'Q') {
    const dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (let i = 0; i < 4; i++) {
      const [dr, dc] = dirs[i];
      let nr = r + dr, nc = c + dc;
      while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        const p = board[nr][nc];
        if (p) {
          if (p.color === opp) out.push([nr, nc]);
          break;
        }
        out.push([nr, nc]);
        nr += dr;
        nc += dc;
      }
    }
  }
  if (type === 'K') {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (let i = 0; i < 8; i++) {
      const [dr, dc] = dirs[i];
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        const p = board[nr][nc];
        if (!p || p.color !== color) out.push([nr, nc]);
      }
    }
  }
  if (type === 'N') {
    const dirs = [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
    for (let i = 0; i < 8; i++) {
      const [dr, dc] = dirs[i];
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        const p = board[nr][nc];
        if (!p || p.color !== color) out.push([nr, nc]);
      }
    }
  }
  if (type === 'P') {
    const dir = color === 'w' ? -1 : 1;
    const startRow = color === 'w' ? 6 : 1;
    const nr = r + dir;
    if (nr >= 0 && nr < 8) {
      if (!board[nr][c]) {
        out.push([nr, c]);
        const n2r = r + 2 * dir;
        if (r === startRow && !board[n2r][c]) {
          out.push([n2r, c]);
        }
      }
      for (const dc of [-1, 1]) {
        const nc = c + dc;
        if (nc >= 0 && nc < 8) {
          const p = board[nr][nc];
          if (p && p.color === opp) {
            out.push([nr, nc]);
          } else if (enPassant && nr === enPassant[0] && nc === enPassant[1]) {
            out.push([nr, nc]);
          }
        }
      }
    }
  }
  return out;
}

function findKing(board: Board, color: Color): [number, number] | null {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p?.type === 'K' && p.color === color) return [r, c];
    }
  }
  return null;
}

export function isInCheck(board: Board, color: Color): boolean {
  const king = findKing(board, color);
  if (!king) return false;
  const opp = color === 'w' ? 'b' : 'w';
  return isSquareAttacked(board, king[0], king[1], opp);
}

export function legalMoves(board: Board, r: number, c: number, castling?: Castling, enPassant?: [number, number] | null): [number, number][] {
  const piece = board[r][c];
  if (!piece) return [];
  // King position is the same for every candidate move except when the king
  // itself is the piece moving — find it once instead of rescanning the
  // whole board inside isInCheck for every pseudo-move (this runs at every
  // search node, so it adds up fast).
  const opp = piece.color === 'w' ? 'b' : 'w';
  const staticKingPos = piece.type === 'K' ? null : findKing(board, piece.color);
  const moves = pseudoMoves(board, r, c, enPassant).filter(([tr, tc]) => {
    const after = applyMove(board, [r, c], [tr, tc]);
    const king = staticKingPos ?? [tr, tc];
    return !isSquareAttacked(after, king[0], king[1], opp);
  });
  if (piece.type === 'K' && castling && !isInCheck(board, piece.color)) {
    const { color } = piece;
    const row = color === 'w' ? 7 : 0;
    if (r === row && c === 4) {
      const ks = color === 'w' ? castling.wK : castling.bK;
      if (ks && !board[row][5] && !board[row][6] &&
          !isInCheck(applyMove(board, [row, 4], [row, 5]), color) &&
          !isInCheck(applyMove(board, [row, 4], [row, 6]), color))
        moves.push([row, 6]);
      const qs = color === 'w' ? castling.wQ : castling.bQ;
      if (qs && !board[row][3] && !board[row][2] && !board[row][1] &&
          !isInCheck(applyMove(board, [row, 4], [row, 3]), color) &&
          !isInCheck(applyMove(board, [row, 4], [row, 2]), color))
        moves.push([row, 2]);
    }
  }
  return moves;
}

export function allLegalMoves(board: Board, color: Color, castling?: Castling, enPassant?: [number, number] | null): Move[] {
  const moves: Move[] = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (board[r][c]?.color === color)
        for (const to of legalMoves(board, r, c, castling, enPassant))
          moves.push({ from: [r, c], to });
  return moves;
}

// Identifies a position for threefold-repetition purposes: piece placement,
// side to move, castling rights, and en-passant target square (per the
// standard repetition rule — not just the raw board).
export function positionKey(board: Board, color: Color, castling?: Castling, enPassant?: [number, number] | null): string {
  const boardStr = board.map(row => row.map(sq => sq ? `${sq.color}${sq.type}` : '.').join('')).join('/');
  const castlingStr = castling ? `${castling.wK ? 'K' : ''}${castling.wQ ? 'Q' : ''}${castling.bK ? 'k' : ''}${castling.bQ ? 'q' : ''}` : '';
  const epStr = enPassant ? `${enPassant[0]},${enPassant[1]}` : '-';
  return `${boardStr}|${color}|${castlingStr}|${epStr}`;
}

export function isThreefoldRepetition(positionKeys: string[], latestKey: string): boolean {
  let count = 0;
  for (const key of positionKeys) if (key === latestKey) count++;
  return count >= 3;
}

export function gameStatus(
  board: Board,
  color: Color,
  castling?: Castling,
  enPassant?: [number, number] | null,
  priorPositionKeys?: string[],
): GameStatus {
  const moves = allLegalMoves(board, color, castling, enPassant);
  if (moves.length === 0) return isInCheck(board, color) ? 'checkmate' : 'stalemate';
  if (priorPositionKeys) {
    const key = positionKey(board, color, castling, enPassant);
    if (isThreefoldRepetition(priorPositionKeys, key)) return 'draw';
  }
  return isInCheck(board, color) ? 'check' : 'playing';
}
