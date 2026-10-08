// Métronome autonome, repris de ChordSplit (static/metronome.js +
// molette de tempo validée par l'utilisateur) : clic au tempo choisi,
// accent sur le premier temps, points qui s'allument, molette verticale
// façon iOS (40-240 BPM), mesure de 2 à 7 temps.
//
// Ordonnancement à anticipation (comme ChordSplit) : une minuterie de
// 25 ms programme les clics jusqu'à 0,12 s d'avance sur l'horloge audio,
// donc le rythme reste exact même si le JS prend du retard.

import { memo, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AudioContext } from 'react-native-audio-api';

import { C } from './theme.js';

const MIN_BPM = 40, MAX_BPM = 240;
const ITEM = 44;           // hauteur d'un chiffre de la molette
const VISIBLE = 5;         // chiffres visibles
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;
const SIGNATURES = [2, 3, 4, 5, 6, 7];
const VALUES = Array.from({ length: MAX_BPM - MIN_BPM + 1 }, (_, i) => MIN_BPM + i);

// Chiffre de la molette, mémorisé : en tournant, seuls l'ancien et le
// nouveau tempo se redessinent (pas les 201 chiffres à chaque mouvement,
// cf. le blocage de la barre des temps).
const WheelItem = memo(function WheelItem({ value, selected, onPick }) {
  return (
    <TouchableOpacity onPress={() => onPick(value)} style={styles.item}>
      <Text style={[styles.itemText, selected && styles.itemSelected]}>{value}</Text>
    </TouchableOpacity>
  );
});

