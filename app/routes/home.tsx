import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyMove,
  defaultCastling,
  initialBoard,
  updateCastling,
  updateEnPassant,
} from "../chess/board";
import { gameStatus, legalMoves } from "../chess/moves";
import { materialEval } from "../chess/eval";
import { toPGN, toSAN, replayPGN } from "../chess/notation";
import { createAiClient, type AiClient } from "../chess/aiClient";
import type { AiMoveScore } from "../chess/search";
import { classifyMove, type MoveAnnotation } from "../chess/annotate";
import type {
  Board,
  Castling,
  Color,
  GameMode,
  GameStatus,
  HistoryEntry,
  Move,
  Score,
} from "../chess/types";
import { ChessBoard } from "../components/chess/ChessBoard";
import { LevelSelector } from "../components/chess/LevelSelector";
import { MoveHistory } from "../components/chess/MoveHistory";
import { Scoreboard } from "../components/chess/Scoreboard";
import { SetupScreen } from "../components/chess/SetupScreen";
import { LEVELS, SQ } from "../components/chess/constants";

interface GameState {
  board: Board;
  castling: Castling;
  enPassant: [number, number] | null;
  turn: Color;
  selected: [number, number] | null;
  highlights: [number, number][];
  lastMove: { from: [number, number]; to: [number, number] } | null;
  status: GameStatus;
  thinking: boolean;
  evalScore: number;
}

function freshState(): GameState {
  return {
    board: initialBoard(),
    castling: defaultCastling(),
    enPassant: null,
    turn: "w",
    selected: null,
    highlights: [],
    lastMove: null,
    status: "playing",
    thinking: false,
    evalScore: 0,
  };
}

function applyGameMove(
  s: GameState,
  from: [number, number],
  to: [number, number],
  history: HistoryEntry[],
): { state: GameState; entry: HistoryEntry } {
  const san = toSAN(s.board, from, to, s.castling, s.enPassant);
  const nb = applyMove(s.board, from, to);
  const nc = updateCastling(s.castling, from, to);
  const ne = updateEnPassant(s.board, from, to);
  const nextTurn: Color = s.turn === "w" ? "b" : "w";
  const nextStatus = gameStatus(nb, nextTurn, nc, ne);
  const nextEval = materialEval(nb);

  const newState: GameState = {
    ...s,
    board: nb,
    castling: nc,
    enPassant: ne,
    turn: nextTurn,
    selected: null,
    highlights: [],
    lastMove: { from, to },
    status: nextStatus,
    evalScore: nextEval,
  };

  const entry: HistoryEntry = {
    san,
    move: { from, to },
    board: nb,
    castling: nc,
    enPassant: ne,
    evalScore: nextEval,
    turn: nextTurn,
    status: nextStatus,
  };

  return { state: newState, entry };
}

function resultFromStatus(
  status: GameStatus,
  turn: Color,
): "*" | "1-0" | "0-1" | "1/2-1/2" {
  if (status === "stalemate") return "1/2-1/2";
  if (status === "checkmate") return turn === "w" ? "0-1" : "1-0";
  return "*";
}

function sameMove(a: Move, b: Move): boolean {
  return a.from[0] === b.from[0] && a.from[1] === b.from[1] && a.to[0] === b.to[0] && a.to[1] === b.to[1];
}

// Fixed strength used for ALL move-quality grading (Brilliant/Best/Blunder/…),
// deliberately independent of whatever difficulty the game itself is set to.
// If grading used the configured play level, an Easy (depth 1) game would
// call almost anything "Best" — the bar has to be the same regardless of who
// (or what level) is actually playing, or the badges mean nothing.
const ANALYSIS_LEVEL = { depth: 8, maxTimeMs: 2000 };

