import { LEVELS } from './constants';

interface LevelSelectorProps {
  label: string;
  levelIdx: number;
  setLevelIdx: (i: number) => void;
  disabled?: boolean;
}

export function LevelSelector({ label, levelIdx, setLevelIdx, disabled }: LevelSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-gray-500 text-xs uppercase tracking-widest w-24 text-right shrink-0">
        {label}
      </span>
      <div className="flex rounded-lg overflow-hidden border border-gray-700">
        {LEVELS.map((lvl, i) => (
          <button
            key={lvl.label}
            onClick={() => setLevelIdx(i)}
            disabled={disabled}
            className={`px-3 py-1.5 text-sm font-semibold transition-colors
              ${i === levelIdx
                ? 'bg-amber-700 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'}
              ${i > 0 ? 'border-l border-gray-700' : ''}`}
          >
            {lvl.label}
          </button>
        ))}
      </div>
    </div>
  );
}
