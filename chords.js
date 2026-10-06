// Accords et tonalité à partir du « chroma profond » (12 notes, 10 trames
// par seconde), portage de chord_detector.py de ChordSplit
// (_match_frame, _chroma_to_chord_segments, detect_key, couleurs et noms) :
// mêmes gabarits, même seuil, même fusion des segments courts. Seule
// différence : les changements d'accord sont avancés de DETECTION_LAG.

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
// Les changements d'accord détectés arrivent en retard d'environ 0,15 s :
// mesuré sur 3 morceaux face à ChordSplit en production (calé sur les
// temps), +0,15 s partout, accord 81,5 % -> 82,8 % une fois corrigé ;
// l'utilisateur mesurait +0,2 s à l'oreille sur iPhone. Le contexte de
// 1,5 s du chroma profond fait basculer l'accord un peu après le vrai
// changement.
export const DETECTION_LAG = 0.15;
// Version du calage des accords enregistrée avec chaque morceau : les
// morceaux analysés avant la correction (sans version) sont recalés à
// l'affichage.
export const CHORD_TIMING = 2;

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
  // Recalage après la fusion, pour garder exactement les accords de
  // ChordSplit (décaler avant changeait les décisions de fusion au début).
  return cleaned.map((seg, i) => ({
    ...seg,
    time: i === 0 ? 0 : seg.time - DETECTION_LAG,
    end: i === cleaned.length - 1 ? seg.end : seg.end - DETECTION_LAG,
  }));
}

// ── Méthode B : accords des instruments harmoniques + vraie basse ─────
//
// Utilisée par l'app (chromaToChords ci-dessus reste l'équivalent exact de
// ChordSplit, pour comparaison). Sur le mix complet, les harmoniques de la
// basse faussent l'accord : une basse en mi ajoute si et sol#, et un
// B♭m7♭5/E devenait « E » (ChordSplit en production compris). Ici :
//  - accord lu sur le chroma de la piste « autres » (guitare, piano…),
//    complété par la note de basse lue sur la piste basse (sans ses
//    harmoniques), cf. combineChroma ;
//  - vocabulaire + m7b5 ; légère préférence pour les accords simples (les
//    notes de passage de la mélodie ajoutaient des maj7/add9) ;
//  - lissage de Viterbi (pénalité par changement) au lieu de la fusion des
//    segments courts, qui pouvait étirer un accord sur les suivants ;
//  - basse notée en accord renversé (A♭/C) quand elle n'est pas la
//    fondamentale, en coupant l'accord quand la basse change.
// Réglages choisis sur 4 morceaux : retrouve les 3 accords donnés à
// l'oreille par l'utilisateur sur « Greatest Love » (A♭/C à 0:20,
// B♭m7♭5/E à 0:42, A♭/E♭ à 1:20) ; ~81 % de concordance avec la
// production (racine + majeur/mineur), qui se trompe elle-même sur ces
// passages.

const B_INTERVALS = { ...CHORD_INTERVALS, m7b5: [0, 3, 6, 10] };
const B_QUALITIES = [...QUALITIES, 'm7b5'];
const B_TEMPLATES = [];
NOTES.forEach((note, root) => {
  for (const quality of B_QUALITIES) {
    const tpl = new Float32Array(12);
    for (const iv of B_INTERVALS[quality]) tpl[(root + iv) % 12] = 1;
    const norm = Math.hypot(...tpl);
    for (let i = 0; i < 12; i++) tpl[i] /= norm;
    B_TEMPLATES.push({ name: note + quality, root, simple: quality === '' || quality === 'm', tpl });
  }
});

const BASS_WEIGHT = 0.5;     // poids de la basse dans le chroma combiné
const SIMPLE_BONUS = 0.04;   // préférence pour les accords de 3 sons
const SWITCH_PENALTY = 1;    // Viterbi : coût d'un changement d'accord
const BASS_CLARITY = 0.5;    // 2e note de basse <= 50 % de la 1re, sinon basse incertaine
const BASS_MIN_DUR = 0.5;    // durée minimale d'une note de basse (s)