export default function Metronome({ onBack, initialTempo = 100, initialBeats = 4 }) {
  const [tempo, setTempo] = useState(Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(initialTempo))));
  const [beats, setBeats] = useState(SIGNATURES.includes(initialBeats) ? initialBeats : 4);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState(-1);
  const wheel = useRef(null);
  // Lu par le planificateur : toujours à jour sans le relancer.
  const state = useRef({ tempo, beats, ctx: null, next: 0, beat: 0, timer: null, running: false }).current;
  state.tempo = tempo;
  state.beats = beats;

  function click(time, accent) {
    const ctx = state.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1600 : 1000;
    gain.gain.setValueAtTime(accent ? 0.5 : 0.3, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  function scheduler() {
    const ctx = state.ctx;
    while (state.next < ctx.currentTime + SCHEDULE_AHEAD) {
      const b = state.beat;
      click(state.next, b === 0);
      const delay = Math.max(0, (state.next - ctx.currentTime) * 1000);
      setTimeout(() => { if (state.running) setCurrent(b); }, delay);
      state.next += 60 / state.tempo;
      state.beat = (state.beat + 1) % state.beats;
    }
    state.timer = setTimeout(scheduler, LOOKAHEAD_MS);
  }

  function start() {
    state.ctx ??= new AudioContext();
    state.running = true;
    state.beat = 0;
    state.next = state.ctx.currentTime + 0.05;
    scheduler();
    setRunning(true);
  }

  function stop() {
    state.running = false;
    clearTimeout(state.timer);
    setRunning(false);
    setCurrent(-1);
  }

  useEffect(() => () => { state.running = false; clearTimeout(state.timer); state.ctx?.close(); }, []);

  // Place la molette sur le tempo de départ.
  useEffect(() => {
    const id = setTimeout(() => wheel.current?.scrollTo({ y: (tempo - MIN_BPM) * ITEM, animated: false }), 50);
    return () => clearTimeout(id);
  }, []);

  function onWheel(e) {
    const v = MIN_BPM + Math.round(e.nativeEvent.contentOffset.y / ITEM);
    const clamped = Math.max(MIN_BPM, Math.min(MAX_BPM, v));
    if (clamped !== state.tempo) setTempo(clamped);
  }

  function nudge(delta) {
    const v = Math.max(MIN_BPM, Math.min(MAX_BPM, tempo + delta));
    setTempo(v);
    wheel.current?.scrollTo({ y: (v - MIN_BPM) * ITEM, animated: true });
  }

  // Fonction stable (lit la molette par référence) : les chiffres
  // mémorisés ne sont pas redessinés à cause d'elle.
  const pick = useRef((v) => {
    setTempo(v);
    wheel.current?.scrollTo({ y: (v - MIN_BPM) * ITEM, animated: true });
  }).current;

  function chooseBeats(n) {
    setBeats(n);
    state.beat = 0;
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ Retour</Text></TouchableOpacity>
      <Text style={styles.title}>Métronome</Text>

      <View style={styles.card}>
        <View style={styles.dots}>
          {Array.from({ length: beats }, (_, i) => (
            <View key={i} style={[styles.dot, i === 0 && styles.dotAccent, current === i && (i === 0 ? styles.dotOnAccent : styles.dotOn)]} />
          ))}
        </View>

        <View style={styles.wheelRow}>
          <TouchableOpacity style={styles.round} onPress={() => nudge(-1)}><Text style={styles.roundText}>−</Text></TouchableOpacity>
          <View style={styles.wheelFrame}>
            <ScrollView ref={wheel} showsVerticalScrollIndicator={false} snapToInterval={ITEM} decelerationRate="fast"
              onScroll={onWheel} scrollEventThrottle={32} onMomentumScrollEnd={onWheel}
              contentContainerStyle={{ paddingVertical: ITEM * Math.floor(VISIBLE / 2) }}>
              {VALUES.map((v) => <WheelItem key={v} value={v} selected={v === tempo} onPick={pick} />)}
            </ScrollView>
            <View pointerEvents="none" style={styles.selection} />
          </View>
          <TouchableOpacity style={styles.round} onPress={() => nudge(1)}><Text style={styles.roundText}>+</Text></TouchableOpacity>
        </View>
        <Text style={styles.bpm}>BPM</Text>

        <TouchableOpacity style={styles.play} onPress={() => (running ? stop() : start())}>
          <Text style={styles.playText}>{running ? '⏸' : '▶︎'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Temps par mesure</Text>
        <View style={styles.signatures}>
          {SIGNATURES.map((n) => (
            <TouchableOpacity key={n} onPress={() => chooseBeats(n)} style={[styles.pill, n === beats && styles.pillOn]}>
              <Text style={[styles.pillText, n === beats && styles.pillTextOn]}>{n}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingTop: 60, gap: 14 },
  back: { color: C.accent, fontSize: 16 },
  title: { color: C.text, fontSize: 24, fontWeight: '700' },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, gap: 14, alignItems: 'center' },
  label: { color: C.text, fontSize: 15, fontWeight: '600', alignSelf: 'flex-start' },
  dots: { flexDirection: 'row', gap: 12, minHeight: 22, alignItems: 'center' },
  dot: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#3a4050' },
  dotAccent: { width: 22, height: 22, borderRadius: 11 },
  dotOn: { backgroundColor: C.accent },
  dotOnAccent: { backgroundColor: '#FF8A65' },
  wheelRow: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  wheelFrame: { width: 110, height: ITEM * VISIBLE },
  item: { height: ITEM, alignItems: 'center', justifyContent: 'center' },
  itemText: { color: '#5a6170', fontSize: 22, fontVariant: ['tabular-nums'] },
  itemSelected: { color: C.text, fontSize: 34, fontWeight: '800' },
  selection: { position: 'absolute', left: 0, right: 0, top: ITEM * Math.floor(VISIBLE / 2), height: ITEM,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#4a5060' },
  bpm: { color: C.muted, fontSize: 13, letterSpacing: 2 },
  round: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.chip, alignItems: 'center', justifyContent: 'center' },
  roundText: { color: C.text, fontSize: 26 },
  play: { width: 76, height: 76, borderRadius: 38, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  playText: { color: '#111', fontSize: 30 },
  signatures: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill: { backgroundColor: C.chip, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 9 },
  pillOn: { backgroundColor: C.accent },
  pillText: { color: C.text, fontSize: 16 },
  pillTextOn: { color: '#111', fontWeight: '700' },
});
