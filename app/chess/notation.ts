import { applyMove, updateCastling, updateEnPassant } from './board';
import { allLegalMoves, isInCheck, legalMoves } from './moves';
import type { Board, Castling, Color, GameMode } from './types';

const FILES = 'abcdefgh';

function sqLabel(r: number, c: number): string {
  return FILES[c] + (8 - r);
}

export function toSAN(
  board: Board,
  from: [number, number],
  to: [number, number],
  castling: Castling,
  enPassant: [number, number] | null,
): string {
  const [fr, fc] = from;
  const [tr, tc] = to;
  const piece = board[fr][fc];
  if (!piece) return '?';
  const { type, color } = piece;
  const isCapture = board[tr][tc] !== null || (type === 'P' && fc !== tc && enPassant != null);

  const nb = applyMove(board, from, to);
  const nc = updateCastling(castling, from, to);
  const ne = updateEnPassant(board, from, to);
  const oppColor: Color = color === 'w' ? 'b' : 'w';
  const inCheck = isInCheck(nb, oppColor);
  const isMate = inCheck && allLegalMoves(nb, oppColor, nc, ne).length === 0;
  const suffix = isMate ? '#' : inCheck ? '+' : '';

  // Castling
  if (type === 'K' && Math.abs(tc - fc) === 2)
    return (tc === 6 ? 'O-O' : 'O-O-O') + suffix;

  // Pawn
  if (type === 'P') {
    let san = isCapture ? FILES[fc] + 'x' + sqLabel(tr, tc) : sqLabel(tr, tc);
    if (tr === 0 || tr === 7) san += '=Q';
    return san + suffix;
  }

  // Piece — find ambiguous movers
  const ambiguous: [number, number][] = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      if (r === fr && c === fc) continue;
      const p = board[r][c];
      if (p?.type === type && p.color === color)
        if (legalMoves(board, r, c, castling, enPassant).some(([mr, mc]) => mr === tr && mc === tc))
          ambiguous.push([r, c]);
    }

  let disambig = '';
  if (ambiguous.length > 0) {
    const sameFile = ambiguous.some(([, ac]) => ac === fc);
    const sameRank = ambiguous.some(([ar]) => ar === fr);
    if (!sameFile) disambig = FILES[fc];
    else if (!sameRank) disambig = String(8 - fr);
    else disambig = FILES[fc] + String(8 - fr);
  }

  return type + disambig + (isCapture ? 'x' : '') + sqLabel(tr, tc) + suffix;
}

export interface PGNMeta {
  gameMode: GameMode;
  playerColor: Color;
  result: '*' | '1-0' | '0-1' | '1/2-1/2';
  date: string;
}

export function toPGN(sans: string[], meta: PGNMeta): string {
  const white = meta.gameMode === 'aiai' ? 'White AI' : meta.playerColor === 'w' ? 'Human' : 'Computer';
  const black = meta.gameMode === 'aiai' ? 'Black AI' : meta.playerColor === 'b' ? 'Human' : 'Computer';

  const header = [
    `[Event "Chess Test"]`,
    `[Site "Chess Test"]`,
    `[Date "${meta.date}"]`,
    `[White "${white}"]`,
    `[Black "${black}"]`,
    `[Result "${meta.result}"]`,
  ].join('\n');

  const moves: string[] = [];
  for (let i = 0; i < sans.length; i += 2) {
    const num = Math.floor(i / 2) + 1;
    const w = sans[i];
    const b = sans[i + 1] ?? '';
    moves.push(b ? `${num}. ${w} ${b}` : `${num}. ${w}`);
  }

  return header + '\n\n' + moves.join(' ') + ' ' + meta.result;
}
