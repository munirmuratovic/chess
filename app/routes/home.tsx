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
import { getAiMove, ttClear } from "../chess/search";
import { toPGN, toSAN, replayPGN } from "../chess/notation";
import type {
  Board,
  Castling,
  Color,
  GameMode,
  GameStatus,
  HistoryEntry,
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

  // AI move effect
  useEffect(() => {
    if (!gameStarted || isOver || thinking) return;
    const isAiTurn = gameMode === "aiai" || turn !== playerColor;
    if (!isAiTurn) return;

    setState((s) => ({ ...s, thinking: true }));
    const depth = LEVELS[turn === "w" ? levelIdxW : levelIdxB].depth;
    const id = setTimeout(() => {
      const s = stateRef.current;
      const move = getAiMove(s.board, s.turn, s.castling, depth, s.enPassant);
      if (!move) {
        setState((prev) => ({ ...prev, thinking: false }));
        return;
      }
      const { state: newState, entry } = applyGameMove(
        s,
        move.from,
        move.to,
        [],
      );
      setState({ ...newState, thinking: false });
      setHistory((h) => {
        const nh = [...h, entry];
        setViewIdx(nh.length - 1);
        return nh;
      });
    }, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn, isOver, gameStarted, gameMode, playerColor, levelIdxW, levelIdxB]);

  // Always-current ref so event handlers can read state without stale closures
  const stateRef = useRef(state);
  stateRef.current = state;

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
    },
    [],
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

  const handleExportPGN = () => {
    const pgn = toPGN(
      history.map((h) => h.san),
      {
        gameMode,
        playerColor,
        result: resultFromStatus(status, turn),
        date: new Date().toISOString().slice(0, 10).replace(/-/g, "."),
      },
    );
    const blob = new Blob([pgn], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "game.pgn";
    a.click();
    URL.revokeObjectURL(url);
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

  // When navigating, don't show selection highlights
  const displaySelected = isLive ? state.selected : null;
  const displayHighlights = isLive ? state.highlights : [];
  const displayLastMoveFinal = isLive ? state.lastMove : null;

  const handleImportPGN = (pgn: string): string | null => {
    const result = replayPGN(pgn);
    if (result.error) {
      return result.error;
    }

    ttClear();
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
          ttClear();
          gameCounted.current = false;
          setState(freshState());
          setHistory([]);
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
          viewIdx={viewIdx}
          onNavigate={setViewIdx}
          onExportPGN={handleExportPGN}
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
            setState(freshState());
            setHistory([]);
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
