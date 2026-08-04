import { useEffect, useState } from 'react';
import type { Level } from '../../chess/types';

// Desktop/max square size. On narrower viewports, useSquareSize() below
// shrinks this down so the whole 8x8 board (plus eval bar and margins) fits
// without horizontal scrolling.
export const SQ = 73;

function computeSquareSize(): number {
  if (typeof window === 'undefined') return SQ;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Below this width the move-history panel stacks under the board instead
  // of sitting beside it (see the layout in home.tsx), so only the eval bar
  // + its gap need to be reserved alongside the board itself.
  const stacked = vw < 768;
  const pagePadding = 32; // p-4 on both sides of the root container
  const horizontalChrome = stacked ? 18 + 12 + pagePadding : 18 + 12 + 220 + 12 + pagePadding; // eval bar + gap (+ moves panel + gap) + page padding
  const byWidth = Math.floor((vw - horizontalChrome) / 8);
  const byHeight = Math.floor((vh * 0.55) / 8); // leave room for header/status/buttons above & below
  return Math.max(24, Math.min(SQ, byWidth, byHeight));
}

// Recomputes the board's square size to fit the viewport, shrinking on
// mobile/narrow windows and capping at SQ on desktop.
export function useSquareSize(): number {
  const [size, setSize] = useState(computeSquareSize);
  useEffect(() => {
    const onResize = () => setSize(computeSquareSize());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

// Arrow/marker geometry scales with the square size, so it has to be derived
// per-render rather than computed once at module load like the old static
// ARROW_SW/HEAD_LEN/HEAD_HALF constants were.
export function arrowGeometry(sq: number) {
  return {
    arrowSw: Math.round(sq * 0.155),
    headLen: Math.round(sq * 0.37),
    headHalf: Math.round(sq * 0.24),
  };
}

export const LEVELS: Level[] = [
  { label: 'Easy',        depth: 1,  maxTimeMs: 1_000 },
  { label: 'Medium',      depth: 3,  maxTimeMs: 1_500 },
  { label: 'Hard',        depth: 5,  maxTimeMs: 2_500 },
  { label: 'Expert',      depth: 7,  maxTimeMs: 4_000 },
  { label: 'Master',      depth: 9,  maxTimeMs: 6_000 },
  { label: 'Grandmaster', depth: 11, maxTimeMs: 9_000 },
];

export const ARROW_COLOR = 'rgba(80, 152, 210, 0.82)';
