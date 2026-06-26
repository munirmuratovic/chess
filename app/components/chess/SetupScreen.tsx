import type { Color, GameMode } from '../../chess/types';
import { LevelSelector } from './LevelSelector';

interface SetupScreenProps {
  gameMode: GameMode;
  setGameMode: (m: GameMode) => void;
  playerColor: Color;
  setPlayerColor: (c: Color) => void;
  levelIdxW: number;
  setLevelIdxW: (i: number) => void;
  levelIdxB: number;
  setLevelIdxB: (i: number) => void;
  onStart: () => void;
}

export function SetupScreen({
  gameMode, setGameMode,
  playerColor, setPlayerColor,
  levelIdxW, setLevelIdxW,
  levelIdxB, setLevelIdxB,
  onStart,
}: SetupScreenProps) {
  const aiIsBlack = gameMode === 'pvai' && playerColor === 'w';
  const aiIsWhite = gameMode === 'pvai' && playerColor === 'b';

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-7 p-4 select-none">
      <h1 className="text-white text-4xl font-bold tracking-wider">Chess</h1>

      {/* Mode */}
      <div className="flex flex-col items-center gap-2">
        <span className="text-gray-400 text-xs uppercase tracking-widest">Mode</span>
        <div className="flex rounded-lg overflow-hidden border border-gray-700">
          {(
            [
              ['pvai', 'Me vs Computer'],
              ['aiai', 'Computer vs Computer'],
            ] as [GameMode, string][]
          ).map(([mode, lbl], i) => (
            <button
              key={mode}
              onClick={() => setGameMode(mode)}
              className={`px-5 py-2.5 text-sm font-semibold transition-colors
                ${i > 0 ? 'border-l border-gray-700' : ''}
                ${gameMode === mode
                  ? 'bg-amber-700 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'}`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* Color picker — pvai only */}
      {gameMode === 'pvai' && (
        <div className="flex flex-col items-center gap-2">
          <span className="text-gray-400 text-xs uppercase tracking-widest">Play as</span>
          <div className="flex gap-3">
            {(
              [
                ['w', '♔', 'White'],
                ['b', '♚', 'Black'],
              ] as [Color, string, string][]
            ).map(([col, glyph, lbl]) => (
              <button
                key={col}
                onClick={() => setPlayerColor(col)}
                className={`w-28 py-3 rounded-xl border-2 flex flex-col items-center gap-1 transition-all
                  ${playerColor === col
                    ? 'border-amber-500 bg-amber-900/30 text-white'
                    : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500 hover:text-gray-200'}`}
              >
                <span className="text-3xl leading-none">{glyph}</span>
                <span className="text-xs font-semibold tracking-wide">{lbl}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* AI strength selector(s) */}
      <div className="flex flex-col gap-3">
        {gameMode === 'aiai' ? (
          <>
            <LevelSelector label="White AI" levelIdx={levelIdxW} setLevelIdx={setLevelIdxW} />
            <LevelSelector label="Black AI" levelIdx={levelIdxB} setLevelIdx={setLevelIdxB} />
          </>
        ) : aiIsBlack ? (
          <LevelSelector label="Computer" levelIdx={levelIdxB} setLevelIdx={setLevelIdxB} />
        ) : aiIsWhite ? (
          <LevelSelector label="Computer" levelIdx={levelIdxW} setLevelIdx={setLevelIdxW} />
        ) : null}
      </div>

      <button
        onClick={onStart}
        className="mt-2 px-10 py-3 bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-800 text-white font-bold rounded-xl text-lg transition-colors shadow-lg"
      >
        Start Game
      </button>
    </div>
  );
}
