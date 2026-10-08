// Mesure (3 ou 4 temps) et premiers temps, à partir des temps détectés et
// de l'activation « premier temps » du réseau de madmom à chacun de ces
// temps (cf. DownbeatRNN / BeatTracker côté natif). Sur 4 morceaux : même
// mesure et mêmes premiers temps que le décodeur complet de madmom à
// 99-100 % (« Gratitude » en 3 temps compris).
//
// Puis découpage en cases d'un temps pour la barre de mesures, comme
// l'interface de ChordSplit (façon Chordify), mais sur les vrais temps
// détectés plutôt qu'une grille à tempo constant.

export const BEAT_FPS = 100;

// Mesure (3 ou 4 temps) et phase qui font le mieux ressortir l'activation
// « premier temps » ; contraste = moyenne aux premiers temps choisis /
// moyenne à tous les temps.
function bestMeter(downbeat, indices) {
  let best = null;
  for (const beatsPerBar of [3, 4]) {
    for (let phase = 0; phase < beatsPerBar; phase++) {
      let sum = 0, n = 0;
      for (let k = phase; k < indices.length; k += beatsPerBar) { sum += downbeat[indices[k]]; n++; }
      const score = n ? sum / n : 0;
      if (!best || score > best.score) best = { score, beatsPerBar, phase };
    }
  }
  let all = 0;
  for (const i of indices) all += downbeat[i];
  const mean = indices.length ? all / indices.length : 0;
  return { ...best, contrast: mean > 0 ? best.score / mean : 0 };
}

// Un morceau lent (59 BPM) était compté en croches (118 BPM) : on essaie
// aussi un temps sur deux, gardé si ses premiers temps ressortent
// nettement mieux (+15 %). Sur 5 morceaux : même tempo que madmom partout
// (« Éternel » : 59 au lieu de 118 ; les 4 autres inchangés).
const HALF_TEMPO_GAIN = 1.15;
const MIN_BPM = 40;

/**
 * detected : { period, beats: [trame], downbeat: [activation au temps] }.
 * -> { beatTimes: [s], beatsPerBar, phase, tempo }, phase = indice du
 *    premier temps de la première mesure complète dans beatTimes.
 */
export function meterAndBars(detected) {
  const { beats, downbeat, period } = detected;
  const all = beats.map((_, i) => i);
  const base = { indices: all, period, ...bestMeter(downbeat, all) };
  let best = base;
  if ((60 * BEAT_FPS) / (2 * period) >= MIN_BPM) {
    for (const offset of [0, 1]) {
      const half = all.filter((i) => i % 2 === offset);
      const m = bestMeter(downbeat, half);
      if (m.contrast > HALF_TEMPO_GAIN * base.contrast && m.contrast > best.contrast) {
        best = { indices: half, period: 2 * period, ...m };
      }
    }
  }
  return {
    beatTimes: best.indices.map((i) => beats[i] / BEAT_FPS),
    beatsPerBar: best.beatsPerBar ?? 4,
    phase: best.phase ?? 0,
    tempo: Math.round((60 * BEAT_FPS) / best.period),
  };
}

/**
 * Cases d'un temps : [{ start, end, chord, showName, barStart }]. L'accord
 * d'une case est pris en son milieu (un changement est rattaché à la case
 * la plus proche) ; le nom n'est affiché que quand l'accord change.
 */
export function beatCells(grid, chords, duration) {
  const { beatTimes, beatsPerBar, phase } = grid;
  if (!beatTimes.length) return [];
  const chordAt = (t) => chords.find((c) => c.time <= t && t < c.end)?.chord ?? 'N';
  const cells = [];
  let previous = null;
  for (let i = 0; i < beatTimes.length; i++) {
    const start = beatTimes[i];
    const end = i + 1 < beatTimes.length ? beatTimes[i + 1] : Math.min(duration, start + (start - (beatTimes[i - 1] ?? 0)));
    if (end <= start) continue;
    const chord = chordAt((start + end) / 2);
    cells.push({
      start, end, chord,
      showName: chord !== previous && chord !== 'N',
      barStart: (i - phase) % beatsPerBar === 0 && i >= phase,
      beatInBar: (((i - phase) % beatsPerBar) + beatsPerBar) % beatsPerBar,
    });
    previous = chord;
  }
  return cells;
}

/**
 * Grille par mesures pour l'export : [{ number, chords: [noms] }], avec
 * une éventuelle levée (temps avant le premier premier temps) en mesure 0.
 * Une mesure liste ses accords successifs (deux si l'accord change en
 * cours de mesure, ce que la grille de ChordSplit, un accord par mesure,
 * ne montrait pas) ; '—' si aucun accord.
 */
export function barsFromCells(cells) {
  const bars = [];
  let current = null;
  cells.forEach((cell, i) => {
    if (cell.barStart || i === 0) {
      current = { number: cell.barStart ? bars.filter((b) => b.number > 0).length + 1 : 0, chords: [] };
      bars.push(current);
    }
    const last = current.chords[current.chords.length - 1];
    if (cell.chord !== 'N' && cell.chord !== last) current.chords.push(cell.chord);
  });
  // Levée sans accord : inutile dans la grille.
  if (bars[0]?.number === 0 && !bars[0].chords.length) bars.shift();
  return bars.map((b) => ({ ...b, chords: b.chords.length ? b.chords : ['—'] }));
}
