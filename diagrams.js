// Doigtés de guitare et notes de piano pour un nom d'accord de l'app
// (« Ab », « Bbm7b5/E », « F#sus4 »…).
//
// Guitare : les doigtés ouverts de ChordSplit (static/guitar.js) quand ils
// existent ; sinon un barré calculé en forme de Mi (fondamentale sur la
// 6e corde) ou de La (sur la 5e), à la position la plus basse. Ainsi tous
// les accords ont un diagramme (ChordSplit n'en avait qu'une partie, en
// dièses seulement). Pour un renversement, le doigté est celui de l'accord
// sans la basse, la basse étant indiquée à part.

const NAMES = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const INTERVALS = {
  '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11],
  sus2: [0, 2, 7], sus4: [0, 5, 7], dim: [0, 3, 6], aug: [0, 4, 8], add9: [0, 4, 7, 2], m7b5: [0, 3, 6, 10],
};

/** 'Bbm7b5/E' -> { root: 10, quality: 'm7b5', bass: 4, tones: [10, 1, 4, 8] } */
export function parseChord(name) {
  if (!name || name === 'N') return null;
  const [main, bassName] = name.split('/');
  const rootName = main.length > 1 && (main[1] === '#' || main[1] === 'b') ? main.slice(0, 2) : main[0];
  const root = NAMES[rootName];
  if (root === undefined) return null;
  const quality = main.slice(rootName.length);
  const intervals = INTERVALS[quality] ?? INTERVALS[''];
  const bass = bassName !== undefined ? NAMES[bassName] : undefined;
  return { root, quality, bass: bass ?? root, tones: intervals.map((iv) => (root + iv) % 12) };
}

// Doigtés ouverts repris de ChordSplit : frettes [Mi grave … Mi aigu],
// -1 = corde étouffée, 0 = à vide ; start = 1re case dessinée, barre = case
// du barré (0 = aucun).
const OPEN = {
  C: { frets: [-1, 3, 2, 0, 1, 0], start: 0, barre: 0 },
  C7: { frets: [-1, 3, 2, 3, 1, 0], start: 0, barre: 0 },
  Cmaj7: { frets: [-1, 3, 2, 0, 0, 0], start: 0, barre: 0 },
  Csus2: { frets: [-1, 3, 0, 0, 1, 3], start: 0, barre: 0 },
  Csus4: { frets: [-1, 3, 3, 0, 1, 1], start: 0, barre: 0 },
  Caug: { frets: [-1, 3, 2, 1, 1, 0], start: 0, barre: 0 },
  Cadd9: { frets: [-1, 3, 2, 0, 3, 0], start: 0, barre: 0 },
  D: { frets: [-1, -1, 0, 2, 3, 2], start: 0, barre: 0 },
  Dm: { frets: [-1, -1, 0, 2, 3, 1], start: 0, barre: 0 },
  D7: { frets: [-1, -1, 0, 2, 1, 2], start: 0, barre: 0 },
  Dm7: { frets: [-1, -1, 0, 2, 1, 1], start: 0, barre: 0 },
  Dmaj7: { frets: [-1, -1, 0, 2, 2, 2], start: 0, barre: 0 },
  Dsus2: { frets: [-1, -1, 0, 2, 3, 0], start: 0, barre: 0 },
  Dsus4: { frets: [-1, -1, 0, 2, 3, 3], start: 0, barre: 0 },
  Ddim: { frets: [-1, -1, 0, 1, 0, 1], start: 0, barre: 0 },
  Daug: { frets: [-1, -1, 0, 3, 3, 2], start: 0, barre: 0 },
  Dadd9: { frets: [-1, -1, 0, 2, 3, 0], start: 0, barre: 0 },
  E: { frets: [0, 2, 2, 1, 0, 0], start: 0, barre: 0 },
  Em: { frets: [0, 2, 2, 0, 0, 0], start: 0, barre: 0 },
  E7: { frets: [0, 2, 0, 1, 0, 0], start: 0, barre: 0 },
  Em7: { frets: [0, 2, 2, 0, 3, 0], start: 0, barre: 0 },
  Emaj7: { frets: [0, 2, 1, 1, 0, 0], start: 0, barre: 0 },
  Esus2: { frets: [0, 2, 4, 4, 0, 0], start: 0, barre: 0 },
  Esus4: { frets: [0, 2, 2, 2, 0, 0], start: 0, barre: 0 },
  Edim: { frets: [0, 1, 2, 3, 2, -1], start: 0, barre: 0 },
  Eaug: { frets: [0, 3, 2, 1, 1, 0], start: 0, barre: 0 },
  Fmaj7: { frets: [-1, -1, 3, 2, 1, 0], start: 0, barre: 0 },
  G: { frets: [3, 2, 0, 0, 0, 3], start: 0, barre: 0 },
  G7: { frets: [3, 2, 0, 0, 0, 1], start: 0, barre: 0 },
  Gmaj7: { frets: [3, 2, 0, 0, 0, 2], start: 0, barre: 0 },
  Gsus2: { frets: [3, 0, 0, 2, 3, 3], start: 0, barre: 0 },
  Gsus4: { frets: [3, 3, 0, 0, 1, 3], start: 0, barre: 0 },
  Gaug: { frets: [3, 2, 1, 0, 0, -1], start: 0, barre: 0 },
  Gadd9: { frets: [3, 2, 0, 2, 0, 3], start: 0, barre: 0 },
  A: { frets: [-1, 0, 2, 2, 2, 0], start: 0, barre: 0 },
  Am: { frets: [-1, 0, 2, 2, 1, 0], start: 0, barre: 0 },
  A7: { frets: [-1, 0, 2, 0, 2, 0], start: 0, barre: 0 },
  Am7: { frets: [-1, 0, 2, 0, 1, 0], start: 0, barre: 0 },
  Amaj7: { frets: [-1, 0, 2, 1, 2, 0], start: 0, barre: 0 },
  Asus2: { frets: [-1, 0, 2, 2, 0, 0], start: 0, barre: 0 },
  Asus4: { frets: [-1, 0, 2, 2, 3, 0], start: 0, barre: 0 },
  Adim: { frets: [-1, 0, 1, 2, 1, 2], start: 0, barre: 0 },
  Aaug: { frets: [-1, 0, 3, 2, 2, 1], start: 0, barre: 0 },
  Aadd9: { frets: [-1, 0, 2, 4, 2, 0], start: 0, barre: 0 },
  B7: { frets: [-1, 2, 1, 2, 0, 2], start: 0, barre: 0 },
};

