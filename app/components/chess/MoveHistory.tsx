import { useEffect, useRef } from 'react';
import type { GameMode, Color, GameStatus } from '../../chess/types';
import type { MoveAnnotation, MoveClass } from '../../chess/annotate';

// Display order for the post-analysis summary, best to worst.
const CLASS_ORDER: MoveClass[] = [
  'brilliant', 'great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder',
];

interface MoveHistoryProps {
  sans: string[];
  annotations?: (MoveAnnotation | null)[];
  viewIdx: number;           // index into sans; -1 = start position
  onNavigate: (idx: number) => void;
  onCopyPGN: () => void;
  pgnCopied?: boolean;
  onAnalyzeGame?: () => void;
  analysisProgress?: { done: number; total: number } | null;
  gameMode: GameMode;
  playerColor: Color;
  status: GameStatus;
  totalMoves: number;        // sans.length alias, avoids prop drilling
  highlightsOnly: boolean;   // when true, only show board badges for brilliant/great/blunder
  onHighlightsOnlyChange: (v: boolean) => void;
}

export function MoveHistory({
  sans,
  annotations,
  viewIdx,
  onNavigate,
  onCopyPGN,
  pgnCopied,
  onAnalyzeGame,
  analysisProgress,
  totalMoves,
  highlightsOnly,
  onHighlightsOnlyChange,
}: MoveHistoryProps) {
  const activeRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll active move into view — scrolled manually within the list's
  // own container rather than via scrollIntoView, which walks up every
  // scrollable ancestor (including the page itself) and was yanking the
  // whole mobile viewport around after every move.
  useEffect(() => {
    const el = activeRef.current;
    const container = listRef.current;
    if (!el || !container) return;
    const elTop = el.offsetTop;
    const elBottom = elTop + el.offsetHeight;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;
    if (elTop < viewTop) container.scrollTop = elTop;
    else if (elBottom > viewBottom) container.scrollTop = elBottom - container.clientHeight;
  }, [viewIdx]);

  // Pair moves into rows: [[w, b?], ...]
  const rows: { moveNum: number; white: string; black?: string }[] = [];
  for (let i = 0; i < sans.length; i += 2)
    rows.push({ moveNum: i / 2 + 1, white: sans[i], black: sans[i + 1] });

  const isActive = (sanIdx: number) => sanIdx === viewIdx;
  const isLive = viewIdx === totalMoves - 1;

  return (
    <div className="flex flex-col bg-gray-900 border border-gray-700 rounded-xl overflow-hidden w-full md:w-[220px]"
      style={{ maxWidth: 420, minHeight: 200 }}>

      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Moves</span>
        <button
          onClick={onCopyPGN}
          className="text-xs text-amber-500 hover:text-amber-300 transition-colors font-semibold"
          title="Copy PGN to clipboard"
        >
          {pgnCopied ? "Copied!" : "Copy PGN"}
        </button>
      </div>

      {/* Analyze game — runs move-quality classification (Brilliant/Best/…) over the whole game */}
      {onAnalyzeGame && (
        <div className="px-3 py-1.5 border-b border-gray-800">
          <button
            onClick={onAnalyzeGame}
            disabled={totalMoves === 0 || !!analysisProgress}
            className="w-full text-xs font-semibold py-1 rounded transition-colors
              bg-sky-700/30 text-sky-300 hover:bg-sky-700/50
              disabled:opacity-40 disabled:cursor-default disabled:hover:bg-sky-700/30"
          >
            {analysisProgress
              ? analysisProgress.done >= analysisProgress.total
                ? "Analysis complete"
                : `Analyzing… ${analysisProgress.done}/${analysisProgress.total}`
              : "🔍 Analyze Game"}
          </button>
        </div>
      )}

      {/* Highlights-only filter — restricts the on-board badge to brilliant/great/blunder moves; the list below always shows every move */}
      {annotations && annotations.some(Boolean) && (
        <label className="flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-800 text-xs text-gray-400 hover:text-gray-200 cursor-pointer select-none transition-colors">
          <input
            type="checkbox"
            checked={highlightsOnly}
            onChange={(e) => onHighlightsOnlyChange(e.target.checked)}
            className="accent-cyan-500 w-3.5 h-3.5"
          />
          Highlights only on board
          <span className="text-gray-600">(!!, !, ??)</span>
        </label>
      )}

      {/* Navigation controls */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-gray-800">
        <NavBtn onClick={() => onNavigate(-1)} disabled={viewIdx === -1} title="Start">⏮</NavBtn>
        <NavBtn onClick={() => onNavigate(Math.max(-1, viewIdx - 1))} disabled={viewIdx === -1} title="Previous">◀</NavBtn>
        <NavBtn onClick={() => onNavigate(Math.min(totalMoves - 1, viewIdx + 1))} disabled={isLive || totalMoves === 0} title="Next">▶</NavBtn>
        <NavBtn onClick={() => onNavigate(totalMoves - 1)} disabled={isLive || totalMoves === 0} title="Latest">⏭</NavBtn>
      </div>

      {/* Move list */}
      <div ref={listRef} className="flex-1 overflow-y-auto" style={{ maxHeight: 400 }}>
        {rows.length === 0 ? (
          <p className="text-gray-600 text-xs text-center py-6">No moves yet</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <tbody>
              {rows.map(({ moveNum, white, black }) => {
                const wIdx = (moveNum - 1) * 2;
                const bIdx = wIdx + 1;
                return (
                  <tr key={moveNum} className="border-b border-gray-800 last:border-0">
                    <td className="text-gray-600 text-xs pl-2 pr-1 py-1 w-8 select-none tabular-nums">
                      {moveNum}.
                    </td>
                    <td className="py-1 pr-1">
                      <MoveCell
                        san={white}
                        annotation={annotations?.[wIdx] ?? null}
                        active={isActive(wIdx)}
                        ref={isActive(wIdx) ? activeRef : undefined}
                        onClick={() => onNavigate(wIdx)}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      {black !== undefined && (
                        <MoveCell
                          san={black}
                          annotation={annotations?.[bIdx] ?? null}
                          active={isActive(bIdx)}
                          ref={isActive(bIdx) ? activeRef : undefined}
                          onClick={() => onNavigate(bIdx)}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Analysis summary — counts once finished, progress while running */}
      {(analysisProgress || annotations?.some(Boolean)) && (
        <div className="px-3 py-2 border-t border-gray-800">
          {analysisProgress && analysisProgress.done < analysisProgress.total ? (
            <div className="flex items-center gap-1.5 text-xs text-sky-300">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
              Analyzing… {analysisProgress.done}/{analysisProgress.total}
            </div>
          ) : (
            <MoveSummary annotations={annotations ?? []} />
          )}
        </div>
      )}

      {/* Live indicator */}
      {!isLive && totalMoves > 0 && (
        <button
          onClick={() => onNavigate(totalMoves - 1)}
          className="w-full py-1.5 text-xs text-amber-500 hover:text-amber-300 border-t border-gray-700 transition-colors"
        >
          ↓ Back to live
        </button>
      )}
    </div>
  );
}

function MoveSummary({ annotations }: { annotations: (MoveAnnotation | null)[] }) {
  const byClass = new Map<MoveClass, { count: number; sample: MoveAnnotation }>();
  for (const a of annotations) {
    if (!a) continue;
    const entry = byClass.get(a.class);
    if (entry) entry.count++;
    else byClass.set(a.class, { count: 1, sample: a });
  }
  if (byClass.size === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5">
      {CLASS_ORDER.filter((cls) => byClass.has(cls)).map((cls) => {
        const { count, sample } = byClass.get(cls)!;
        return (
          <div key={cls} className="flex items-center gap-1 text-xs text-gray-300" title={sample.label}>
            <span
              className="inline-flex items-center justify-center rounded-full font-bold shrink-0"
              style={{
                width: 15,
                height: 15,
                fontSize: 9,
                lineHeight: 1,
                color: 'white',
                background: sample.gradient,
                border: `1px solid ${sample.ring}`,
                boxShadow: '0 1px 2px rgba(0,0,0,0.4), inset 0 1px 1px rgba(255,255,255,0.3)',
                textShadow: '0 1px 1px rgba(0,0,0,0.4)',
              }}
            >
              {sample.icon}
            </span>
            {count}
          </div>
        );
      })}
    </div>
  );
}

function NavBtn({
  onClick, disabled, title, children,
}: { onClick: () => void; disabled: boolean; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="px-2 py-0.5 rounded text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 disabled:cursor-default transition-colors text-base"
    >
      {children}
    </button>
  );
}

const MoveCell = ({
  san, annotation, active, onClick, ref,
}: {
  san: string;
  annotation: MoveAnnotation | null;
  active: boolean;
  onClick: () => void;
  ref?: React.Ref<HTMLButtonElement>;
}) => (
  <button
    ref={ref}
    onClick={onClick}
    title={annotation?.label}
    className={`w-full text-left px-2 py-0.5 rounded font-mono transition-colors flex items-center gap-1.5
      ${active
        ? 'bg-amber-700 text-white'
        : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}
  >
    <span>{san}</span>
    {annotation && (
      <span
        className="inline-flex items-center justify-center rounded-full font-bold shrink-0"
        style={{
          width: 15,
          height: 15,
          fontSize: 9,
          lineHeight: 1,
          color: 'white',
          background: annotation.gradient,
          border: `1px solid ${active ? 'rgba(255,255,255,0.6)' : annotation.ring}`,
          boxShadow: '0 1px 2px rgba(0,0,0,0.4), inset 0 1px 1px rgba(255,255,255,0.3)',
          textShadow: '0 1px 1px rgba(0,0,0,0.4)',
        }}
      >
        {annotation.icon}
      </span>
    )}
  </button>
);
