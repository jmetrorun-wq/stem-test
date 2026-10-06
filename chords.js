// Accords et tonalité à partir du « chroma profond » (12 notes, 10 trames
// par seconde), portage de chord_detector.py de ChordSplit
// (_match_frame, _chroma_to_chord_segments, detect_key, couleurs et noms) :
// mêmes gabarits, même seuil, même fusion des segments courts.

export const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const CHORD_INTERVALS = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  7: [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  add9: [0, 4, 7, 14],
};
// Ordre d'insertion de Python (clés '7' comprise) : départage les égalités
// comme ChordSplit (premier gabarit au meilleur score).
const QUALITIES = ['', 'm', '7', 'm7', 'maj7', 'sus2', 'sus4', 'dim', 'aug', 'add9'];

const TEMPLATES = [];
NOTES.forEach((note, root) => {
  for (const quality of QUALITIES) {
    const tpl = new Float32Array(12);
    for (const iv of CHORD_INTERVALS[quality]) tpl[(root + iv) % 12] = 1;
    const norm = Math.hypot(...tpl);
    for (let i = 0; i < 12; i++) tpl[i] /= norm;
    TEMPLATES.push({ name: note + quality, tpl });
  }
});

// Similarité cosinus minimale, sinon 'N' (pas d'accord) : calibrée dans
// ChordSplit (élimine les faux positifs sur du bruit).
const MIN_CONFIDENCE = 0.78;
// Segments plus courts fusionnés au précédent (secondes).
const MIN_CHORD_DUR = 0.6;

function matchFrame(chroma, offset) {
  let norm = 0;
  for (let i = 0; i < 12; i++) norm += chroma[offset + i] ** 2;
  norm = Math.sqrt(norm);
  if (norm === 0) return 'N';
  let best = 'N', bestScore = MIN_CONFIDENCE;
  for (const { name, tpl } of TEMPLATES) {
    let score = 0;
    for (let i = 0; i < 12; i++) score += (chroma[offset + i] / norm) * tpl[i];
    if (score > bestScore) { best = name; bestScore = score; }
  }
  return best;
}

/** chroma : Float32Array (trames x 12) -> [{ time, end, chord }] */
export function chromaToChords(chroma, duration) {
  const frames = chroma.length / 12;
  if (!frames || duration <= 0) return [];
  const fps = frames / duration;
  const segments = [];
  for (let f = 0; f < frames; f++) {
    const name = matchFrame(chroma, f * 12);
    if (segments.length && segments[segments.length - 1].chord === name) continue;
    segments.push({ time: f / fps, end: 0, chord: name });
  }
  for (let i = 0; i < segments.length - 1; i++) segments[i].end = segments[i + 1].time;
  segments[segments.length - 1].end = duration;

  const cleaned = [];
  for (const seg of segments) {
    if (seg.end - seg.time < MIN_CHORD_DUR && cleaned.length) cleaned[cleaned.length - 1].end = seg.end;
    else cleaned.push(seg);
  }
  return cleaned;
}

// ── Tonalité (Krumhansl-Kessler) ──────────────────────────────────────

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function standardize(v) {
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const std = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return v.map((x) => (x - mean) / (std > 0 ? std : 1));
}
const MAJOR_NORM = standardize(MAJOR_PROFILE);
const MINOR_NORM = standardize(MINOR_PROFILE);

const KEY_NAMES_FR = {
  C: 'Do', 'C#': 'Ré♭', D: 'Ré', 'D#': 'Mi♭', E: 'Mi', F: 'Fa',
  'F#': 'Fa♯', G: 'Sol', 'G#': 'La♭', A: 'La', 'A#': 'Si♭', B: 'Si',
};

/** -> { en: 'A major', fr: 'La majeur' } */
export function detectKey(chroma) {
  const frames = chroma.length / 12;
  const mean = new Array(12).fill(0);
  for (let f = 0; f < frames; f++) for (let i = 0; i < 12; i++) mean[i] += chroma[f * 12 + i] / frames;
  const norm = standardize(mean);
  // np.roll(profil, i)[k] = profil[(k - i) mod 12]
  const score = (profile, shift) => norm.reduce((a, x, k) => a + x * profile[(k - shift + 12) % 12], 0);
  let best = { en: 'C major', fr: 'Do majeur' }, bestScore = -Infinity;
  NOTES.forEach((note, i) => {
    const maj = score(MAJOR_NORM, i), min = score(MINOR_NORM, i);
    if (maj > bestScore) { bestScore = maj; best = { en: `${note} major`, fr: `${KEY_NAMES_FR[note]} majeur` }; }
    if (min > bestScore) { bestScore = min; best = { en: `${note} minor`, fr: `${KEY_NAMES_FR[note]} mineur` }; }
  });
  return best;
}

// ── Couleurs et noms (comme l'interface de ChordSplit) ────────────────

const TYPE_NAMES = {
  add9: 'Ajouté 9ème', maj7: 'Majeur 7ème', m7: 'Mineur 7ème', sus2: 'Suspendu 2nde', sus4: 'Suspendu 4te',
  dim: 'Diminué', aug: 'Augmenté', 7: 'Dominante 7ème', m: 'Mineur', '': 'Majeur', N: '',
};
const COLORS = {
  add9: '#4DB6AC', maj7: '#80DEEA', m7: '#CE93D8', sus2: '#FFD54F', sus4: '#FFD54F',
  dim: '#FF8A65', aug: '#B39DDB', 7: '#A5D6A7', m: '#EF9A9A', '': '#4FC3F7', N: '#555555',
};

export function chordQuality(chord) {
  if (chord === 'N') return 'N';
  for (const suffix of ['add9', 'maj7', 'm7', 'sus2', 'sus4', 'dim', 'aug', '7', 'm']) {
    if (chord.endsWith(suffix)) return suffix;
  }
  return '';
}
export const chordColor = (chord) => COLORS[chordQuality(chord)] ?? '#4FC3F7';
export const chordTypeName = (chord) => TYPE_NAMES[chordQuality(chord)] ?? '';
