export type Color = 'w' | 'b';
export type PieceType = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P';

export interface Piece {
  type: PieceType;
  color: Color;
}

export type Square = Piece | null;
export type Board = Square[][];

export interface Move {
  from: [number, number];
  to: [number, number];
}

export interface Castling {
  wK: boolean;
  wQ: boolean;
  bK: boolean;
  bQ: boolean;
}

export type GameStatus = 'playing' | 'check' | 'checkmate' | 'stalemate' | 'draw';
export type GameMode = 'pvai' | 'aiai';

export interface Score {
  white: number;
  black: number;
  draws: number;
}

export interface Level {
  label: string;
  depth: number;
  maxTimeMs: number;
  // When true, among near-best-eval root moves the AI prefers whichever
  // would earn the flashiest annotate.ts badge (brilliant > great > best),
  // instead of just the first-found top move. Never trades away strength.
  styled?: boolean;
}

export interface HistoryEntry {
  san: string;
  move: Move;
  board: Board;
  castling: Castling;
  enPassant: [number, number] | null;
  evalScore: number;
  turn: Color;
  status: GameStatus;
}
