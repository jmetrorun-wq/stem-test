// Barre des temps façon ChordSplit / Chordify : une case par temps détecté,
// un trait à chaque début de mesure, le nom de l'accord quand il change.
// L'instant joué reste au centre, sous le trait.
//
// Performance : une première version suivait la lecture à chaque image
// (requestAnimationFrame) et était redessinée à chaque mise à jour de
// l'écran (10 /s, 500+ cases) : le JS saturait et l'app ne répondait plus
// (même plus au bouton pause). Désormais : suivi 10 fois par seconde avec
// défilement animé par iOS entre deux suivis, composant mémorisé (les
// mises à jour de l'écran de jeu ne le redessinent pas) et seule la case
// active change.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { chordColor } from '../chords.js';
import { C } from './theme.js';

const CELL = 58;
const FOLLOW_MS = 100;

// Indice de la case contenant t (recherche dichotomique).
function cellAt(cells, t) {
  let lo = 0, hi = cells.length - 1;
  if (!cells.length || t < cells[0].start) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cells[mid].start <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}

const Cell = memo(function Cell({ cell, active, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}
      style={[styles.cell, cell.barStart && styles.barStart, active && styles.active]}>
      <Text style={[styles.name, { color: chordColor(cell.chord) }]} numberOfLines={1} adjustsFontSizeToFit>
        {cell.showName ? cell.chord : ''}
      </Text>
      <View style={[styles.dot, active && styles.dotOn]} />
    </TouchableOpacity>
  );
});

/**
 * getTime() renvoie la position de lecture (s) ; syncKey change à chaque
 * saut / pause pour recaler la barre à l'arrêt. onSeek(t) : saut.
 */
function BeatStrip({ cells, playing, getTime, syncKey, onSeek }) {
  // Largeur réelle de la bande (mesurée) : la marge de chaque côté permet
  // à la 1re et à la dernière case de venir sous le trait central.
  const [width, setWidth] = useState(0);
  const scroll = useRef(null);
  const [active, setActive] = useState(-1);
  const activeRef = useRef(-1);
  const getTimeRef = useRef(getTime);
  getTimeRef.current = getTime;
  // onSeek change à chaque rendu de l'écran de jeu : les cases, mémorisées,
  // passent par une référence toujours à jour.
  const seekRef = useRef(onSeek);
  seekRef.current = onSeek;

  function follow(animated) {
    const t = getTimeRef.current();
    const idx = cellAt(cells, t);
    const cell = cells[idx];
    if (!cell) return;
    const frac = Math.max(0, Math.min(1, (t - cell.start) / Math.max(0.001, cell.end - cell.start)));
    scroll.current?.scrollTo({ x: (idx + frac) * CELL, animated });
    if (idx !== activeRef.current) { activeRef.current = idx; setActive(idx); }
  }

  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => follow(true), FOLLOW_MS);
    return () => clearInterval(id);
  }, [playing, cells]);

  // À l'arrêt (ouverture, saut, pause) : se caler sans animation.
  useEffect(() => { follow(false); }, [syncKey, playing, cells, width]);

  const handlers = useMemo(() => cells.map((c) => () => seekRef.current(c.start + 0.03)), [cells]);

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: width / 2 }}>
        {cells.map((cell, i) => <Cell key={i} cell={cell} active={i === active} onPress={handlers[i]} />)}
      </ScrollView>
      <View pointerEvents="none" style={[styles.playhead, { left: width / 2 - 1 }]} />
    </View>
  );
}

// Ne se redessine que si les cases, l'état de lecture ou syncKey changent
// (pas à chaque mise à jour de la position dans l'écran de jeu).
export default memo(BeatStrip, (a, b) => a.cells === b.cells && a.playing === b.playing && a.syncKey === b.syncKey);

const styles = StyleSheet.create({
  cell: { width: CELL, height: 62, borderLeftWidth: 1, borderLeftColor: '#2e3340', justifyContent: 'space-between', paddingVertical: 6, paddingHorizontal: 3 },
  barStart: { borderLeftWidth: 3, borderLeftColor: '#8a93a6' },
  active: { backgroundColor: '#1d2a36' },
  name: { fontSize: 17, fontWeight: '700' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3a4050', alignSelf: 'center' },
  dotOn: { backgroundColor: C.accent },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: C.accent, opacity: 0.8 },
});