// Formes barrées : frettes relatives à la case de la fondamentale (sur la
// 6e corde pour la forme de Mi, la 5e pour la forme de La) ; null = corde
// étouffée.
const E_FORM = {
  '': [0, 2, 2, 1, 0, 0], m: [0, 2, 2, 0, 0, 0], 7: [0, 2, 0, 1, 0, 0], m7: [0, 2, 0, 0, 0, 0],
  maj7: [0, null, 1, 1, 0, null], sus4: [0, 2, 2, 2, 0, 0], dim: [0, 1, 2, 0, null, null],
  aug: [0, null, 2, 1, 1, null], add9: [0, 2, 2, 1, 0, 2], m7b5: [0, null, 0, 0, -1, null],
};
const A_FORM = {
  '': [null, 0, 2, 2, 2, 0], m: [null, 0, 2, 2, 1, 0], 7: [null, 0, 2, 0, 2, 0], m7: [null, 0, 2, 0, 1, 0],
  maj7: [null, 0, 2, 1, 2, 0], sus2: [null, 0, 2, 2, 0, 0], sus4: [null, 0, 2, 2, 3, 0],
  dim: [null, 0, 1, 2, 1, null], aug: [null, 0, 3, 2, 2, 1], add9: [null, 0, 2, 4, 2, 0], m7b5: [null, 0, 1, 0, 1, null],
};

function barreShape(form, rootFret) {
  const frets = form.map((rel) => (rel === null ? -1 : rootFret + rel));
  const played = frets.filter((f) => f > 0);
  if (!played.length || frets.some((f) => f === 0 && rootFret > 0)) return null;
  const onRoot = form.filter((rel) => rel === 0).length;
  return { frets, start: Math.min(...played), barre: onRoot >= 2 ? rootFret : 0, top: Math.max(...played) };
}

/** Doigté de guitare de l'accord (sans sa basse), ou null. */
export function guitarShape(name) {
  const chord = parseChord(name);
  if (!chord) return null;
  const open = OPEN[SHARP[chord.root] + chord.quality] ?? OPEN[name.split('/')[0]];
  if (open) return { frets: open.frets, start: open.start, barre: open.barre };
  const candidates = [];
  const eForm = E_FORM[chord.quality], aForm = A_FORM[chord.quality];
  // Case de la fondamentale : Mi grave = 4, La = 9 ; de 1 à 12 (barré).
  if (eForm) candidates.push(barreShape(eForm, ((chord.root - 4 + 12) % 12) || 12));
  if (aForm) candidates.push(barreShape(aForm, ((chord.root - 9 + 12) % 12) || 12));
  const best = candidates.filter(Boolean).sort((a, b) => a.top - b.top)[0];
  return best ? { frets: best.frets, start: best.start, barre: best.barre } : null;
}

/** Notes d'une corde à vide, du grave à l'aigu : E A D G B E. */
const OPEN_STRINGS = [4, 9, 2, 7, 11, 4];

/** Classes de hauteur jouées par un doigté (vérification). */
export function shapeNotes(shape) {
  return shape.frets.map((f, s) => (f < 0 ? null : (OPEN_STRINGS[s] + f) % 12));
}
