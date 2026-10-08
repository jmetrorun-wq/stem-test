// Accordages proposés par l'accordeur, du grave à l'aigu. Plages de
// recherche bornées autour des cordes (sinon la détection accroche une
// harmonique : erreur d'octave, cf. accordeur de ChordSplit).

const NOTE_INDEX = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
export const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export const noteFrequency = (midi) => 440 * 2 ** ((midi - 69) / 12);
const midiOf = (name, octave) => 12 * (octave + 1) + NOTE_INDEX[name];
const string = (name, octave) => ({ name, octave, midi: midiOf(name, octave), hz: noteFrequency(midiOf(name, octave)) });

export const TUNINGS = [
  { id: 'guitar', label: 'Guitare', fmin: 70, fmax: 400,
    strings: [string('E', 2), string('A', 2), string('D', 3), string('G', 3), string('B', 3), string('E', 4)] },
  { id: 'dropd', label: 'Drop D', fmin: 65, fmax: 400,
    strings: [string('D', 2), string('A', 2), string('D', 3), string('G', 3), string('B', 3), string('E', 4)] },
  { id: 'halfdown', label: '½ ton plus bas', fmin: 65, fmax: 380,
    strings: [string('Eb', 2), string('Ab', 2), string('Db', 3), string('Gb', 3), string('Bb', 3), string('Eb', 4)] },
  { id: 'bass', label: 'Basse', fmin: 35, fmax: 130,
    strings: [string('E', 1), string('A', 1), string('D', 2), string('G', 2)] },
  { id: 'ukulele', label: 'Ukulélé', fmin: 230, fmax: 500,
    strings: [string('G', 4), string('C', 4), string('E', 4), string('A', 4)] },
  { id: 'chromatic', label: 'Chromatique', fmin: 60, fmax: 1100, strings: [] },
];

/** Note la plus proche d'une fréquence (mode chromatique). */
export function nearestNote(hz) {
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return { name: NOTE_NAMES[((midi % 12) + 12) % 12], octave: Math.floor(midi / 12) - 1, midi, hz: noteFrequency(midi) };
}

/** Indice de la corde la plus proche (en cents). */
export function nearestString(strings, hz) {
  let best = 0, bestDist = Infinity;
  strings.forEach((s, i) => {
    const dist = Math.abs(1200 * Math.log2(hz / s.hz));
    if (dist < bestDist) { bestDist = dist; best = i; }
  });
  return best;
}

/**
 * Corde pincée (Karplus-Strong) pour le son de référence, comme
 * l'accordeur de ChordSplit : 2,4 s, attaque et extinction douces.
 */
export function pluck(freq, sampleRate) {
  const n = Math.max(2, Math.round(sampleRate / freq));
  const line = new Float32Array(n);
  for (let i = 0; i < n; i++) line[i] = Math.random() * 2 - 1;
  for (let p = 0; p < 2; p++) for (let i = 1; i < n; i++) line[i] = 0.5 * (line[i] + line[i - 1]);
  const len = Math.floor(sampleRate * 2.4);
  const out = new Float32Array(len);
  let idx = 0, peak = 0;
  for (let i = 0; i < len; i++) {
    const v = 0.996 * 0.5 * (line[idx] + line[(idx + n - 1) % n]);
    out[i] = v;
    line[idx] = v;
    idx = (idx + 1) % n;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  const gain = peak > 0 ? 0.92 / peak : 1;
  const fade = Math.floor(sampleRate * 0.3);
  for (let i = 0; i < len; i++) {
    let amp = gain;
    if (i < 240) amp *= i / 240;
    if (i > len - fade) amp *= (len - i) / fade;
    out[i] *= amp;
  }
  return out;
}
