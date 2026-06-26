import { applyMove } from './board';
import type { Board, Castling, Color, GameStatus, Move } from './types';

function inBounds(r: number, c: number) {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

export function pseudoMoves(board: Board, r: number, c: number, enPassant?: [number, number] | null): [number, number][] {
  const piece = board[r][c];
  if (!piece) return [];
  const { type, color } = piece;
  const opp = color === 'w' ? 'b' : 'w';
  const out: [number, number][] = [];

  const slide = (dr: number, dc: number) => {
    let nr = r + dr, nc = c + dc;
    while (inBounds(nr, nc)) {
      if (board[nr][nc]) { if (board[nr][nc]!.color === opp) out.push([nr, nc]); break; }
      out.push([nr, nc]);
      nr += dr; nc += dc;
    }
  };
  const step = (dr: number, dc: number) => {
    const nr = r + dr, nc = c + dc;
    if (inBounds(nr, nc) && board[nr][nc]?.color !== color) out.push([nr, nc]);
  };

  if (type === 'R') [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dr,dc]) => slide(dr, dc));
  else if (type === 'B') [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dr,dc]) => slide(dr, dc));
  else if (type === 'Q') [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dr,dc]) => slide(dr, dc));
  else if (type === 'K') [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dr,dc]) => step(dr, dc));
  else if (type === 'N') [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]].forEach(([dr,dc]) => step(dr, dc));
  else if (type === 'P') {
    const dir = color === 'w' ? -1 : 1;
    const startRow = color === 'w' ? 6 : 1;
    if (inBounds(r + dir, c) && !board[r + dir][c]) {
      out.push([r + dir, c]);
      if (r === startRow && !board[r + 2 * dir][c]) out.push([r + 2 * dir, c]);
    }
    for (const dc of [-1, 1]) {
      if (inBounds(r + dir, c + dc) && board[r + dir][c + dc]?.color === opp)
        out.push([r + dir, c + dc]);
      else if (enPassant && inBounds(r + dir, c + dc) &&
               r + dir === enPassant[0] && c + dc === enPassant[1])
        out.push([r + dir, c + dc]);
    }
  }
  return out;
}

export function isInCheck(board: Board, color: Color): boolean {
  let kr = -1, kc = -1;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (board[r][c]?.type === 'K' && board[r][c]?.color === color) { kr = r; kc = c; }
  const opp = color === 'w' ? 'b' : 'w';
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (board[r][c]?.color === opp)
        if (pseudoMoves(board, r, c).some(([mr, mc]) => mr === kr && mc === kc)) return true;
  return false;
}

export function legalMoves(board: Board, r: number, c: number, castling?: Castling, enPassant?: [number, number] | null): [number, number][] {
  const piece = board[r][c];
  if (!piece) return [];
  const moves = pseudoMoves(board, r, c, enPassant).filter(([tr, tc]) =>
    !isInCheck(applyMove(board, [r, c], [tr, tc]), piece.color)
  );
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

export function gameStatus(board: Board, color: Color, castling?: Castling, enPassant?: [number, number] | null): GameStatus {
  const moves = allLegalMoves(board, color, castling, enPassant);
  if (moves.length === 0) return isInCheck(board, color) ? 'checkmate' : 'stalemate';
  return isInCheck(board, color) ? 'check' : 'playing';
}
