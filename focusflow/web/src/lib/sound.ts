// All sounds are synthesized with Web Audio — no asset files to ship or license.
import type { AlarmSound, AmbientSound } from "@focusflow/shared";

let ctx: AudioContext | null = null;
function ac(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Call from a user gesture (e.g. Start button) so browsers allow audio later. */
export function unlockAudio() { ac(); }

function tone(freq: number, start: number, dur: number, vol: number, type: OscillatorType = "sine") {
  const a = ac();
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(vol, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

const ALARMS: Record<Exclude<AlarmSound, "none">, (t: number, v: number) => number> = {
  bell: (t, v) => {
    for (const [mult, amp] of [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.93, 0.12]] as const) tone(660 * mult, t, 2.2 / mult + 0.4, v * amp * 0.5);
    return 1.4;
  },
  chime: (t, v) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + i * 0.16, 1.2, v * 0.45));
    return 1.1;
  },
  digital: (t, v) => {
    for (let i = 0; i < 4; i++) tone(1760, t + i * 0.12, 0.08, v * 0.25, "square");
    return 0.9;
  },
  wood: (t, v) => {
    tone(880, t, 0.12, v * 0.8, "triangle");
    tone(1320, t + 0.18, 0.12, v * 0.6, "triangle");
    return 0.6;
  },
};

export function playAlarm(kind: AlarmSound, volume: number, repeat = 1) {
  if (kind === "none" || volume <= 0) return;
  let t = ac().currentTime + 0.05;
  for (let i = 0; i < repeat; i++) t += ALARMS[kind](t, volume);
}

export function playTick(volume: number) {
  if (volume <= 0) return;
  tone(2200, ac().currentTime, 0.03, volume * 0.15, "square");
}

export function playWarning(volume: number) {
  tone(988, ac().currentTime, 0.25, volume * 0.3);
}

// ---------- Ambient noise ----------

let ambient: { src: AudioBufferSourceNode; gain: GainNode; kind: AmbientSound } | null = null;

function noiseBuffer(kind: Exclude<AmbientSound, "none">): AudioBuffer {
  const a = ac();
  const len = a.sampleRate * 4;
  const buf = a.createBuffer(2, len, a.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === "white") d[i] = w * 0.5;
      else if (kind === "brown") { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else {
        // Paul Kellet's pink-noise filter
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        let p = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
        if (kind === "rain") p = p * 0.6 + (Math.random() < 0.0008 ? (Math.random() - 0.5) * 0.9 : 0); // droplets
        d[i] = p;
      }
    }
  }
  return buf;
}

export function setAmbient(kind: AmbientSound, volume: number) {
  if (ambient && (ambient.kind !== kind || kind === "none" || volume <= 0)) {
    const old = ambient;
    old.gain.gain.setTargetAtTime(0, ac().currentTime, 0.3);
    setTimeout(() => old.src.stop(), 1200);
    ambient = null;
  }
  if (kind === "none" || volume <= 0) return;
  const a = ac();
  if (!ambient) {
    const src = a.createBufferSource();
    src.buffer = noiseBuffer(kind);
    src.loop = true;
    const gain = a.createGain();
    gain.gain.value = 0;
    let node: AudioNode = src;
    if (kind === "rain") {
      const lp = a.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 5000;
      node = src.connect(lp);
    }
    node.connect(gain).connect(a.destination);
    src.start();
    ambient = { src, gain, kind };
  }
  ambient.gain.gain.setTargetAtTime(volume * 0.6, a.currentTime, 0.4);
}
