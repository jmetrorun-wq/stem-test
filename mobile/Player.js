// Écran de jeu : les 4 pistes jouées ensemble, chacune avec son propre
// volume (couper / remettre un instrument est instantané, sans remixage),
// l'accord en cours en grand et la barre des temps qui défile (barre des
// accords pour les morceaux analysés avant la détection des temps).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AudioContext, decodeAudioData } from 'react-native-audio-api';
import { File, Paths } from 'expo-file-system';

import { SAMPLE_RATE, TRACKS } from '../separator.js';
import { CHORD_TIMING, DETECTION_LAG, chordColor } from '../chords.js';
import { beatCells } from '../beats.js';
import BeatStrip from './BeatStrip.js';
import ChordDiagram from './ChordDiagram.js';
import { fmt } from './analyze.js';
import { stemUri, updateSong } from './library.js';
import { C, INSTRUMENTS, TRACK_LABELS } from './theme.js';

const CHIP = 96; // largeur d'une case d'accord (+ marge) : tient « Bbm7b5/E »

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
  // Lu par les fonctions passées à la barre des temps (mémorisée, elle ne
  // reçoit pas les nouvelles versions) : toujours à jour.
  const playingRef = useRef(false);
  const [syncKey, setSyncKey] = useState(0);
  // Diagramme affiché (guitare / piano) et clic sur les temps : mémorisés.
  const [diagram, setDiagram] = useState(() => readSettings().diagram ?? (song.instrument === 'guitar' ? 'guitar' : 'piano'));
  const [click, setClick] = useState(() => readSettings().click ?? false);
  const chooseDiagram = (d) => { setDiagram(d); writeSettings({ diagram: d }); };
  const toggleClick = () => { const next = !click; setClick(next); writeSettings({ click: next }); };
  // Diagnostic : retard maximal du JS sur les 2 dernières secondes
  // (minuterie de 100 ms qui arrive en retard = JS surchargé).
  const [jsLag, setJsLag] = useState(0);
  useEffect(() => {
    let last = Date.now(), worst = 0, since = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      worst = Math.max(worst, now - last - 100);
      last = now;
      if (now - since >= 2000) { setJsLag(worst); worst = 0; since = now; }
    }, 100);
    return () => clearInterval(id);
  }, []);
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
  const chords = useMemo(() => song.chords.filter((c) => c.chord !== 'N')
    .map((c) => (lag ? { ...c, time: Math.max(0, c.time - lag), end: c.end - lag } : c)), [song.id]);
  const cells = useMemo(() => (song.grid ? beatCells(song.grid, song.chords, song.duration) : null), [song.id]);
  const getTime = useCallback(() => {
    const a = audio.current;
    if (!playingRef.current || !a.ctx) return a.offset;
    return Math.max(0, a.ctx.currentTime - a.startedAt);
  }, []);

  // Clic sur les temps détectés (accent sur le premier temps de la
  // mesure) : programmé sur l'horloge audio par petites avances de 0,5 s,
  // donc exactement calé sur la musique quel que soit le retard du JS.
  useEffect(() => {
    const grid = song.grid;
    const a = audio.current;
    if (!playing || !click || !grid || !a.ctx) return undefined;
    if (!a.clicks) {
      const make = (freq) => {
        const n = Math.round(0.03 * SAMPLE_RATE);
        const data = new Float32Array(n);
        for (let i = 0; i < n; i++) data[i] = 0.7 * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE) * Math.exp(-i / (0.006 * SAMPLE_RATE));
        const buffer = a.ctx.createBuffer(1, n, SAMPLE_RATE);
        buffer.copyToChannel(data, 0);
        return buffer;
      };
      a.clicks = { accent: make(1600), normal: make(1000), gain: a.ctx.createGain() };
      a.clicks.gain.connect(a.ctx.destination);
    }
    const { beatTimes, beatsPerBar, phase } = grid;
    const now = getTime();
    let next = beatTimes.findIndex((t) => t >= now);
    if (next < 0) return undefined;
    const scheduled = [];
    const schedule = () => {
      const horizon = getTime() + 0.5;
      while (next < beatTimes.length && beatTimes[next] < horizon) {
        const source = a.ctx.createBufferSource();
        const accent = next >= phase && (next - phase) % beatsPerBar === 0;
        source.buffer = accent ? a.clicks.accent : a.clicks.normal;
        source.connect(a.clicks.gain);
        source.start(a.startedAt + beatTimes[next]);
        scheduled.push(source);
        next++;
      }
      if (scheduled.length > 16) scheduled.splice(0, scheduled.length - 16);
    };
    schedule();
    const id = setInterval(schedule, 150);
    return () => { clearInterval(id); for (const s of scheduled) { try { s.stop(); } catch {} } };
  }, [playing, click, syncKey]);

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
      if (t >= song.duration) { pause(); audio.current.offset = 0; setPosition(0); setSyncKey((k) => k + 1); return; }
      setPosition(Math.max(0, t));
    }, 100);
    return () => clearInterval(id);
  }, [playing]);

  const chordPos = position + shift;
  const current = chords.findIndex((c) => c.time <= chordPos && chordPos < c.end);
  const nowChord = current >= 0 ? chords[current].chord : null;
  const nextChord = current >= 0 ? chords[current + 1]?.chord : chords.find((c) => c.time > chordPos)?.chord;

  // Garde l'accord en cours au centre de la barre (ancienne barre des accords).
  useEffect(() => {
    if (!cells && current >= 0) bar.current?.scrollTo({ x: Math.max(0, current * CHIP - 140), animated: true });
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
    a.offset = from;
    playingRef.current = true;
    setPosition(from);
    setPlaying(true);
    setSyncKey((k) => k + 1);
  }

  function pause() {
    const a = audio.current;
    a.offset = Math.max(0, a.ctx.currentTime - a.startedAt);
    for (const s of a.sources) { try { s.stop(); } catch {} }
    a.sources = [];
    playingRef.current = false;
    setPlaying(false);
    setSyncKey((k) => k + 1);
  }

  function seek(t) {
    const target = Math.min(Math.max(0, t), song.duration - 0.5);
    audio.current.offset = target;
    if (playingRef.current) play(target);
    else { setPosition(target); setSyncKey((k) => k + 1); }
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
      <Text style={styles.muted}>
        Tonalité : {song.key?.fr} — {fmt(song.duration)}
        {song.grid ? ` — ♩ = ${song.grid.tempo}, ${song.grid.beatsPerBar} temps` : ''}
      </Text>

      {!ready && !error && (
        <View style={styles.card}><ActivityIndicator color={C.accent} /><Text style={styles.muted}>Chargement des pistes…</Text></View>
      )}
      {error ? <Text style={styles.err}>Lecture impossible : {error}</Text> : null}

      {ready && (
        <>
          <View style={styles.card}>
            <Text style={[styles.chordNow, { color: nowChord ? chordColor(nowChord) : C.muted }]}
              numberOfLines={1} adjustsFontSizeToFit>{nowChord ?? '—'}</Text>
            <Text style={styles.muted}>Ensuite : {nextChord ?? '—'}</Text>
            <View style={styles.toggle}>
              {[['guitar', 'Guitare'], ['piano', 'Piano']].map(([id, label]) => (
                <TouchableOpacity key={id} onPress={() => chooseDiagram(id)} style={[styles.toggleItem, diagram === id && styles.toggleOn]}>
                  <Text style={[styles.toggleText, diagram === id && styles.toggleTextOn]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <ChordDiagram name={nowChord} instrument={diagram} />
            {cells ? (
              <BeatStrip cells={cells} playing={playing} getTime={getTime} syncKey={syncKey} onSeek={seek} />
            ) : (
              <ScrollView ref={bar} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bar}>
                {chords.map((c, i) => (
                  <TouchableOpacity key={i} onPress={() => seek(c.time)}
                    style={[styles.chip, { borderColor: chordColor(c.chord) }, i === current && { backgroundColor: chordColor(c.chord) }]}>
                    <Text style={[styles.chipText, i === current && styles.chipTextNow]}
                      numberOfLines={1} adjustsFontSizeToFit>{c.chord}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
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
            {song.grid && (
              <TouchableOpacity onPress={toggleClick} style={[styles.pill, styles.clickBtn, click && styles.pillOn]}>
                <Text style={[styles.pillText, click && styles.pillTextOn]}>{click ? '🔔 Clic sur les temps : oui' : '🔕 Clic sur les temps : non'}</Text>
              </TouchableOpacity>
            )}
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
      <Text style={styles.debug}>Diagnostic — retard du JS : {jsLag} ms{jsLag > 300 ? ' (surchargé)' : ''}</Text>
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
  chip: { width: CHIP - 6, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 10, borderWidth: 2, alignItems: 'center' },
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
  toggle: { flexDirection: 'row', alignSelf: 'center', backgroundColor: C.chip, borderRadius: 10, padding: 3, gap: 3 },
  toggleItem: { paddingHorizontal: 18, paddingVertical: 6, borderRadius: 8 },
  toggleOn: { backgroundColor: C.accent },
  toggleText: { color: C.text, fontSize: 14 },
  toggleTextOn: { color: '#111', fontWeight: '600' },
  clickBtn: { alignSelf: 'center' },
  debug: { color: '#555b68', fontSize: 11, textAlign: 'center', marginTop: 8 },
});
