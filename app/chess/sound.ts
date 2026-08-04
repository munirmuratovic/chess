// Small synthesized sound effects (Web Audio oscillators) so the game
// doesn't need to ship audio assets. One shared AudioContext, lazily created
// on first use (browsers block audio before a user gesture anyway, and the
// first sound always follows a click/drag).
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(
  c: AudioContext,
  freq: number,
  startTime: number,
  duration: number,
  opts: { type?: OscillatorType; gain?: number } = {},
) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.value = freq;
  const peak = opts.gain ?? 0.18;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peak, startTime + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.03);
}

export function playMoveSound() {
  const c = getCtx();
  if (!c) return;
  tone(c, 520, c.currentTime, 0.09, { type: "triangle", gain: 0.16 });
}

// Two quick low "thuds" — one for the king, one for the rook shuffling next
// to it — pitched differently for kingside vs queenside so the two are
// distinguishable by ear, not just by which side of the board moved.
export function playCastleSound(kingside: boolean) {
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;
  const base = kingside ? 220 : 196; // A3 for O-O, G3 for O-O-O
  tone(c, base, t, 0.09, { type: "square", gain: 0.15 });
  tone(c, base * 0.84, t + 0.075, 0.13, { type: "square", gain: 0.15 });
}

// Brilliant — a bright 3-note ascending chime, clearly its own thing: higher
// pitched and longer than the plain move click, and a 3-note run instead of
// the 2-note castle thud, so it's unmistakable from either.
export function playBrilliantSound() {
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime;
  const notes = [783.99, 987.77, 1318.51]; // G5, B5, E6
  notes.forEach((freq, i) => tone(c, freq, t + i * 0.11, 0.3, { type: "sine", gain: 0.22 }));
}
