import type { Board, Castling, PieceType } from './types';

export function initialBoard(): Board {
  const b: Board = Array.from({ length: 8 }, () => Array(8).fill(null));
  const back: PieceType[] = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  for (let c = 0; c < 8; c++) {
    b[0][c] = { type: back[c], color: 'b' };
    b[1][c] = { type: 'P', color: 'b' };
    b[6][c] = { type: 'P', color: 'w' };
    b[7][c] = { type: back[c], color: 'w' };
  }
  return b;
}

export const defaultCastling = (): Castling => ({ wK: true, wQ: true, bK: true, bQ: true });

export function applyMove(board: Board, from: [number, number], to: [number, number]): Board {
  const nb = board.map(row => [...row]);
  const [fr, fc] = from, [tr, tc] = to;
  nb[tr][tc] = nb[fr][fc];
  nb[fr][fc] = null;
  if (nb[tr][tc]?.type === 'P' && (tr === 0 || tr === 7))
    nb[tr][tc] = { type: 'Q', color: nb[tr][tc]!.color };
  // En passant: pawn moved diagonally to empty square → remove the passed pawn
  if (nb[tr][tc]?.type === 'P' && fc !== tc && board[tr][tc] === null)
    nb[fr][tc] = null;
  // Move rook for castling
  if (nb[tr][tc]?.type === 'K' && Math.abs(tc - fc) === 2) {
    if (tc === 6) { nb[tr][5] = nb[tr][7]; nb[tr][7] = null; }
    else if (tc === 2) { nb[tr][3] = nb[tr][0]; nb[tr][0] = null; }
  }
  return nb;
}

export function updateCastling(castling: Castling, from: [number, number], to: [number, number]): Castling {
  const c = { ...castling };
  const [fr, fc] = from, [tr, tc] = to;
  if (fr === 7 && fc === 4) { c.wK = false; c.wQ = false; }
  if (fr === 0 && fc === 4) { c.bK = false; c.bQ = false; }
  if (fr === 7 && fc === 7) c.wK = false;
  if (fr === 7 && fc === 0) c.wQ = false;
  if (fr === 0 && fc === 7) c.bK = false;
  if (fr === 0 && fc === 0) c.bQ = false;
  // Rook captured at corner
  if (tr === 7 && tc === 7) c.wK = false;
  if (tr === 7 && tc === 0) c.wQ = false;
  if (tr === 0 && tc === 7) c.bK = false;
  if (tr === 0 && tc === 0) c.bQ = false;
  return c;
}

export function updateEnPassant(board: Board, from: [number, number], to: [number, number]): [number, number] | null {
  const piece = board[from[0]][from[1]];
  if (piece?.type === 'P' && Math.abs(to[0] - from[0]) === 2)
    return [(from[0] + to[0]) / 2, from[1]];
  return null;
}
