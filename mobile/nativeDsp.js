// Équivalent natif (Accelerate, module local modules/stem-dsp) de jsDsp
// (separator.js) : même interface et mêmes résultats (à 1 pas Int16 près),
// ~13x plus rapide que le JS sous Node et bien davantage face à Hermes.
import StemDsp from './modules/stem-dsp';
import { MODEL_SHAPES } from '../separator.js';

const SEG = MODEL_SHAPES.waveform[2];
const SPEC = MODEL_SHAPES.magSpec.reduce((a, b) => a * b, 1);

export const nativeDsp = {
  segmentInput(left, right, start, segLen) {
    const waveform = new Float32Array(2 * SEG);
    const magSpec = new Float32Array(SPEC);
    StemDsp.segmentInput(left, right, start, segLen, waveform, magSpec);
    return { waveform, magSpec };
  },
  accumulate(freq, time, acc, wacc, segLen, isFirst, isLast) {
    StemDsp.accumulate(freq, time, acc, wacc, segLen, isFirst, isLast);
  },
  flush(acc, wacc, finalLen) {
    const out = new Int16Array(8 * finalLen);
    StemDsp.flush(acc, wacc, finalLen, out);
    return out;
  },
};

// Chroma profond (accords) : 10 trames par seconde, 12 notes.
export const CHROMA_FPS = 10;
export function loadDeepChroma(uri) {
  StemDsp.loadDeepChroma(uri);
}
export function deepChroma(left, right) {
  const frames = Math.ceil(left.length / (44100 / CHROMA_FPS));
  const out = new Float32Array(frames * 12);
  StemDsp.deepChroma(left, right, out);
  return out;
}

// Enregistre une piste séparée en AAC (.m4a, ~7x plus léger que le WAV).
export function saveStem(uri, left, right) {
  StemDsp.saveStem(uri, left, right);
}
