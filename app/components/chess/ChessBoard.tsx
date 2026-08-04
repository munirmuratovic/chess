import { useLayoutEffect, useRef, useState } from 'react';
import type { Board, Color } from '../../chess/types';
import type { MoveAnnotation } from '../../chess/annotate';
import { ARROW_COLOR, ARROW_SW, HEAD_HALF, HEAD_LEN, SQ } from './constants';

const MOVE_ANIM_MS = 180;

interface ChessBoardProps {
  board: Board;
  selected: [number, number] | null;
  highlights: [number, number][];
  lastMove: { from: [number, number]; to: [number, number] } | null;
  annotation?: MoveAnnotation | null; // move-quality badge for lastMove.to, chess.com style
  // The single step (if any) that should be slide-animated: a single move
  // forward (live move / Next) or the reverse of a single move back
  // (Previous). Null for drag-placed moves, multi-step jumps, or anything
  // else where a one-shot slide wouldn't make sense.
  animateMove?: { from: [number, number]; to: [number, number] } | null;
  drag: { r: number; c: number; x: number; y: number } | null;
  arrows: Array<[[number, number], [number, number]]>;
  circles: Array<[number, number]>;
  // Arrow drawn for the move currently being reviewed, colored to match its
  // move-quality annotation (brilliant/blunder/etc.) when one is available.
  annotatedArrow?: { from: [number, number]; to: [number, number]; color: string | null } | null;
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
  board, selected, highlights, lastMove, annotation, drag,
  arrows, circles, flipBoard, isHumanTurn, playerColor,
  boardRef, onClick, onPointerDown, onRightMouseDown, onRightMouseUp,
  annotatedArrow, animateMove,
}: ChessBoardProps) {
  const annotatedArrowColor = annotatedArrow?.color ?? ARROW_COLOR;

  // Slide animation: on a new (non-silent) lastMove, briefly render the moved
  // piece as a floating ghost that glides from `from` to `to`, while hiding
  // the real piece already sitting at the destination square underneath.
  const [anim, setAnim] = useState<{
    from: [number, number];
    to: [number, number];
    color: Color;
    type: string;
  } | null>(null);
  const [animPhase, setAnimPhase] = useState<'start' | 'end'>('start');
  const prevMoveKeyRef = useRef<string | null>(null);

  // useLayoutEffect (not useEffect) so the ghost is mounted and the real
  // destination piece hidden before the browser paints — otherwise the piece
  // flashes at its destination for one frame, then the ghost pops in at the
  // source and slides over: a visible "double move" glitch. This was easy to
  // miss with drag/click moves (they're silent — no animation at all) but
  // showed up clearly on AI moves, which always animate.
  useLayoutEffect(() => {
    if (!animateMove) {
      prevMoveKeyRef.current = null;
      // If a move animation was still in flight when the caller decided
      // there's nothing (more) to animate, don't leave it stuck hiding a
      // piece forever — drop it immediately.
      setAnim(null);
      return;
    }
    const key = `${animateMove.from.join(',')}>${animateMove.to.join(',')}`;
    if (prevMoveKeyRef.current === key) return;
    prevMoveKeyRef.current = key;
    const piece = board[animateMove.to[0]][animateMove.to[1]];
    if (!piece) return;

    setAnimPhase('start');
    setAnim({ from: animateMove.from, to: animateMove.to, color: piece.color, type: piece.type });
    const raf1 = requestAnimationFrame(() =>
      requestAnimationFrame(() => setAnimPhase('end')),
    );
    const timer = setTimeout(() => setAnim(null), MOVE_ANIM_MS + 40);
    return () => {
      cancelAnimationFrame(raf1);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animateMove, board]);

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
            const isAnimTarget = anim && anim.to[0] === r && anim.to[1] === c;
            const isLastMove =
              lastMove &&
              ((lastMove.from[0] === r && lastMove.from[1] === c) ||
                (lastMove.to[0] === r && lastMove.to[1] === c));
            const bg = sel
              ? '#f6f669'
              : isLastMove
                ? light ? '#cdd26a' : '#aaa23a'
                : light ? '#f0d9b5' : '#b58863';
            const canGrab = piece && isHumanTurn && piece.color === playerColor;
            return (
              <div
                key={c}
                style={{
                  width: SQ,
                  height: SQ,
                  backgroundColor: bg,
                  position: 'relative',
                  cursor: canGrab ? 'grab' : 'default'
                }}
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
                {piece && !isDragged && !isAnimTarget && (
                  <img
                    src={`/pieces/${piece.color}${piece.type}.svg`}
                    alt={`${piece.color === 'w' ? 'White' : 'Black'} ${piece.type}`}
                    style={{
                      width: '100%',
                      height: '100%',
                      pointerEvents: 'none',
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      ))}

      {/* Sliding ghost piece for the move-in-progress animation */}
      {anim && (() => {
        const [sr, sc] = anim.from;
        const [er, ec] = anim.to;
        const sdr = flipBoard ? 7 - sr : sr;
        const sdc = flipBoard ? 7 - sc : sc;
        const edr = flipBoard ? 7 - er : er;
        const edc = flipBoard ? 7 - ec : ec;
        const [dr, dc] = animPhase === 'end' ? [edr, edc] : [sdr, sdc];
        return (
          <img
            src={`/pieces/${anim.color}${anim.type}.svg`}
            alt=""
            style={{
              position: 'absolute',
              left: dc * SQ,
              top: dr * SQ,
              width: SQ,
              height: SQ,
              transition: `left ${MOVE_ANIM_MS}ms ease, top ${MOVE_ANIM_MS}ms ease`,
              pointerEvents: 'none',
              zIndex: 15,
            }}
          />
        );
      })()}

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
          <marker
            id="ah-annotated" markerUnits="userSpaceOnUse"
            markerWidth={HEAD_LEN} markerHeight={HEAD_HALF * 2}
            refX={0} refY={HEAD_HALF} orient="auto"
          >
            <polygon
              points={`0,0 ${HEAD_LEN},${HEAD_HALF} 0,${HEAD_HALF * 2}`}
              fill={annotatedArrowColor}
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
        {annotatedArrow && (() => {
          const [fbr, fbc] = annotatedArrow.from;
          const [tbr, tbc] = annotatedArrow.to;
          const fdr = flipBoard ? 7 - fbr : fbr;
          const fdc = flipBoard ? 7 - fbc : fbc;
          const tdr = flipBoard ? 7 - tbr : tbr;
          const tdc = flipBoard ? 7 - tbc : tbc;
          const x1 = (fdc + 0.5) * SQ, y1 = (fdr + 0.5) * SQ;
          const x2 = (tdc + 0.5) * SQ, y2 = (tdr + 0.5) * SQ;
          const dx = x2 - x1, dy = y2 - y1;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len === 0) return null;
          const ux = dx / len, uy = dy / len;
          return (
            <line
              x1={x1 + ux * SQ * 0.22} y1={y1 + uy * SQ * 0.22}
              x2={x2 - ux * HEAD_LEN} y2={y2 - uy * HEAD_LEN}
              stroke={annotatedArrowColor} strokeWidth={ARROW_SW}
              strokeLinecap="round" markerEnd="url(#ah-annotated)"
            />
          );
        })()}
      </svg>

      {/* Move-quality badge on the destination square, chess.com style */}
      {annotation && lastMove && (() => {
        const [tr, tc] = lastMove.to;
        const ddr = flipBoard ? 7 - tr : tr;
        const ddc = flipBoard ? 7 - tc : tc;
        const size = SQ * 0.4;
        const margin = SQ * 0.05;
        return (
          <div
            key={`${tr}${tc}${annotation.class}`}
            title={annotation.label}
            className="move-badge-pop"
            style={{
              position: 'absolute',
              left: ddc * SQ + SQ - size - margin,
              top: ddr * SQ + margin,
              width: size,
              height: size,
              borderRadius: '50%',
              background: annotation.gradient,
              border: `2px solid ${annotation.ring}`,
              boxShadow: `0 2px 6px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.15), inset 0 1px 1px rgba(255,255,255,0.35)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 30,
              pointerEvents: 'none',
              color: 'white',
              fontWeight: 800,
              fontSize: size * 0.5,
              lineHeight: 1,
              textShadow: '0 1px 2px rgba(0,0,0,0.45)',
            }}
          >
            {annotation.icon}
          </div>
        );
      })()}
    </div>
  );
}
