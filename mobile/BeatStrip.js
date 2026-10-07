// Barre des temps façon ChordSplit / Chordify : une case par temps détecté,
// un trait à chaque début de mesure, le nom de l'accord quand il change.
// L'instant joué reste au centre, sous le trait.
//
// Historique : 1) suivi à chaque image (requestAnimationFrame) + rendu de
// 500+ cases 10 /s : l'app ne répondait plus ; 2) ScrollView recalé 10 /s
// avec défilement animé : toujours bloquée, et la barre traînait derrière
// la musique (chaque animation de ~0,3 s rattrapait une cible qui avance).
// Désormais : pas de ScrollView ; la bande est déplacée par une animation
// native (Animated, useNativeDriver), linéaire d'un temps au suivant et
// arrivant pile sur le temps suivant. Le JS n'intervient qu'une fois par
// temps (lancer le déplacement suivant, changer la case active).

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

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
    <Pressable onPress={onPress} style={[styles.cell, cell.barStart && styles.barStart, active && styles.active]}>
      <Text style={[styles.name, { color: chordColor(cell.chord) }]} numberOfLines={1} adjustsFontSizeToFit>
        {cell.showName ? cell.chord : ''}
      </Text>
      <View style={[styles.dot, active && styles.dotOn]} />
    </Pressable>
  );
});

/**
 * getTime() renvoie la position de lecture (s) ; syncKey change à chaque
 * lecture / saut / pause pour se recaler. onSeek(t) : saut.
 */
function BeatStrip({ cells, playing, getTime, syncKey, onSeek }) {
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState(-1);
  // Position du point de lecture dans la bande (px depuis la 1re case).
  const x = useRef(new Animated.Value(0)).current;
  const getTimeRef = useRef(getTime);
  getTimeRef.current = getTime;
  // onSeek change à chaque rendu de l'écran de jeu : les cases, mémorisées,
  // passent par une référence toujours à jour.
  const seekRef = useRef(onSeek);
  seekRef.current = onSeek;

  useEffect(() => {
    let stopped = false;
    let timer = null;
    // Se cale sur la position réelle, puis (en lecture) glisse jusqu'au
    // temps suivant à vitesse constante et recommence à son arrivée.
    const step = () => {
      if (stopped) return;
      const t = getTimeRef.current();
      const idx = cellAt(cells, t);
      const cell = cells[idx];
      if (!cell) return;
      const span = Math.max(0.001, cell.end - cell.start);
      const frac = Math.max(0, Math.min(1, (t - cell.start) / span));
      setActive(idx);
      x.stopAnimation();
      x.setValue((idx + frac) * CELL);
      if (!playing) return;
      const remaining = Math.max(0.01, cell.end - t);
      Animated.timing(x, {
        toValue: (idx + 1) * CELL,
        duration: remaining * 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start();
      // Minuterie plutôt que le rappel de fin d'animation : se recale sur
      // l'horloge audio à chaque temps, sans dérive.
      timer = setTimeout(step, remaining * 1000);
    };
    step();
    return () => { stopped = true; clearTimeout(timer); x.stopAnimation(); };
  }, [playing, syncKey, cells]);

  const handlers = useMemo(() => cells.map((c) => () => seekRef.current(c.start + 0.03)), [cells]);
  const translateX = useMemo(() => Animated.multiply(x, -1), [x]);

  return (
    <View style={styles.frame} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Animated.View style={[styles.row, { left: width / 2, transform: [{ translateX }] }]}>
        {cells.map((cell, i) => <Cell key={i} cell={cell} active={i === active} onPress={handlers[i]} />)}
      </Animated.View>
      <View pointerEvents="none" style={[styles.playhead, { left: width / 2 - 1 }]} />
    </View>
  );
}

// Ne se redessine que si les cases, l'état de lecture ou syncKey changent
// (pas à chaque mise à jour de la position dans l'écran de jeu).
export default memo(BeatStrip, (a, b) => a.cells === b.cells && a.playing === b.playing && a.syncKey === b.syncKey);

const styles = StyleSheet.create({
  frame: { height: 64, overflow: 'hidden' },
  row: { position: 'absolute', top: 0, flexDirection: 'row' },
  cell: { width: CELL, height: 62, borderLeftWidth: 1, borderLeftColor: '#2e3340', justifyContent: 'space-between', paddingVertical: 6, paddingHorizontal: 3 },
  barStart: { borderLeftWidth: 3, borderLeftColor: '#8a93a6' },
  active: { backgroundColor: '#1d2a36' },
  name: { fontSize: 17, fontWeight: '700' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3a4050', alignSelf: 'center' },
  dotOn: { backgroundColor: C.accent },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: C.accent, opacity: 0.8 },
});
