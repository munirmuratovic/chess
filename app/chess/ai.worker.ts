import { getAiMove, evaluateMove, ttClear, type AiMoveScore } from "./search";
import type { Board, Castling, Color, Move } from "./types";

export type AiWorkerRequest =
  | {
      type: "getMove";
      board: Board;
      color: Color;
      castling: Castling;
      depth: number;
      enPassant: [number, number] | null;
      timeLimitMs: number;
    }
  | {
      type: "evaluateMove";
      board: Board;
      color: Color;
      castling: Castling;
      move: Move;
      depth: number;
      enPassant: [number, number] | null;
      timeLimitMs: number;
    }
  | { type: "clear" };

export type AiWorkerResponse =
  | { type: "move"; move: Move | null; score: number; moveScores: AiMoveScore[] }
  | { type: "moveEval"; score: number }
  | { type: "cleared" };

// Declared locally rather than pulling in the "webworker" lib (which conflicts
// with the "DOM" lib used by the rest of the app in the same tsconfig).
declare const self: {
  onmessage: ((e: MessageEvent<AiWorkerRequest>) => void) | null;
  postMessage: (msg: AiWorkerResponse) => void;
};

self.onmessage = (e) => {
  const msg = e.data;

  if (msg.type === "clear") {
    ttClear();
    self.postMessage({ type: "cleared" });
    return;
  }

  if (msg.type === "evaluateMove") {
    const score = evaluateMove(
      msg.board,
      msg.color,
      msg.castling,
      msg.move,
      msg.depth,
      msg.enPassant,
      msg.timeLimitMs,
    );
    self.postMessage({ type: "moveEval", score });
    return;
  }

  const { move, score, moveScores } = getAiMove(
    msg.board,
    msg.color,
    msg.castling,
    msg.depth,
    msg.enPassant,
    msg.timeLimitMs,
  );
  self.postMessage({ type: "move", move, score, moveScores });
};
