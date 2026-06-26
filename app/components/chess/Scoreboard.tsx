import type { Color, GameMode, Score } from '../../chess/types';

interface ScoreboardProps {
  score: Score;
  gameMode: GameMode;
  playerColor: Color;
  onReset: () => void;
}

export function Scoreboard({ score, gameMode, playerColor, onReset }: ScoreboardProps) {
  let leftLabel: string, rightLabel: string, leftWins: number, rightWins: number;

  if (gameMode === 'aiai') {
    leftLabel = 'White'; leftWins = score.white;
    rightLabel = 'Black'; rightWins = score.black;
  } else if (playerColor === 'w') {
    leftLabel = 'You'; leftWins = score.white;
    rightLabel = 'Computer'; rightWins = score.black;
  } else {
    leftLabel = 'Computer'; leftWins = score.white;
    rightLabel = 'You'; rightWins = score.black;
  }

  const cell = (val: number, lbl: string) => (
    <div className="flex flex-col items-center gap-0.5 w-20">
      <span className="text-2xl font-bold tabular-nums text-white">{val}</span>
      <span className="text-xs text-gray-500 uppercase tracking-wider">{lbl}</span>
    </div>
  );

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-1 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3">
        {cell(leftWins, leftLabel)}
        <div className="w-px h-10 bg-gray-700 mx-1" />
        {cell(score.draws, 'Draws')}
        <div className="w-px h-10 bg-gray-700 mx-1" />
        {cell(rightWins, rightLabel)}
      </div>
      <button
        onClick={onReset}
        className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
      >
        Reset score
      </button>
    </div>
  );
}
