import type { Level } from '../../chess/types';

export const SQ = 73;


export const LEVELS: Level[] = [
  { label: 'Easy',        depth: 1,  maxTimeMs: 1_000 },
  { label: 'Medium',      depth: 3,  maxTimeMs: 1_500 },
  { label: 'Hard',        depth: 5,  maxTimeMs: 2_500 },
  { label: 'Expert',      depth: 7,  maxTimeMs: 4_000 },
  { label: 'Master',      depth: 9,  maxTimeMs: 6_000 },
  { label: 'Grandmaster', depth: 11, maxTimeMs: 9_000 },
];

export const ARROW_COLOR = 'rgba(80, 152, 210, 0.82)';
export const ARROW_SW = Math.round(SQ * 0.155);
export const HEAD_LEN = Math.round(SQ * 0.37);
export const HEAD_HALF = Math.round(SQ * 0.24);
