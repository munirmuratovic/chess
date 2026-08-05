// Chess.com-style move-quality badges. This is a best-effort heuristic
// approximation (their exact classifier is proprietary and considers a lot
// more context — opening books, engine consensus at multiple depths, etc.)
// built on top of our own engine's evaluation.
import { applyMove } from "./board";
import { PIECE_VALUE } from "./eval";
import { isSquareAttacked } from "./moves";
import type { Board, Color, Move } from "./types";

export type MoveClass =
  | "checkmate"
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder"
  | "resignation";

export interface MoveAnnotation {
  class: MoveClass;
  label: string;
  icon: string;
  colorClass: string; // tailwind text color, used as a fallback / for text emphasis
  bgColor: string; // solid badge color, used for the on-board square badge (chess.com style)
  gradient: string; // css gradient for the badge chip, gives it some depth
  ring: string; // subtle border/glow color, slightly lighter than bgColor
}

// Highlight-worthy classes: the ones that actually matter when reviewing a
// game (great finds and outright errors), used by the "Highlights only" filter.
export const HIGHLIGHT_CLASSES: MoveClass[] = ["checkmate", "brilliant", "great", "blunder"];

const INFO: Record<MoveClass, Omit<MoveAnnotation, "class">> = {
  checkmate: {
    label: "Checkmate",
    icon: "#",
    colorClass: "text-fuchsia-300",
    bgColor: "#7c3aed",
    gradient: "linear-gradient(135deg, #a78bfa 0%, #7c3aed 55%, #5b21b6 100%)",
    ring: "#c4b5fd",
  },
  brilliant: {
    label: "Brilliant",
    icon: "!!",
    colorClass: "text-cyan-300",
    bgColor: "#1baca6",
    gradient: "linear-gradient(135deg, #2dd4c9 0%, #1baca6 55%, #128a85 100%)",
    ring: "#5eead4",
  },
  great: {
    label: "Great move",
    icon: "!",
    colorClass: "text-sky-300",
    bgColor: "#5c8bb0",
    gradient: "linear-gradient(135deg, #7fb0d4 0%, #5c8bb0 55%, #45688a 100%)",
    ring: "#93c5fd",
  },
  best: {
    label: "Best move",
    icon: "★",
    colorClass: "text-emerald-300",
    bgColor: "#81b64c",
    gradient: "linear-gradient(135deg, #9ccf68 0%, #81b64c 55%, #63913a 100%)",
    ring: "#bbf7d0",
  },
  excellent: {
    label: "Excellent",
    icon: "✓",
    colorClass: "text-emerald-300",
    bgColor: "#81b64c",
    gradient: "linear-gradient(135deg, #9ccf68 0%, #81b64c 55%, #63913a 100%)",
    ring: "#bbf7d0",
  },
  good: {
    label: "Good",
    icon: "✓",
    colorClass: "text-lime-300",
    bgColor: "#95b962",
    gradient: "linear-gradient(135deg, #aecf80 0%, #95b962 55%, #75954a 100%)",
    ring: "#d9f99d",
  },
  inaccuracy: {
    label: "Inaccuracy",
    icon: "?!",
    colorClass: "text-yellow-300",
    bgColor: "#f7c045",
    gradient: "linear-gradient(135deg, #fbd873 0%, #f7c045 55%, #dba428 100%)",
    ring: "#fde68a",
  },
  mistake: {
    label: "Mistake",
    icon: "?",
    colorClass: "text-orange-300",
    bgColor: "#e6912c",
    gradient: "linear-gradient(135deg, #f0ac5c 0%, #e6912c 55%, #c0741a 100%)",
    ring: "#fdba74",
  },
  blunder: {
    label: "Blunder",
    icon: "??",
    colorClass: "text-red-400",
    bgColor: "#ca3431",
    gradient: "linear-gradient(135deg, #e0605d 0%, #ca3431 55%, #a11f1d 100%)",
    ring: "#fca5a5",
  },
  resignation: {
    label: "Resignation",
    icon: "⚑",
    colorClass: "text-gray-300",
    bgColor: "#4b5563",
    gradient: "linear-gradient(135deg, #6b7280 0%, #4b5563 55%, #374151 100%)",
    ring: "#9ca3af",
  },
};

// Standalone badge for a resignation — it isn't graded like a move (there's
// no position to search), so it bypasses classifyMove entirely.
export const RESIGNATION_ANNOTATION: MoveAnnotation = { class: "resignation", ...INFO.resignation };

function sameMove(a: Move, b: Move): boolean {
  return a.from[0] === b.from[0] && a.from[1] === b.from[1] && a.to[0] === b.to[0] && a.to[1] === b.to[1];
}

// Rough "does this look like a sacrifice" check: the piece lands on a square
// the opponent attacks, and it's worth clearly more than whatever (if
// anything) it just captured there.
export function looksLikeSacrifice(board: Board, color: Color, move: Move): boolean {
  const piece = board[move.from[0]][move.from[1]];
  if (!piece || piece.type === "P" || piece.type === "K") return false;
  const opp: Color = color === "w" ? "b" : "w";
  const after = applyMove(board, move.from, move.to);
  const [tr, tc] = move.to;
  if (!isSquareAttacked(after, tr, tc, opp)) return false;
  const captured = board[tr][tc];
  const capturedValue = captured ? PIECE_VALUE[captured.type] : 0;
  return PIECE_VALUE[piece.type] > capturedValue + 0.5;
}

export function classifyMove(params: {
  board: Board; // position before the move
  color: Color; // mover
  move: Move; // move actually played
  bestMove: Move; // engine's top choice for this position
  bestEvalWhite: number; // eval if bestMove is played (white-positive)
  actualEvalWhite: number; // eval after the move actually played (white-positive)
  secondBestEvalWhite?: number; // rough signal only, see AiMoveScore
  isCheckmate?: boolean; // move actually delivered checkmate — always wins over the eval-based grade
}): MoveAnnotation {
  const { board, color, move, bestMove, bestEvalWhite, actualEvalWhite, secondBestEvalWhite, isCheckmate } = params;
  if (isCheckmate) return { class: "checkmate", ...INFO.checkmate };
  const sign = color === "w" ? 1 : -1;
  const bestEval = bestEvalWhite * sign;
  const actualEval = actualEvalWhite * sign;
  const loss = Math.max(0, bestEval - actualEval);
  const isTopMove = sameMove(move, bestMove);

  if (isTopMove) {
    if (actualEval > 1.5 && looksLikeSacrifice(board, color, move)) {
      return { class: "brilliant", ...INFO.brilliant };
    }
    if (secondBestEvalWhite !== undefined) {
      const secondBest = secondBestEvalWhite * sign;
      if (bestEval - secondBest > 1.5) {
        return { class: "great", ...INFO.great };
      }
    }
    return { class: "best", ...INFO.best };
  }

  if (loss <= 0.15) return { class: "excellent", ...INFO.excellent };
  if (loss <= 0.4) return { class: "good", ...INFO.good };
  if (loss <= 1.0) return { class: "inaccuracy", ...INFO.inaccuracy };
  if (loss <= 2.5) return { class: "mistake", ...INFO.mistake };
  return { class: "blunder", ...INFO.blunder };
}
