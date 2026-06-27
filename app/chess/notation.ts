import { applyMove, updateCastling, updateEnPassant, initialBoard, defaultCastling } from './board';
import { allLegalMoves, isInCheck, legalMoves, gameStatus } from './moves';
import type { Board, Castling, Color, GameMode, HistoryEntry } from './types';
import { materialEval } from './eval';

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

export interface ReplayedGame {
  board: Board;
  castling: Castling;
  enPassant: [number, number] | null;
  turn: Color;
  history: HistoryEntry[];
  error?: string;
}

function norm(san: string): string {
  let s = san.toUpperCase()
    .replace(/0-0-0/g, 'O-O-O')
    .replace(/0-0/g, 'O-O')
    .replace(/E\.P\./g, '')
    .replace(/EP/g, '');
  s = s.replace(/[^A-Z0-9\-]/g, '');
  return s;
}

export function replayPGN(pgn: string): ReplayedGame {
  // Remove headers
  let moveText = pgn.replace(/\[[^\]]*\]/g, ' ');
  // Remove comments and RAVs
  moveText = moveText
    .replace(/\{[^\}]*\}/g, ' ')
    .replace(/;.*$/gm, ' ')
    .replace(/\([^\)]*\)/g, ' ');
  
  // Replace move numbers with spaces
  moveText = moveText.replace(/(\d+)\s*\.+\s*/g, ' ');
  
  // Split into tokens
  const tokens = moveText.replace(/\s+/g, ' ').trim().split(' ');
  const cleanTokens = tokens.filter(t => {
    if (!t) return false;
    // Remove game result
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) return false;
    return true;
  });

  // Replay starting position
  let board = initialBoard();
  let castling = defaultCastling();
  let enPassant: [number, number] | null = null;
  let turn: Color = 'w';
  const history: HistoryEntry[] = [];

  for (let i = 0; i < cleanTokens.length; i++) {
    const token = cleanTokens[i];
    const normalizedToken = norm(token);

    // Find the legal move that matches
    const moves = allLegalMoves(board, turn, castling, enPassant);
    let matchedMove = null;
    let matchedSan = '';

    for (const m of moves) {
      const san = toSAN(board, m.from, m.to, castling, enPassant);
      if (norm(san) === normalizedToken) {
        matchedMove = m;
        matchedSan = san;
        break;
      }
    }

    // Try a looser match if strict fails (e.g. sometimes PGN has promotion missing or check missing)
    if (!matchedMove) {
      for (const m of moves) {
        const san = toSAN(board, m.from, m.to, castling, enPassant);
        const nSan = norm(san);
        if (nSan.startsWith(normalizedToken) || normalizedToken.startsWith(nSan)) {
          matchedMove = m;
          matchedSan = san;
          break;
        }
      }
    }

    if (!matchedMove) {
      return {
        board,
        castling,
        enPassant,
        turn,
        history,
        error: `Could not parse move ${i + 1}: "${token}"`
      };
    }

    // Apply the move
    const nextBoard = applyMove(board, matchedMove.from, matchedMove.to);
    const nextCastling = updateCastling(castling, matchedMove.from, matchedMove.to);
    const nextEnPassant = updateEnPassant(board, matchedMove.from, matchedMove.to);
    const nextTurn: Color = turn === 'w' ? 'b' : 'w';
    const nextStatus = gameStatus(nextBoard, nextTurn, nextCastling, nextEnPassant);
    const nextEval = materialEval(nextBoard);

    board = nextBoard;
    castling = nextCastling;
    enPassant = nextEnPassant;
    turn = nextTurn;

    history.push({
      san: matchedSan,
      board,
      castling,
      enPassant,
      evalScore: nextEval,
      turn,
      status: nextStatus
    });
  }

  return {
    board,
    castling,
    enPassant,
    turn,
    history
  };
}
