// Équivalent natif (Accelerate, module local modules/stem-dsp) de jsDsp
// (separator.js) : mêmes entrées/sorties, ~15x plus rapide que le JS sur Mac
// et bien davantage face à Hermes sur iPhone.
import StemDsp from './modules/stem-dsp';
import { MODEL_SHAPES } from '../separator.js';

const SEG = MODEL_SHAPES.waveform[2];
const SPEC = MODEL_SHAPES.magSpec.reduce((a, b) => a * b, 1);

export const nativeDsp = {
  prepareInput(left, right) {
    const magSpec = new Float32Array(SPEC);
    StemDsp.prepareInput(left, right, magSpec);
    const waveform = new Float32Array(2 * SEG);
    waveform.set(left, 0);
    waveform.set(right, SEG);
    return { waveform, magSpec };
  },
  freqToTime(freq) {
    const out = new Float32Array(8 * SEG);
    StemDsp.freqToTime(freq, out);
    return out;
  },
};
