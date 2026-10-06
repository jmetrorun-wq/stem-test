// Écran de jeu : les 4 pistes jouées ensemble, chacune avec son propre
// volume (couper / remettre un instrument est instantané, sans remixage),
// l'accord en cours en grand et la barre des accords qui défile.

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AudioContext, decodeAudioData } from 'react-native-audio-api';
import { File, Paths } from 'expo-file-system';

import { SAMPLE_RATE, TRACKS } from '../separator.js';
import { CHORD_TIMING, DETECTION_LAG, chordColor } from '../chords.js';
import { fmt } from './analyze.js';
import { stemUri, updateSong } from './library.js';
import { C, INSTRUMENTS, TRACK_LABELS } from './theme.js';

const CHIP = 76; // largeur d'une case d'accord (+ marge)

// Décalage d'affichage des accords réglé par l'utilisateur (secondes,
// positif = accords affichés plus tôt), mémorisé pour tous les morceaux :
// sert à compenser la latence de sortie audio (écouteurs Bluetooth :
// 150-250 ms) et à mesurer le décalage réel de la détection.
const settingsFile = new File(Paths.document, 'settings.json');
const readSettings = () => { try { return settingsFile.exists ? JSON.parse(settingsFile.textSync()) : {}; } catch { return {}; } };
const writeSettings = (patch) => { try { settingsFile.write(JSON.stringify({ ...readSettings(), ...patch })); } catch {} };

