import type { Level } from '../../chess/types';

export const SQ = 73;

export const VS = '︎';
export const GLYPH: Record<string, string> = {
  wK: `♚${VS}`, wQ: `♛${VS}`, wR: `♜${VS}`, wB: `♝${VS}`, wN: `♞${VS}`, wP: `♟${VS}`,
  bK: `♚${VS}`, bQ: `♛${VS}`, bR: `♜${VS}`, bB: `♝${VS}`, bN: `♞${VS}`, bP: `♟${VS}`,
};

export const LEVELS: Level[] = [
  { label: 'Easy',        depth: 1 },
  { label: 'Medium',      depth: 2 },
  { label: 'Hard',        depth: 3 },
  { label: 'Expert',      depth: 4 },
  { label: 'Master',      depth: 5 },
  { label: 'Grandmaster', depth: 6 },
];

export const ARROW_COLOR = 'rgba(90,210,80,0.82)';
export const ARROW_SW = Math.round(SQ * 0.155);
export const HEAD_LEN = Math.round(SQ * 0.37);
export const HEAD_HALF = Math.round(SQ * 0.24);