// Grades `played` against the engine's own analysis of the position it was
// played from (bestMove/bestEvalWhite/moveScores, from a "getMove" search).
// If `played` isn't the engine's top pick, this needs one extra exact search
// (evaluateMove) to score it — getMove()'s per-move scores are too imprecise
// for that (see AiMoveScore). Always graded at ANALYSIS_LEVEL, never at the
// mover's own (possibly much weaker or stronger) configured play level.
async function gradeMove(
  client: AiClient,
  preBoard: Board,
  mover: Color,
  preCastling: Castling,
  preEnPassant: [number, number] | null,
  played: Move,
  bestMove: Move,
  bestEvalWhite: number,
  moveScores: AiMoveScore[],
): Promise<MoveAnnotation | null> {
  const isTop = sameMove(played, bestMove);

  let actualEvalWhite = bestEvalWhite;
  if (!isTop) {
    const res = await client.send({
      type: "evaluateMove",
      board: preBoard,
      color: mover,
      castling: preCastling,
      move: played,
      depth: ANALYSIS_LEVEL.depth,
      enPassant: preEnPassant,
      timeLimitMs: ANALYSIS_LEVEL.maxTimeMs,
    });
    if (res.type !== "moveEval") return null;
    actualEvalWhite = res.score;
  }

  const sign = mover === "w" ? 1 : -1;
  let secondBestMoverEval = -Infinity;
  for (const m of moveScores) {
    if (sameMove(m, bestMove)) continue;
    const moverEval = m.score * sign;
    if (moverEval > secondBestMoverEval) secondBestMoverEval = moverEval;
  }
  const secondBestEvalWhite = secondBestMoverEval === -Infinity ? undefined : secondBestMoverEval * sign;

  return classifyMove({
    board: preBoard,
    color: mover,
    move: played,
    bestMove,
    bestEvalWhite,
    actualEvalWhite,
    secondBestEvalWhite,
  });
}

export function meta() {
  return [{ title: "Chess" }];
}

