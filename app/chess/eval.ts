import type { Board, Color, PieceType } from './types';

export const PIECE_VALUE: Record<PieceType, number> = {
  Q: 10,
  R: 5,
  B: 3.25,
  N: 3,
  P: 1,
  K: 0,
};

// Piece-square tables — row 0 = black's back rank, row 7 = white's back rank.
// White pieces use [r][c] directly; black pieces use [7-r][c] (mirrored).
// Values in centipawns / 100 to stay in "pawn" units.
const PST: Record<PieceType, readonly number[][]> = {
  P: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [5, 5, 10, 25, 25, 10, 5, 5],
    [0, 0, 0, 20, 20, 0, 0, 0],
    [5, -5, -10, 0, 0, -10, -5, 5],
    [5, 10, 10, -20, -20, 10, 10, 5],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ],
  N: [
    [-50, -40, -30, -30, -30, -30, -40, -50],
    [-40, -20, 0, 0, 0, 0, -20, -40],
    [-30, 0, 10, 15, 15, 10, 0, -30],
    [-30, 5, 15, 20, 20, 15, 5, -30],
    [-30, 0, 15, 20, 20, 15, 0, -30],
    [-30, 5, 10, 15, 15, 10, 5, -30],
    [-40, -20, 0, 5, 5, 0, -20, -40],
    [-50, -40, -30, -30, -30, -30, -40, -50],
  ],
  B: [
    [-20, -10, -10, -10, -10, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 10, 10, 5, 0, -10],
    [-10, 5, 5, 10, 10, 5, 5, -10],
    [-10, 0, 10, 10, 10, 10, 0, -10],
    [-10, 10, 10, 10, 10, 10, 10, -10],
    [-10, 5, 0, 0, 0, 0, 5, -10],
    [-20, -10, -10, -10, -10, -10, -10, -20],
  ],
  R: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [5, 10, 10, 10, 10, 10, 10, 5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [0, 0, 0, 5, 5, 0, 0, 0],
  ],
  Q: [
    [-20, -10, -10, -5, -5, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 5, 5, 5, 0, -10],
    [-5, 0, 5, 5, 5, 5, 0, -5],
    [0, 0, 5, 5, 5, 5, 0, -5],
    [-10, 5, 5, 5, 5, 5, 0, -10],
    [-10, 0, 5, 0, 0, 0, 0, -10],
    [-20, -10, -10, -5, -5, -10, -10, -20],
  ],
  K: [
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-20, -30, -30, -40, -40, -30, -30, -20],
    [-10, -20, -20, -20, -20, -20, -20, -10],
    [20, 20, 0, 0, 0, 0, 20, 20],
    [20, 30, 10, 0, 0, 10, 30, 20],
  ],
};

export function pieceScore(type: PieceType, r: number, c: number, color: Color): number {
  const pstRow = color === 'w' ? r : 7 - r;
  return PIECE_VALUE[type] + PST[type][pstRow][c] / 100;
}

// Positive = white winning (for eval bar display)
export function materialEval(board: Board): number {
  let score = 0;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p)
        score += pieceScore(p.type, r, c, p.color) * (p.color === 'w' ? 1 : -1);
    }
  return score;
}

const STARTING_COUNTS: Record<PieceType, number> = { P: 8, N: 2, B: 2, R: 2, Q: 1, K: 1 };

export interface CapturedPieces {
  // Pieces white has captured (i.e. missing from black's original set).
  byWhite: PieceType[];
  // Pieces black has captured (i.e. missing from white's original set).
  byBlack: PieceType[];
  // White material minus black material, in points (positive favors white).
  diff: number;
}

// Derived from the board's current piece counts rather than tracked move-by-
// move, so it stays correct across undo/PGN-import/history navigation for
// free — no need to thread capture events through every code path that
// mutates the board.
export function computeCaptured(board: Board): CapturedPieces {
  const counts: Record<Color, Record<PieceType, number>> = {
    w: { P: 0, N: 0, B: 0, R: 0, Q: 0, K: 0 },
    b: { P: 0, N: 0, B: 0, R: 0, Q: 0, K: 0 },
  };
  for (const row of board)
    for (const p of row) if (p) counts[p.color][p.type]++;

  // Pawn promotion swaps a pawn for e.g. a queen without any capture
  // happening, so per-type count deltas alone would report a phantom
  // "captured pawn" whenever either side has promoted. Total piece count per
  // side IS capture-accurate (promotion doesn't change it), so use that as
  // the ground truth for how many pieces each side actually lost, and only
  // use the per-type deltas to guess *which* types — trimming away the
  // lowest-value (pawn-first) phantom entries introduced by promotions.
  const totalWhite = Object.values(counts.w).reduce((a, b) => a + b, 0);
  const totalBlack = Object.values(counts.b).reduce((a, b) => a + b, 0);
  const actualBlackLost = 16 - totalBlack; // real pieces captured by white
  const actualWhiteLost = 16 - totalWhite; // real pieces captured by black

  const byValueDesc = (a: PieceType, b: PieceType) => PIECE_VALUE[b] - PIECE_VALUE[a];
  const byValueAsc = (a: PieceType, b: PieceType) => PIECE_VALUE[a] - PIECE_VALUE[b];

  let byWhite: PieceType[] = [];
  let byBlack: PieceType[] = [];
  for (const type of Object.keys(STARTING_COUNTS) as PieceType[]) {
    const missingBlack = Math.max(0, STARTING_COUNTS[type] - counts.b[type]);
    const missingWhite = Math.max(0, STARTING_COUNTS[type] - counts.w[type]);
    for (let i = 0; i < missingBlack; i++) byWhite.push(type);
    for (let i = 0; i < missingWhite; i++) byBlack.push(type);
  }
  // Trim phantom entries from promotions: drop lowest-value first (pawns).
  byWhite.sort(byValueAsc);
  byWhite = byWhite.slice(byWhite.length - actualBlackLost);
  byBlack.sort(byValueAsc);
  byBlack = byBlack.slice(byBlack.length - actualWhiteLost);
  // Display order: queen first, pawns last (chess.com convention).
  byWhite.sort(byValueDesc);
  byBlack.sort(byValueDesc);

  // Exact material diff, promotion-safe (sum of current piece values, not
  // count-deltas): equivalent to materialEval() without the PST term.
  let whiteValue = 0, blackValue = 0;
  for (const type of Object.keys(STARTING_COUNTS) as PieceType[]) {
    whiteValue += counts.w[type] * PIECE_VALUE[type];
    blackValue += counts.b[type] * PIECE_VALUE[type];
  }
  const diff = whiteValue - blackValue;

  return { byWhite, byBlack, diff };
}