/** Chroma « autres » et chroma de basse normalisés puis additionnés. */
export function combineChroma(other, bass, beta = BASS_WEIGHT) {
  const frames = Math.min(other.length, bass.length) / 12;
  const out = new Float32Array(frames * 12);
  for (let f = 0; f < frames; f++) {
    let no = 0, nb = 0;
    for (let i = 0; i < 12; i++) { no += other[f * 12 + i] ** 2; nb += bass[f * 12 + i] ** 2; }
    no = Math.sqrt(no) || 1; nb = Math.sqrt(nb) || 1;
    for (let i = 0; i < 12; i++) out[f * 12 + i] = other[f * 12 + i] / no + beta * bass[f * 12 + i] / nb;
  }
  return out;
}

// Note de basse nette par trame (-1 sinon), puis vote sur ±0,25 s.
function bassNotes(bass, frames, fps) {
  const raw = new Int32Array(frames).fill(-1);
  for (let f = 0; f < frames; f++) {
    let a = -1, b = -1;
    for (let i = 0; i < 12; i++) {
      const v = bass[f * 12 + i];
      if (a < 0 || v > bass[f * 12 + a]) { b = a; a = i; } else if (b < 0 || v > bass[f * 12 + b]) b = i;
    }
    if (bass[f * 12 + a] > 0 && bass[f * 12 + b] / bass[f * 12 + a] <= BASS_CLARITY) raw[f] = a;
  }
  const w = Math.round(0.25 * fps), out = new Int32Array(frames).fill(-1);
  for (let f = 0; f < frames; f++) {
    const count = new Int32Array(12);
    let best = -1;
    for (let g = Math.max(0, f - w); g <= Math.min(frames - 1, f + w); g++) {
      if (raw[g] < 0) continue;
      count[raw[g]]++;
      if (best < 0 || count[raw[g]] > count[best]) best = raw[g];
    }
    out[f] = best;
  }
  return out;
}

/**
 * otherChroma : chroma profond de la piste « autres », bassChroma : chroma
 * de la piste basse (StemDsp.bassChroma), tous deux trames x 12 à 10 /s.
 * -> [{ time, end, chord }] avec chord en dièses (cf. spellChord).
 */
export function detectChords(otherChroma, bassChroma, duration) {
  const chroma = combineChroma(otherChroma, bassChroma);
  const frames = chroma.length / 12;
  if (!frames || duration <= 0) return [];
  const fps = frames / duration;
  const K = B_TEMPLATES.length + 1; // dernier état : pas d'accord (N)

  // Score de chaque accord à chaque trame.
  const em = new Float32Array(frames * K);
  for (let f = 0; f < frames; f++) {
    let n = 0;
    for (let i = 0; i < 12; i++) n += chroma[f * 12 + i] ** 2;
    n = Math.sqrt(n) || 1;
    B_TEMPLATES.forEach((t, k) => {
      let s = 0;
      for (let i = 0; i < 12; i++) s += (chroma[f * 12 + i] / n) * t.tpl[i];
      em[f * K + k] = s + (t.simple ? SIMPLE_BONUS : 0);
    });
    em[f * K + K - 1] = MIN_CONFIDENCE;
  }

  // Viterbi : suite d'accords qui maximise les scores moins les changements.
  let dp = Float64Array.from({ length: K }, (_, k) => em[k]);
  const back = new Int32Array(frames * K);
  for (let f = 1; f < frames; f++) {
    let best = 0;
    for (let k = 1; k < K; k++) if (dp[k] > dp[best]) best = k;
    const next = new Float64Array(K);
    for (let k = 0; k < K; k++) {
      const stay = dp[k], change = dp[best] - SWITCH_PENALTY;
      next[k] = (stay >= change ? stay : change) + em[f * K + k];
      back[f * K + k] = stay >= change ? k : best;
    }
    dp = next;
  }
  const label = new Int32Array(frames);
  let k = 0;
  for (let j = 1; j < K; j++) if (dp[j] > dp[k]) k = j;
  for (let f = frames - 1; f >= 0; f--) { label[f] = k; k = back[f * K + k]; }

  // Accords, coupés aux changements de basse (renversements).
  const bass = bassNotes(bassChroma, frames, fps);
  const pieces = [];
  for (let f = 0; f < frames; f++) {
    const state = label[f];
    let b = -1;
    if (state !== K - 1) b = bass[f];
    const last = pieces[pieces.length - 1];
    if (last && last.state === state && last.bass === b) last.f1 = f + 1;
    else pieces.push({ state, bass: b, f0: f, f1: f + 1 });
  }
  // Note de basse trop brève : rattachée au morceau voisin du même accord
  // (précédent, sinon suivant : la basse de l'accord précédent traîne
  // souvent un instant au début du nouveau).
  const merged = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (last && last.state === p.state && (p.f1 - p.f0) / fps < BASS_MIN_DUR) last.f1 = p.f1;
    else merged.push({ ...p });
  }
  for (let i = merged.length - 2; i >= 0; i--) {
    const p = merged[i], next = merged[i + 1];
    if (p.state === next.state && p.bass !== next.bass && (p.f1 - p.f0) / fps < BASS_MIN_DUR) {
      next.f0 = p.f0;
      merged.splice(i, 1);
    }
  }
  const segments = [];
  for (const p of merged) {
    let chord = 'N';
    if (p.state !== K - 1) {
      const t = B_TEMPLATES[p.state];
      chord = p.bass >= 0 && p.bass !== t.root ? `${t.name}/${NOTES[p.bass]}` : t.name;
    }
    const last = segments[segments.length - 1];
    if (last && last.chord === chord) last.end = p.f1 / fps;
    else segments.push({ time: p.f0 / fps, end: p.f1 / fps, chord });
  }
  segments[segments.length - 1].end = duration;
  return segments.map((s, i) => ({
    ...s,
    time: i === 0 ? 0 : s.time - DETECTION_LAG,
    end: i === segments.length - 1 ? s.end : s.end - DETECTION_LAG,
  }));
}

