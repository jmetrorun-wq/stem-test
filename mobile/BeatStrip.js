// Barre des temps façon ChordSplit / Chordify : une case par temps détecté,
// un trait à chaque début de mesure, le nom de l'accord quand il change.
// Défile en continu, l'instant joué toujours au centre (boucle
// requestAnimationFrame : seule la case active déclenche un nouveau rendu).

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { chordColor } from '../chords.js';
import { C } from './theme.js';

const CELL = 58;

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

export default function BeatStrip({ cells, playing, getTime, position, onSeek }) {
  // Largeur réelle de la bande (mesurée) : la marge de chaque côté permet
  // à la 1re et à la dernière case de venir sous le trait central.
  const [width, setWidth] = useState(0);
  const scroll = useRef(null);
  const [active, setActive] = useState(-1);
  const activeRef = useRef(-1);
  const pad = width / 2;

  function follow(t) {
    const idx = cellAt(cells, t);
    const cell = cells[idx];
    if (!cell) return;
    const frac = Math.max(0, Math.min(1, (t - cell.start) / Math.max(0.001, cell.end - cell.start)));
    scroll.current?.scrollTo({ x: (idx + frac) * CELL, animated: false });
    if (idx !== activeRef.current) { activeRef.current = idx; setActive(idx); }
  }

  useEffect(() => {
    if (!playing) return undefined;
    let frame;
    const loop = () => { follow(getTime()); frame = requestAnimationFrame(loop); };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [playing, cells]);

  // À l'arrêt (saut, ouverture), se caler sur la position.
  useEffect(() => { if (!playing) follow(position); }, [position, playing, cells, width]);

  // onSeek change à chaque rendu (il dépend de l'état lecture/pause) : les
  // cases, mémorisées, passent par une référence toujours à jour.
  const seekRef = useRef(onSeek);
  seekRef.current = onSeek;
  const handlers = useMemo(() => cells.map((c) => () => seekRef.current(c.start + 0.03)), [cells]);

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: pad }} scrollEventThrottle={16}>
        {cells.map((cell, i) => <Cell key={i} cell={cell} active={i === active} onPress={handlers[i]} />)}
      </ScrollView>
      <View pointerEvents="none" style={[styles.playhead, { left: width / 2 - 1 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  cell: { width: CELL, height: 62, borderLeftWidth: 1, borderLeftColor: '#2e3340', justifyContent: 'space-between', paddingVertical: 6, paddingHorizontal: 3 },
  barStart: { borderLeftWidth: 3, borderLeftColor: '#8a93a6' },
  active: { backgroundColor: '#1d2a36' },
  name: { fontSize: 17, fontWeight: '700' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3a4050', alignSelf: 'center' },
  dotOn: { backgroundColor: C.accent },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: C.accent, opacity: 0.8 },
});
