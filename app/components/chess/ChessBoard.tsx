import type { Board, Color } from '../../chess/types';
import { ARROW_COLOR, ARROW_SW, GLYPH, HEAD_HALF, HEAD_LEN, SQ } from './constants';

interface ChessBoardProps {
  board: Board;
  selected: [number, number] | null;
  highlights: [number, number][];
  lastMove: { from: [number, number]; to: [number, number] } | null;
  drag: { r: number; c: number; x: number; y: number } | null;
  arrows: Array<[[number, number], [number, number]]>;
  circles: Array<[number, number]>;
  flipBoard: boolean;
  isHumanTurn: boolean;
  playerColor: Color;
  boardRef: React.RefObject<HTMLDivElement | null>;
  onClick: (dr: number, dc: number) => void;
  onPointerDown: (e: React.PointerEvent, dr: number, dc: number) => void;
  onRightMouseDown: (e: React.MouseEvent) => void;
  onRightMouseUp: (e: React.MouseEvent) => void;
}

export function ChessBoard({
  board, selected, highlights, lastMove, drag,
  arrows, circles, flipBoard, isHumanTurn, playerColor,
  boardRef, onClick, onPointerDown, onRightMouseDown, onRightMouseUp,
}: ChessBoardProps) {
  return (
    <div
      ref={boardRef}
      className="shadow-2xl border-2 border-gray-700 rounded-sm overflow-hidden cursor-default"
      style={{ position: 'relative' }}
      onContextMenu={(e) => e.preventDefault()}
      onMouseDown={onRightMouseDown}
      onMouseUp={onRightMouseUp}
    >
      {Array.from({ length: 8 }, (_, dr) => (
        <div key={dr} className="flex">
          {Array.from({ length: 8 }, (_, dc) => {
            const r = flipBoard ? 7 - dr : dr;
            const c = flipBoard ? 7 - dc : dc;
            const light = (r + c) % 2 === 0;
            const piece = board[r][c];
            const sel = selected?.[0] === r && selected?.[1] === c;
            const hi = highlights.some(([hr, hc]) => hr === r && hc === c);
            const isDragged = drag?.r === r && drag?.c === c;
            const isLastMove =
              lastMove &&
              ((lastMove.from[0] === r && lastMove.from[1] === c) ||
                (lastMove.to[0] === r && lastMove.to[1] === c));
            const bg = sel
              ? '#f6f669'
              : isLastMove
                ? light ? '#cdd26a' : '#aaa23a'
                : light ? '#f0d9b5' : '#b58863';
            return (
              <div
                key={c}
                style={{ width: SQ, height: SQ, backgroundColor: bg, position: 'relative' }}
                className="flex items-center justify-center"
                onClick={() => onClick(dr, dc)}
                onPointerDown={(e) => onPointerDown(e, dr, dc)}
              >
                {hi && !piece && (
                  <div className="absolute w-6 h-6 rounded-full bg-black/25 pointer-events-none" />
                )}
                {hi && piece && (
                  <div className="absolute inset-0 ring-4 ring-inset ring-black/40 pointer-events-none" />
                )}
                {piece && !isDragged && (
                  <span
                    style={{
                      fontSize: 52, lineHeight: 1,
                      color: piece.color === 'w' ? '#f0e8d0' : '#180f00',
                      filter:
                        piece.color === 'w'
                          ? 'drop-shadow(0 1px 2px rgba(0,0,0,0.9)) drop-shadow(0 0 1px rgba(0,0,0,0.6))'
                          : 'drop-shadow(0 1px 1px rgba(200,150,60,0.5))',
                      cursor: isHumanTurn && piece.color === playerColor ? 'grab' : 'default',
                      pointerEvents: 'none',
                    }}
                  >
                    {GLYPH[piece.color + piece.type]}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {/* Annotation overlay */}
      <svg
        style={{
          position: 'absolute', top: 0, left: 0,
          width: SQ * 8, height: SQ * 8,
          pointerEvents: 'none', zIndex: 20,
        }}
      >
        <defs>
          <marker
            id="ah" markerUnits="userSpaceOnUse"
            markerWidth={HEAD_LEN} markerHeight={HEAD_HALF * 2}
            refX={0} refY={HEAD_HALF} orient="auto"
          >
            <polygon
              points={`0,0 ${HEAD_LEN},${HEAD_HALF} 0,${HEAD_HALF * 2}`}
              fill={ARROW_COLOR}
            />
          </marker>
        </defs>
        {circles.map(([br, bc]) => {
          const dr = flipBoard ? 7 - br : br;
          const dc = flipBoard ? 7 - bc : bc;
          return (
            <circle
              key={`c${br}${bc}`}
              cx={(dc + 0.5) * SQ} cy={(dr + 0.5) * SQ}
              r={SQ * 0.38}
              fill="rgba(90,210,80,0.13)"
              stroke={ARROW_COLOR} strokeWidth={5}
            />
          );
        })}
        {arrows.map(([[fbr, fbc], [tbr, tbc]], i) => {
          const fdr = flipBoard ? 7 - fbr : fbr;
          const fdc = flipBoard ? 7 - fbc : fbc;
          const tdr = flipBoard ? 7 - tbr : tbr;
          const tdc = flipBoard ? 7 - tbc : tbc;
          const x1 = (fdc + 0.5) * SQ, y1 = (fdr + 0.5) * SQ;
          const x2 = (tdc + 0.5) * SQ, y2 = (tdr + 0.5) * SQ;
          const dx = x2 - x1, dy = y2 - y1;
          const len = Math.sqrt(dx * dx + dy * dy);
          const ux = dx / len, uy = dy / len;
          return (
            <line
              key={`a${i}`}
              x1={x1 + ux * SQ * 0.22} y1={y1 + uy * SQ * 0.22}
              x2={x2 - ux * HEAD_LEN}  y2={y2 - uy * HEAD_LEN}
              stroke={ARROW_COLOR} strokeWidth={ARROW_SW}
              strokeLinecap="round" markerEnd="url(#ah)"
            />
          );
        })}
      </svg>
    </div>
  );
}
