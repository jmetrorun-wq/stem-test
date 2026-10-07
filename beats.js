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

/**
 * detected : { period, beats: [trame], downbeat: [activation au temps] }.
 * -> { beatTimes: [s], beatsPerBar, phase, tempo }, phase = indice du
 *    premier temps de la première mesure complète dans beatTimes.
 */
export function meterAndBars(detected) {
  const { beats, downbeat, period } = detected;
  let best = null;
  for (const beatsPerBar of [3, 4]) {
    for (let phase = 0; phase < beatsPerBar; phase++) {
      let sum = 0, n = 0;
      for (let i = phase; i < beats.length; i += beatsPerBar) { sum += downbeat[i]; n++; }
      const score = n ? sum / n : 0;
      if (!best || score > best.score) best = { score, beatsPerBar, phase };
    }
  }
  return {
    beatTimes: beats.map((f) => f / BEAT_FPS),
    beatsPerBar: best?.beatsPerBar ?? 4,
    phase: best?.phase ?? 0,
    tempo: Math.round((60 * BEAT_FPS) / period),
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