export default function Player({ song, onBack }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const muted = INSTRUMENTS.find((i) => i.id === song.instrument)?.stem;
  const [enabled, setEnabled] = useState(() => Object.fromEntries(TRACKS.map((t) => [t, t !== muted])));
  const audio = useRef({ ctx: null, buffers: {}, gains: {}, sources: [], startedAt: 0, offset: 0 });
  const bar = useRef(null);
  // Clé chordShift2 : l'ancien réglage (chordShift, +0,2 s) compensait le
  // retard de détection désormais corrigé, on repart de 0.
  const [shift, setShift] = useState(() => readSettings().chordShift2 ?? 0);
  const changeShift = (delta) => {
    const next = Math.round((shift + delta) * 10) / 10;
    setShift(next);
    writeSettings({ chordShift2: next });
  };

  // Barre des accords : seulement les vrais accords (pas les silences).
  // Morceaux analysés avant la correction du retard de détection : recalés.
  const lag = (song.chordTiming ?? 1) < CHORD_TIMING ? DETECTION_LAG : 0;
  const chords = song.chords.filter((c) => c.chord !== 'N')
    .map((c) => (lag ? { ...c, time: Math.max(0, c.time - lag), end: c.end - lag } : c));

  useEffect(() => {
    let cancelled = false;
    const a = audio.current;
    (async () => {
      try {
        a.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
        for (const track of TRACKS) {
          a.buffers[track] = await decodeAudioData(stemUri(song.id, track), SAMPLE_RATE);
          if (cancelled) return;
          const gain = a.ctx.createGain();
          gain.gain.value = enabled[track] ? 1 : 0;
          gain.connect(a.ctx.destination);
          a.gains[track] = gain;
        }
        setReady(true);
      } catch (e) {
        setError(String(e?.message || e));
      }
    })();
    return () => {
      cancelled = true;
      for (const s of a.sources) { try { s.stop(); } catch {} }
      a.ctx?.close();
    };
  }, [song.id]);

  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => {
      const a = audio.current;
      const t = a.ctx.currentTime - a.startedAt;
      if (t >= song.duration) { pause(); setPosition(0); audio.current.offset = 0; return; }
      setPosition(Math.max(0, t));
    }, 100);
    return () => clearInterval(id);
  }, [playing]);

  const chordPos = position + shift;
  const current = chords.findIndex((c) => c.time <= chordPos && chordPos < c.end);
  const nowChord = current >= 0 ? chords[current].chord : null;
  const nextChord = current >= 0 ? chords[current + 1]?.chord : chords.find((c) => c.time > chordPos)?.chord;

  // Garde l'accord en cours au centre de la barre.
  useEffect(() => {
    if (current >= 0) bar.current?.scrollTo({ x: Math.max(0, current * CHIP - 140), animated: true });
  }, [current]);

  function play(from = audio.current.offset) {
    const a = audio.current;
    for (const s of a.sources) { try { s.stop(); } catch {} }
    // Toutes les pistes démarrent au même instant de l'horloge audio.
    const when = a.ctx.currentTime + 0.1;
    a.sources = TRACKS.map((track) => {
      const source = a.ctx.createBufferSource();
      source.buffer = a.buffers[track];
      source.connect(a.gains[track]);
      source.start(when, from);
      return source;
    });
    a.startedAt = when - from;
    setPosition(from);
    setPlaying(true);
  }

  function pause() {
    const a = audio.current;
    a.offset = Math.max(0, a.ctx.currentTime - a.startedAt);
    for (const s of a.sources) { try { s.stop(); } catch {} }
    a.sources = [];
    setPlaying(false);
  }

  function seek(t) {
    const target = Math.min(Math.max(0, t), song.duration - 0.5);
    audio.current.offset = target;
    if (playing) play(target);
    else setPosition(target);
  }

  function toggle(track) {
    const next = { ...enabled, [track]: !enabled[track] };
    setEnabled(next);
    const gain = audio.current.gains[track];
    if (gain) gain.gain.value = next[track] ? 1 : 0;
  }

  function changeInstrument(id) {
    const stem = INSTRUMENTS.find((i) => i.id === id)?.stem;
    const next = Object.fromEntries(TRACKS.map((t) => [t, t !== stem]));
    setEnabled(next);
    for (const t of TRACKS) if (audio.current.gains[t]) audio.current.gains[t].gain.value = next[t] ? 1 : 0;
    updateSong({ ...song, instrument: id });
    song.instrument = id;
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ Bibliothèque</Text></TouchableOpacity>
      <Text style={styles.title} numberOfLines={2}>{song.title}</Text>
      <Text style={styles.muted}>Tonalité : {song.key?.fr} — {fmt(song.duration)}</Text>

      {!ready && !error && (
        <View style={styles.card}><ActivityIndicator color={C.accent} /><Text style={styles.muted}>Chargement des pistes…</Text></View>
      )}
      {error ? <Text style={styles.err}>Lecture impossible : {error}</Text> : null}

      {ready && (
        <>
          <View style={styles.card}>
            <Text style={[styles.chordNow, { color: nowChord ? chordColor(nowChord) : C.muted }]}>{nowChord ?? '—'}</Text>
            <Text style={styles.muted}>Ensuite : {nextChord ?? '—'}</Text>
            <ScrollView ref={bar} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bar}>
              {chords.map((c, i) => (
                <TouchableOpacity key={i} onPress={() => seek(c.time)}
                  style={[styles.chip, { borderColor: chordColor(c.chord) }, i === current && { backgroundColor: chordColor(c.chord) }]}>
                  <Text style={[styles.chipText, i === current && styles.chipTextNow]}>{c.chord}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Décalage des accords : {shift > 0 ? '+' : ''}{shift.toFixed(1)} s</Text>
            <View style={styles.controls}>
              <TouchableOpacity style={styles.round} onPress={() => changeShift(0.1)}><Text style={styles.roundText}>◀ Plus tôt</Text></TouchableOpacity>
              <TouchableOpacity style={styles.round} onPress={() => changeShift(-0.1)}><Text style={styles.roundText}>Plus tard ▶</Text></TouchableOpacity>
            </View>
            <Text style={styles.muted}>Si les accords changent après la musique, appuie sur « Plus tôt » ; s'ils changent avant, sur « Plus tard ».</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.time}>{fmt(position)} / {fmt(song.duration)}</Text>
            <View style={styles.controls}>
              <TouchableOpacity style={styles.round} onPress={() => seek(position - 10)}><Text style={styles.roundText}>−10 s</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.round, styles.playBtn]} onPress={() => (playing ? pause() : play())}>
                <Text style={styles.playText}>{playing ? '⏸' : '▶︎'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.round} onPress={() => seek(position + 10)}><Text style={styles.roundText}>+10 s</Text></TouchableOpacity>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Je joue :</Text>
            <View style={styles.wrap}>
              {INSTRUMENTS.map((i) => (
                <TouchableOpacity key={i.id} onPress={() => changeInstrument(i.id)}
                  style={[styles.pill, song.instrument === i.id && styles.pillOn]}>
                  <Text style={[styles.pillText, song.instrument === i.id && styles.pillTextOn]}>{i.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.label}>Pistes :</Text>
            <View style={styles.wrap}>
              {TRACKS.map((t) => (
                <TouchableOpacity key={t} onPress={() => toggle(t)} style={[styles.stem, !enabled[t] && styles.stemOff]}>
                  <Text style={[styles.stemText, !enabled[t] && styles.stemTextOff]}>{TRACK_LABELS[t]}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingTop: 60, gap: 12 },
  back: { color: C.accent, fontSize: 16 },
  title: { color: C.text, fontSize: 22, fontWeight: '700' },
  muted: { color: C.muted, fontSize: 14 },
  err: { color: C.err, fontSize: 15 },
  label: { color: C.text, fontSize: 15, fontWeight: '600' },
  card: { backgroundColor: C.card, borderRadius: 14, padding: 14, gap: 10, alignItems: 'stretch' },
  chordNow: { fontSize: 64, fontWeight: '800', textAlign: 'center' },
  bar: { paddingVertical: 4, gap: 6 },
  chip: { width: CHIP - 6, paddingVertical: 10, borderRadius: 10, borderWidth: 2, alignItems: 'center' },
  chipText: { color: C.text, fontSize: 16, fontWeight: '600' },
  chipTextNow: { color: '#111' },
  time: { color: C.text, fontSize: 18, textAlign: 'center', fontVariant: ['tabular-nums'] },
  controls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 20 },
  round: { backgroundColor: C.chip, borderRadius: 30, paddingHorizontal: 16, paddingVertical: 12 },
  roundText: { color: C.text, fontSize: 15 },
  playBtn: { backgroundColor: C.accent, paddingHorizontal: 26, paddingVertical: 16 },
  playText: { color: '#111', fontSize: 26 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { backgroundColor: C.chip, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  pillOn: { backgroundColor: C.accent },
  pillText: { color: C.text, fontSize: 14 },
  pillTextOn: { color: '#111', fontWeight: '600' },
  stem: { width: '48%', backgroundColor: C.chip, borderRadius: 10, padding: 12, alignItems: 'center' },
  stemOff: { opacity: 0.35 },
  stemText: { color: C.text },
  stemTextOff: { textDecorationLine: 'line-through' },
});
