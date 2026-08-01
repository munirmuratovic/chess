// Chess.com-style move-quality badges. This is a best-effort heuristic
// approximation (their exact classifier is proprietary and considers a lot
// more context — opening books, engine consensus at multiple depths, etc.)
// built on top of our own engine's evaluation.
import { applyMove } from "./board";
import { PIECE_VALUE } from "./eval";
import { isSquareAttacked } from "./moves";
import type { Board, Color, Move } from "./types";

export type MoveClass =
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder";

export interface MoveAnnotation {
  class: MoveClass;
  label: string;
  icon: string;
  colorClass: string; // tailwind text color, used in the move list
  bgColor: string; // solid badge color, used for the on-board square badge (chess.com style)
}

const INFO: Record<MoveClass, Omit<MoveAnnotation, "class">> = {
  brilliant: { label: "Brilliant", icon: "!!", colorClass: "text-cyan-400", bgColor: "#1baca6" },
  great: { label: "Great move", icon: "!", colorClass: "text-blue-400", bgColor: "#5c8bb0" },
  best: { label: "Best move", icon: "★", colorClass: "text-emerald-400", bgColor: "#81b64c" },
  excellent: { label: "Excellent", icon: "✓", colorClass: "text-emerald-400", bgColor: "#81b64c" },
  good: { label: "Good", icon: "✓", colorClass: "text-lime-400", bgColor: "#95b962" },
  inaccuracy: { label: "Inaccuracy", icon: "?!", colorClass: "text-yellow-400", bgColor: "#f7c045" },
  mistake: { label: "Mistake", icon: "?", colorClass: "text-orange-400", bgColor: "#e6912c" },
  blunder: { label: "Blunder", icon: "??", colorClass: "text-red-500", bgColor: "#ca3431" },
};

function sameMove(a: Move, b: Move): boolean {
  return a.from[0] === b.from[0] && a.from[1] === b.from[1] && a.to[0] === b.to[0] && a.to[1] === b.to[1];
}

// Rough "does this look like a sacrifice" check: the piece lands on a square
// the opponent attacks, and it's worth clearly more than whatever (if
// anything) it just captured there.
function looksLikeSacrifice(board: Board, color: Color, move: Move): boolean {
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
}): MoveAnnotation {
  const { board, color, move, bestMove, bestEvalWhite, actualEvalWhite, secondBestEvalWhite } = params;
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
