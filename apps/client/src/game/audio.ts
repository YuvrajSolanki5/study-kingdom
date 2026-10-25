import { useGame } from '../state/store.ts';

// Original sound effects synthesised with WebAudio: no audio files to license.

let ctx: AudioContext | null = null;
const lastPlayed = new Map<string, number>();

function audio(): AudioContext | null {
  if (useGame.getState().muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  a: AudioContext,
  freq: number,
  dur: number,
  opts: { type?: OscillatorType; gain?: number; slide?: number; delay?: number } = {},
) {
  const t = a.currentTime + (opts.delay ?? 0);
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * opts.slide), t + dur);
  g.gain.setValueAtTime(opts.gain ?? 0.15, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(a: AudioContext, dur: number, gain = 0.2, lowpass = 1200) {
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = lowpass;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

export type Sfx =
  | 'select'
  | 'place'
  | 'build'
  | 'error'
  | 'coins'
  | 'deploy'
  | 'shot'
  | 'hit'
  | 'boom'
  | 'thunder'
  | 'victory'
  | 'defeat'
  | 'chime'
  | 'start';

export function sfx(name: Sfx) {
  const a = audio();
  if (!a) return;
  // Rate-limit busy effects so large battles stay pleasant.
  const now = performance.now();
  const minGap = name === 'shot' || name === 'hit' ? 60 : name === 'deploy' ? 40 : 0;
  if (minGap && now - (lastPlayed.get(name) ?? 0) < minGap) return;
  lastPlayed.set(name, now);
  switch (name) {
    case 'select':
      tone(a, 660, 0.06, { type: 'triangle', gain: 0.06 });
      break;
    case 'place':
      tone(a, 220, 0.08, { type: 'square', gain: 0.05 });
      break;
    case 'build':
      tone(a, 330, 0.08, { type: 'square', gain: 0.06 });
      tone(a, 440, 0.1, { type: 'square', gain: 0.06, delay: 0.09 });
      break;
    case 'error':
      tone(a, 180, 0.15, { type: 'sawtooth', gain: 0.05, slide: 0.7 });
      break;
    case 'coins':
      [988, 1319, 1568].forEach((f, i) =>
        tone(a, f, 0.12, { type: 'triangle', gain: 0.07, delay: i * 0.07 }),
      );
      break;
    case 'deploy':
      tone(a, 520, 0.05, { type: 'triangle', gain: 0.05, slide: 1.4 });
      break;
    case 'shot':
      noise(a, 0.05, 0.05, 3000);
      break;
    case 'hit':
      tone(a, 140, 0.06, { type: 'square', gain: 0.03, slide: 0.6 });
      break;
    case 'boom':
      noise(a, 0.4, 0.25, 600);
      tone(a, 80, 0.3, { gain: 0.15, slide: 0.5 });
      break;
    case 'thunder':
      noise(a, 0.6, 0.3, 2000);
      break;
    case 'victory':
      [523, 659, 784, 1047].forEach((f, i) =>
        tone(a, f, 0.25, { type: 'triangle', gain: 0.09, delay: i * 0.12 }),
      );
      break;
    case 'defeat':
      [392, 330, 262].forEach((f, i) => tone(a, f, 0.3, { type: 'triangle', gain: 0.08, delay: i * 0.18 }));
      break;
    case 'chime':
      tone(a, 880, 0.6, { gain: 0.08 });
      tone(a, 1320, 0.8, { gain: 0.05, delay: 0.15 });
      break;
    case 'start':
      tone(a, 440, 0.12, { type: 'triangle', gain: 0.08 });
      tone(a, 660, 0.18, { type: 'triangle', gain: 0.08, delay: 0.1 });
      break;
  }
}