// ── Écriture selon la tonalité (bémols ou dièses) ─────────────────────

const FLAT_NAMES = { 'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb' };
// Tonalités qui s'écrivent avec des bémols (Fa majeur … Ré♭ majeur, et
// leurs relatives mineures). Fa♯ majeur / Ré♯ mineur gardent les dièses.
const FLAT_KEYS = new Set(['F major', 'A# major', 'D# major', 'G# major', 'C# major',
  'D minor', 'G minor', 'C minor', 'F minor', 'A# minor']);

const usesFlats = (key) => FLAT_KEYS.has(key?.en);
const spellNote = (note, flats) => (flats ? FLAT_NAMES[note] ?? note : note);

/** 'G#maj7/C' en La♭ majeur -> 'Abmaj7/C'. */
export function spellChord(chord, key) {
  if (chord === 'N') return chord;
  const flats = usesFlats(key);
  const [main, bass] = chord.split('/');
  const root = main.length > 1 && main[1] === '#' ? main.slice(0, 2) : main[0];
  const spelled = spellNote(root, flats) + main.slice(root.length);
  return bass ? `${spelled}/${spellNote(bass, flats)}` : spelled;
}

/** Nom anglais de la tonalité écrit comme ses accords : 'Ab major'. */
export function spellKey(key) {
  const [note, mode] = key.en.split(' ');
  return { ...key, en: `${spellNote(note, usesFlats(key))} ${mode}` };
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
  add9: 'Ajouté 9ème', maj7: 'Majeur 7ème', m7b5: 'Demi-diminué', m7: 'Mineur 7ème', sus2: 'Suspendu 2nde',
  sus4: 'Suspendu 4te', dim: 'Diminué', aug: 'Augmenté', 7: 'Dominante 7ème', m: 'Mineur', '': 'Majeur', N: '',
};
const COLORS = {
  add9: '#4DB6AC', maj7: '#80DEEA', m7b5: '#F48FB1', m7: '#CE93D8', sus2: '#FFD54F', sus4: '#FFD54F',
  dim: '#FF8A65', aug: '#B39DDB', 7: '#A5D6A7', m: '#EF9A9A', '': '#4FC3F7', N: '#555555',
};

export function chordQuality(chord) {
  if (chord === 'N') return 'N';
  const main = chord.split('/')[0]; // renversement : la basse ne change pas la couleur
  for (const suffix of ['add9', 'maj7', 'm7b5', 'm7', 'sus2', 'sus4', 'dim', 'aug', '7', 'm']) {
    if (main.endsWith(suffix)) return suffix;
  }
  return '';
}
export const chordColor = (chord) => COLORS[chordQuality(chord)] ?? '#4FC3F7';
export const chordTypeName = (chord) => TYPE_NAMES[chordQuality(chord)] ?? '';