export default function Home() {
  const [gameMode, setGameMode] = useState<GameMode>("pvai");
  const [playerColor, setPlayerColor] = useState<Color>("w");
  const [gameStarted, setGameStarted] = useState(false);
  const [levelIdxW, setLevelIdxW] = useState(2);
  const [levelIdxB, setLevelIdxB] = useState(2);
  const [score, setScore] = useState<Score>({ white: 0, black: 0, draws: 0 });
  const [boardFlipped, setBoardFlipped] = useState(false);

  const [state, setState] = useState<GameState>(freshState);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // viewIdx: index into history (-1 = start position, history.length-1 = live)
  const [viewIdx, setViewIdx] = useState(-1);
  // Move-quality badges (Brilliant/Best/Blunder/…), parallel to `history`;
  // null until the background analysis for that move resolves.
  const [annotations, setAnnotations] = useState<(MoveAnnotation | null)[]>([]);
  const historyLenRef = useRef(0);
  historyLenRef.current = history.length;
  // Bumped on every full reset (new game / PGN import) so any in-flight
  // analysis from a previous game can recognize it's stale and bail out
  // instead of writing its result into the new game's annotations.
  const analysisGenerationRef = useRef(0);

  const { turn, selected, status, thinking } = state;
  const isOver = status === "checkmate" || status === "stalemate";
  const isLive = viewIdx === history.length - 1 || history.length === 0;

  // Displayed board: historical snapshot when navigating, live board otherwise
  const displayBoard = isLive
    ? state.board
    : viewIdx === -1
      ? initialBoard()
      : history[viewIdx].board;

  const flipBoard = boardFlipped;
  // Only allow human moves when live and it's their turn
  const isHumanTurn =
    isLive &&
    gameMode === "pvai" &&
    turn === playerColor &&
    !isOver &&
    !thinking;

  const [drag, setDrag] = useState<{
    r: number;
    c: number;
    x: number;
    y: number;
  } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [arrows, setArrows] = useState<
    Array<[[number, number], [number, number]]>
  >([]);
  const [circles, setCircles] = useState<Array<[number, number]>>([]);
  const rightStart = useRef<[number, number] | null>(null);
  const gameCounted = useRef(false);

  useEffect(() => {
    setArrows([]);
    setCircles([]);
  }, [state.board]);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setViewIdx((i) => Math.max(-1, i - 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setViewIdx((i) => Math.min(history.length - 1, i + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history.length]);

  // Score tracking
  useEffect(() => {
    if (!gameStarted || !isOver || gameCounted.current) return;
    gameCounted.current = true;
    setScore((s) => {
      if (status === "stalemate") return { ...s, draws: s.draws + 1 };
      const winner: Color = turn === "w" ? "b" : "w";
      return winner === "w"
        ? { ...s, white: s.white + 1 }
        : { ...s, black: s.black + 1 };
    });
  }, [isOver, gameStarted, status, turn]);

  // AI search runs off the main thread so deep (Grandmaster) searches can't
  // freeze the page or block input while thinking.
  const aiClientRef = useRef<AiClient | null>(null);
  useEffect(() => {
    const worker = new Worker(new URL("../chess/ai.worker.ts", import.meta.url), {
      type: "module",
    });
    const client = createAiClient(worker);
    aiClientRef.current = client;
    return () => {
      client.dispose();
      worker.terminate();
      aiClientRef.current = null;
    };
  }, []);

  // Background "what's the best move here, and how good is it" analysis for
  // whichever position is currently live — this doubles as the AI's own move
  // search (below) and as the baseline used to grade whatever move actually
  // gets played (further below), chess.com-style.
  interface Analysis {
    atHistoryLen: number;
    promise: Promise<{ bestMove: Move | null; bestEvalWhite: number; moveScores: AiMoveScore[] }>;
  }
  const pendingAnalysisRef = useRef<Analysis | null>(null);

  useEffect(() => {
    if (!gameStarted || isOver || !isLive) return;
    const client = aiClientRef.current;
    if (!client) return;
    const s = stateRef.current;
    const promise = client
      .send({
        type: "getMove",
        board: s.board,
        color: turn,
        castling: s.castling,
        depth: ANALYSIS_LEVEL.depth,
        enPassant: s.enPassant,
        timeLimitMs: ANALYSIS_LEVEL.maxTimeMs,
      })
      .then((res) => {
        if (res.type !== "move") return { bestMove: null, bestEvalWhite: 0, moveScores: [] };
        return { bestMove: res.move, bestEvalWhite: res.score, moveScores: res.moveScores };
      });
    pendingAnalysisRef.current = { atHistoryLen: historyLenRef.current, promise };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameStarted, isOver, isLive, turn, state.board]);

  // Grades whichever move was actually played against the pending analysis
  // for the position it was played from, and records a badge once ready.
  const classifyPlayedMove = useCallback((preMove: GameState, mover: Color, played: Move) => {
    const pending = pendingAnalysisRef.current;
    if (!pending) return;
    const atHistoryLen = pending.atHistoryLen;
    const myGen = analysisGenerationRef.current;
    (async () => {
      const client = aiClientRef.current;
      if (!client) return;
      const { bestMove, bestEvalWhite, moveScores } = await pending.promise;
      if (!bestMove) return;
      const annotation = await gradeMove(
        client,
        preMove.board,
        mover,
        preMove.castling,
        preMove.enPassant,
        played,
        bestMove,
        bestEvalWhite,
        moveScores,
      );
      if (!annotation || analysisGenerationRef.current !== myGen) return;
      setAnnotations((prev) => {
        const next = [...prev];
        next[atHistoryLen] = annotation;
        return next;
      });
    })();
  }, []);

  // Grades every move of the current game sequentially in the background —
  // triggered on demand (e.g. after importing a PGN) via the "Analyze Game"
  // button, rather than automatically, since it's a lot of searching for a
  // long game.
  const [analysisProgress, setAnalysisProgress] = useState<{ done: number; total: number } | null>(null);
  const runFullAnalysis = useCallback((entries: HistoryEntry[]) => {
    const myGen = analysisGenerationRef.current;
    setAnalysisProgress({ done: 0, total: entries.length });
    (async () => {
      let board = initialBoard();
      let castling = defaultCastling();
      let enPassant: [number, number] | null = null;
      let turn: Color = "w";
      for (let i = 0; i < entries.length; i++) {
        if (analysisGenerationRef.current !== myGen) return;
        const client = aiClientRef.current;
        if (!client) return;
        const entry = entries[i];
        const res = await client.send({
          type: "getMove",
          board,
          color: turn,
          castling,
          depth: ANALYSIS_LEVEL.depth,
          enPassant,
          timeLimitMs: ANALYSIS_LEVEL.maxTimeMs,
        });
        if (analysisGenerationRef.current === myGen && res.type === "move" && res.move) {
          const annotation = await gradeMove(
            client,
            board,
            turn,
            castling,
            enPassant,
            entry.move,
            res.move,
            res.score,
            res.moveScores,
          );
          if (annotation && analysisGenerationRef.current === myGen) {
            setAnnotations((prev) => {
              const next = [...prev];
              next[i] = annotation;
              return next;
            });
          }
        }
        board = entry.board;
        castling = entry.castling;
        enPassant = entry.enPassant;
        turn = entry.turn;
        if (analysisGenerationRef.current === myGen) {
          setAnalysisProgress({ done: i + 1, total: entries.length });
        }
      }
      if (analysisGenerationRef.current === myGen) {
        setTimeout(() => setAnalysisProgress((p) => (p && p.done >= p.total ? null : p)), 1200);
      }
    })();
  }, []);

  // AI move-selection effect — decides what the AI actually plays, at its own
  // configured difficulty. Deliberately a separate search from the grading
  // analysis above (which always runs at the fixed ANALYSIS_LEVEL): the move
  // the AI plays should reflect its configured strength, while the badge it
  // gets graded with must not.
  useEffect(() => {
    if (!gameStarted || isOver || thinking) return;
    const isAiTurn = gameMode === "aiai" || turn !== playerColor;
    if (!isAiTurn) return;

    setState((s) => ({ ...s, thinking: true }));
    const level = LEVELS[turn === "w" ? levelIdxW : levelIdxB];
    const id = setTimeout(async () => {
      const client = aiClientRef.current;
      if (!client) {
        setState((prev) => ({ ...prev, thinking: false }));
        return;
      }
      const s = stateRef.current;
      const res = await client.send({
        type: "getMove",
        board: s.board,
        color: s.turn,
        castling: s.castling,
        depth: level.depth,
        enPassant: s.enPassant,
        timeLimitMs: level.maxTimeMs,
      });
      if (res.type !== "move" || !res.move) {
        setState((prev) => ({ ...prev, thinking: false }));
        return;
      }
      const { state: newState, entry } = applyGameMove(s, res.move.from, res.move.to, []);
      // Prefer the search's own evaluation (accounts for tactics) over the
      // instant material-only estimate applyGameMove falls back to.
      setState({ ...newState, evalScore: res.score, thinking: false });
      setHistory((h) => {
        const nh = [...h, { ...entry, evalScore: res.score }];
        setViewIdx(nh.length - 1);
        return nh;
      });
      classifyPlayedMove(s, s.turn, res.move);
    }, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn, isOver, gameStarted, gameMode, playerColor, levelIdxW, levelIdxB]);

  // Always-current ref so event handlers can read state without stale closures
  const stateRef = useRef(state);
  stateRef.current = state;

  // Move-quality badge (Brilliant/Best/Blunder/…) for whatever move is
  // currently being viewed (live or browsing history/replay), shown on its
  // destination square by ChessBoard, chess.com style.
  const currentAnnotation = viewIdx >= 0 ? annotations[viewIdx] ?? null : null;

  const toBoard = (dr: number, dc: number): [number, number] =>
    flipBoard ? [7 - dr, 7 - dc] : [dr, dc];

  const commitMove = useCallback(
    (from: [number, number], to: [number, number]) => {
      const s = stateRef.current;
      if (!s.board[from[0]][from[1]]) return;
      const { state: newState, entry } = applyGameMove(s, from, to, []);
      setState(newState);
      setHistory((h) => {
        const nh = [...h, entry];
        setViewIdx(nh.length - 1);
        return nh;
      });
      classifyPlayedMove(s, s.turn, { from, to });
    },
    [classifyPlayedMove],
  );

  const handleClick = useCallback(
    (dr: number, dc: number) => {
      setArrows([]);
      setCircles([]);
      if (!isHumanTurn || drag) return;
      const [r, c] = toBoard(dr, dc);
      const s = stateRef.current;
      if (s.selected && s.highlights.some(([hr, hc]) => hr === r && hc === c)) {
        commitMove(s.selected, [r, c]);
        return;
      }
      const piece = s.board[r][c];
      if (piece?.color === playerColor)
        setState((prev) => ({
          ...prev,
          selected: [r, c],
          highlights: legalMoves(s.board, r, c, s.castling, s.enPassant),
        }));
      else setState((prev) => ({ ...prev, selected: null, highlights: [] }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isHumanTurn, drag, flipBoard, playerColor, commitMove],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, dr: number, dc: number) => {
      if (e.button !== 0 || !isHumanTurn) return;
      const [r, c] = toBoard(dr, dc);
      const s = stateRef.current;
      const piece = s.board[r][c];
      if (!piece || piece.color !== playerColor) return;
      e.preventDefault();
      setArrows([]);
      setCircles([]);
      setState((prev) => ({
        ...prev,
        selected: [r, c],
        highlights: legalMoves(s.board, r, c, s.castling, s.enPassant),
      }));
      setDrag({ r, c, x: e.clientX, y: e.clientY });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isHumanTurn, flipBoard, playerColor],
  );

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) =>
      setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : null));
    const onUp = (e: PointerEvent) => {
      const captured = drag;
      setDrag(null);
      if (!boardRef.current) return;
      const rect = boardRef.current.getBoundingClientRect();
      const dc = Math.floor((e.clientX - rect.left) / SQ);
      const dr = Math.floor((e.clientY - rect.top) / SQ);
      if (dr < 0 || dr >= 8 || dc < 0 || dc >= 8) return;
      const boardRow = flipBoard ? 7 - dr : dr;
      const boardCol = flipBoard ? 7 - dc : dc;
      const s = stateRef.current;
      if (s.highlights.some(([hr, hc]) => hr === boardRow && hc === boardCol))
        commitMove([captured.r, captured.c], [boardRow, boardCol]);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, flipBoard, commitMove]);

  const handleRightMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 2) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dc = Math.floor((e.clientX - rect.left) / SQ);
    const dr = Math.floor((e.clientY - rect.top) / SQ);
    if (dr < 0 || dr >= 8 || dc < 0 || dc >= 8) return;
    rightStart.current = [flipBoard ? 7 - dr : dr, flipBoard ? 7 - dc : dc];
  };

  const handleRightMouseUp = (e: React.MouseEvent) => {
    if (e.button !== 2 || !rightStart.current) return;
    const [sbr, sbc] = rightStart.current;
    rightStart.current = null;
    const rect = e.currentTarget.getBoundingClientRect();
    const dc = Math.floor((e.clientX - rect.left) / SQ);
    const dr = Math.floor((e.clientY - rect.top) / SQ);
    if (dr < 0 || dr >= 8 || dc < 0 || dc >= 8) return;
    const br = flipBoard ? 7 - dr : dr;
    const bc = flipBoard ? 7 - dc : dc;
    if (br === sbr && bc === sbc) {
      setCircles((cs) => {
        const idx = cs.findIndex(([cr, cc]) => cr === br && cc === bc);
        return idx >= 0 ? cs.filter((_, i) => i !== idx) : [...cs, [br, bc]];
      });
    } else {
      setArrows((as) => {
        const idx = as.findIndex(
          ([[fr, fc], [tr, tc]]) =>
            fr === sbr && fc === sbc && tr === br && tc === bc,
        );
        return idx >= 0
          ? as.filter((_, i) => i !== idx)
          : [
              ...as,
              [
                [sbr, sbc],
                [br, bc],
              ],
            ];
      });
    }
  };

  const [pgnCopied, setPgnCopied] = useState(false);
  const handleCopyPGN = async () => {
    const pgn = toPGN(
      history.map((h) => h.san),
      {
        gameMode,
        playerColor,
        result: resultFromStatus(status, turn),
        date: new Date().toISOString().slice(0, 10).replace(/-/g, "."),
      },
    );
    try {
      await navigator.clipboard.writeText(pgn);
      setPgnCopied(true);
      setTimeout(() => setPgnCopied(false), 1500);
    } catch (error) {
      console.error("Copy to clipboard failed", error);
    }
  };

  const evalScore = isLive
    ? state.evalScore
    : viewIdx === -1
      ? 0
      : history[viewIdx].evalScore;

  const statusText = (() => {
    if (status === "checkmate") {
      if (gameMode === "aiai")
        return `Checkmate — ${turn === "w" ? "Black" : "White"} wins!`;
      return turn === playerColor
        ? "Checkmate — Computer wins!"
        : "Checkmate — You win!";
    }
    if (status === "stalemate") return "Stalemate — Draw!";
    if (gameMode === "aiai") {
      const side = turn === "w" ? "White" : "Black";
      return status === "check"
        ? `Check! ${side} thinking...`
        : `${side} thinking...`;
    }
    if (turn !== playerColor)
      return status === "check"
        ? "Check! Computer thinking..."
        : "Computer thinking...";
    const you = playerColor === "w" ? "White" : "Black";
    return status === "check"
      ? `Check — your move (${you})`
      : `Your turn (${you})`;
  })();

  const clamped = Math.max(-10, Math.min(10, evalScore));
  const whitePct = ((10 + clamped) / 20) * 100;
  const blackPct = 100 - whitePct;
  const evalLabel =
    Math.abs(evalScore) < 0.1
      ? "="
      : evalScore > 0
        ? `+${evalScore.toFixed(1)}`
        : evalScore.toFixed(1);

  const files = flipBoard
    ? ["h", "g", "f", "e", "d", "c", "b", "a"]
    : ["a", "b", "c", "d", "e", "f", "g", "h"];

  const aiIsBlack = gameMode === "pvai" && playerColor === "w";
  const aiIsWhite = gameMode === "pvai" && playerColor === "b";

  // When navigating, don't show selection highlights, but do show the move
  // that led to whatever position is currently being viewed.
  const displaySelected = isLive ? state.selected : null;
  const displayHighlights = isLive ? state.highlights : [];
  const displayLastMoveFinal = isLive
    ? state.lastMove
    : viewIdx >= 0
      ? history[viewIdx].move
      : null;

  const handleImportPGN = (pgn: string): string | null => {
    const result = replayPGN(pgn);
    if (result.error) {
      return result.error;
    }

    aiClientRef.current?.send({ type: "clear" });
    pendingAnalysisRef.current = null;
    analysisGenerationRef.current++;
    setAnalysisProgress(null);
    gameCounted.current = false;

    const finalStatus = gameStatus(result.board, result.turn, result.castling, result.enPassant);
    const finalEval = materialEval(result.board);

    setState({
      board: result.board,
      castling: result.castling,
      enPassant: result.enPassant,
      turn: result.turn,
      selected: null,
      highlights: [],
      lastMove: null,
      status: finalStatus,
      thinking: false,
      evalScore: finalEval,
    });
    setHistory(result.history);
    setAnnotations(new Array(result.history.length).fill(null));
    setViewIdx(result.history.length - 1);
    setBoardFlipped(gameMode === "pvai" && playerColor === "b");
    setGameStarted(true);
    return null;
  };

  if (!gameStarted) {
    return (
      <SetupScreen
        gameMode={gameMode}
        setGameMode={setGameMode}
        playerColor={playerColor}
        setPlayerColor={setPlayerColor}
        levelIdxW={levelIdxW}
        setLevelIdxW={setLevelIdxW}
        levelIdxB={levelIdxB}
        setLevelIdxB={setLevelIdxB}
        onStart={() => {
          aiClientRef.current?.send({ type: "clear" });
          pendingAnalysisRef.current = null;
          analysisGenerationRef.current++;
          setAnalysisProgress(null);
          gameCounted.current = false;
          setState(freshState());
          setHistory([]);
          setAnnotations([]);
          setViewIdx(-1);
          setBoardFlipped(gameMode === "pvai" && playerColor === "b");
          setGameStarted(true);
        }}
        onImportPGN={handleImportPGN}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-5 p-4 select-none">
      <h1 className="text-white text-4xl font-bold tracking-wider">Chess</h1>

      <div
        className={`px-5 py-2 rounded-full text-sm font-semibold flex items-center gap-2 transition-colors
        ${isOver ? "bg-amber-600 text-white" : status === "check" ? "bg-red-700 text-white" : "bg-gray-800 text-gray-200"}`}
      >
        {statusText}
        {thinking && <span className="animate-pulse">●</span>}
        {!isLive && <span className="text-amber-400 ml-1">[History]</span>}
      </div>

      <div className="flex items-start gap-3">
        {/* Eval bar */}
        <div
          className="flex flex-col items-center gap-1"
          style={{ height: SQ * 8 }}
        >
          <div
            style={{
              width: 18,
              height: SQ * 8,
              borderRadius: 6,
              overflow: "hidden",
              border: "1px solid #374151",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: `${blackPct}%`,
                backgroundColor: "#1c1c1c",
                transition: "height 0.4s ease",
              }}
            />
            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: `${whitePct}%`,
                backgroundColor: "#f0ead8",
                transition: "height 0.4s ease",
              }}
            />
          </div>
          <span className="text-xs text-gray-400 font-mono mt-1">
            {evalLabel}
          </span>
        </div>

        <ChessBoard
          board={displayBoard}
          selected={displaySelected}
          highlights={displayHighlights}
          lastMove={displayLastMoveFinal}
          annotation={currentAnnotation}
          drag={isLive ? drag : null}
          arrows={isLive ? arrows : []}
          circles={isLive ? circles : []}
          flipBoard={flipBoard}
          isHumanTurn={isHumanTurn}
          playerColor={playerColor}
          boardRef={boardRef}
          onClick={handleClick}
          onPointerDown={handlePointerDown}
          onRightMouseDown={handleRightMouseDown}
          onRightMouseUp={handleRightMouseUp}
        />

        {/* Move history panel */}
        <MoveHistory
          sans={history.map((h) => h.san)}
          annotations={annotations}
          viewIdx={viewIdx}
          onNavigate={setViewIdx}
          onCopyPGN={handleCopyPGN}
          pgnCopied={pgnCopied}
          onAnalyzeGame={() => runFullAnalysis(history)}
          analysisProgress={analysisProgress}
          gameMode={gameMode}
          playerColor={playerColor}
          status={status}
          totalMoves={history.length}
        />
      </div>

      {/* File labels */}
      <div
        className="flex font-mono text-xs text-gray-600"
        style={{ marginLeft: 18 + 12, width: SQ * 8 }}
      >
        {files.map((f) => (
          <span key={f} style={{ width: SQ }} className="text-center">
            {f}
          </span>
        ))}
      </div>

      <Scoreboard
        score={score}
        gameMode={gameMode}
        playerColor={playerColor}
        onReset={() => setScore({ white: 0, black: 0, draws: 0 })}
      />

      <div className="flex flex-col gap-2">
        {gameMode === "aiai" ? (
          <>
            <LevelSelector
              label="White AI"
              levelIdx={levelIdxW}
              setLevelIdx={setLevelIdxW}
            />
            <LevelSelector
              label="Black AI"
              levelIdx={levelIdxB}
              setLevelIdx={setLevelIdxB}
            />
          </>
        ) : aiIsBlack ? (
          <LevelSelector
            label="Computer"
            levelIdx={levelIdxB}
            setLevelIdx={setLevelIdxB}
            disabled={thinking}
          />
        ) : aiIsWhite ? (
          <LevelSelector
            label="Computer"
            levelIdx={levelIdxW}
            setLevelIdx={setLevelIdxW}
            disabled={thinking}
          />
        ) : null}
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => setBoardFlipped(f => !f)}
          className="px-6 py-2 bg-gray-800 hover:bg-gray-700 active:bg-gray-900 border border-gray-700 text-white font-semibold rounded-lg transition-colors text-sm flex items-center gap-1.5"
        >
          🔄 Flip Board
        </button>
        <button
          onClick={() => {
            pendingAnalysisRef.current = null;
            analysisGenerationRef.current++;
            setAnalysisProgress(null);
            setState(freshState());
            setHistory([]);
            setAnnotations([]);
            setViewIdx(-1);
            setDrag(null);
            setArrows([]);
            setCircles([]);
            setGameStarted(false);
          }}
          className="px-6 py-2 bg-gray-700 hover:bg-gray-600 active:bg-gray-800 text-white font-semibold rounded-lg transition-colors text-sm"
        >
          New Game
        </button>
      </div>

      {/* Floating drag piece */}
      {drag &&
        isLive &&
        (() => {
          const piece = state.board[drag.r][drag.c];
          return piece ? (
            <div
              style={{
                position: "fixed",
                left: drag.x - SQ / 2,
                top: drag.y - SQ / 2,
                width: SQ,
                height: SQ,
                pointerEvents: "none",
                zIndex: 50,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <img
                src={`/pieces/${piece.color}${piece.type}.svg`}
                alt={`${piece.color === 'w' ? 'White' : 'Black'} ${piece.type}`}
                style={{
                  width: '86%',
                  height: '86%',
                  pointerEvents: 'none',
                }}
              />
            </div>
          ) : null;
        })()}
    </div>
  );
}
