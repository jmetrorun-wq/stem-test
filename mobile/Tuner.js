// Accordeur façon GuitarTuna : tête d'instrument avec ses mécaniques (la
// corde jouée est reconnue automatiquement et s'allume, coche verte une
// fois accordée), cadran en demi-cercle avec aiguille, conseil « resserre /
// desserre », vert quand c'est juste. Toucher une mécanique verrouille la
// corde et joue son son de référence. Accordages : guitare standard,
// Drop D, ½ ton plus bas, basse, ukulélé, chromatique.
//
// Moteur repris de l'accordeur de ChordSplit (static/tuner.js) :
// détection McLeod en natif (PitchDetector.swift), filtre médian sur 5
// mesures, re-convergence rapide quand on change de corde, silence toléré
// 250 ms, « clic » de validation après 150 ms juste à ±5 cents, et micro
// ignoré ~2,5 s pendant le son de référence (sinon il s'écoute lui-même).

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AudioContext, AudioManager, AudioRecorder } from 'react-native-audio-api';

import { detectPitch, resetPitch } from './nativeDsp.js';
import { C } from './theme.js';
import { TUNINGS, nearestNote, nearestString, pluck } from './tunings.js';

const SAMPLE_RATE = 44100;
const BUFFER = 2048;   // échantillons par rappel du micro (~21 /s)
const WINDOW = 4096;   // fenêtre d'analyse
const HISTORY = 5;     // filtre médian
const IN_TUNE = 5;     // cents
const SILENCE_MS = 250;
const REFERENCE_MS = 2500;

const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const centsBetween = (hz, target) => 1200 * Math.log2(hz / target);
const colorFor = (cents) => (Math.abs(cents) <= IN_TUNE ? '#4CAF50' : Math.abs(cents) <= 15 ? '#FFB74D' : '#EF5350');

export default function Tuner({ onBack }) {
  const [tuningId, setTuningId] = useState('guitar');
  const tuning = TUNINGS.find((t) => t.id === tuningId);
  const [manual, setManual] = useState(null);      // corde verrouillée, null = auto
  const [reading, setReading] = useState(null);    // { target, hz, cents, index }
  const [tuned, setTuned] = useState({});          // cordes déjà accordées
  const [error, setError] = useState('');
  const needle = useRef(new Animated.Value(0)).current;

  // État du moteur, lu par le rappel du micro (toujours à jour).
  const engine = useRef({
    window: new Float32Array(WINDOW), history: [], smooth: 0, lastVoice: 0,
    inTuneSince: 0, confirmed: false, muteUntil: 0, tuning, manual: null,
    ctx: null, recorder: null, plucks: {},
  }).current;
  engine.tuning = tuning;
  engine.manual = manual;

  function playConfirm() {
    const ctx = engine.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    [[0, 1320], [0.085, 1980]].forEach(([dt, hz]) => {
      const o = ctx.createOscillator();
      o.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + dt + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.13);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t0 + dt);
      o.stop(t0 + dt + 0.16);
    });
  }

  function onSamples(samples) {
    const e = engine;
    // Fenêtre glissante des WINDOW derniers échantillons.
    e.window.copyWithin(0, samples.length);
    e.window.set(samples, WINDOW - samples.length);
    const now = Date.now();
    if (now < e.muteUntil) return; // son de référence en cours
    const t = e.tuning;
    const hz = detectPitch(e.window, SAMPLE_RATE, t.fmin, t.fmax);
    if (hz > 0) {
      e.history.push(hz);
      if (e.history.length > HISTORY) e.history.shift();
      e.lastVoice = now;
      if (e.history.length < 2) return;
      let med = median(e.history);
      // Changement de corde probable : on resserre sur les mesures récentes.
      if (e.smooth && Math.abs(med - e.smooth) / e.smooth > 0.06) {
        e.history = e.history.slice(-2);
        med = median([...e.history, hz]);
      }
      e.smooth = med;
      let target, index = null;
      if (t.strings.length) {
        index = e.manual ?? nearestString(t.strings, med);
        target = t.strings[index];
      } else {
        target = nearestNote(med);
      }
      const cents = centsBetween(med, target.hz);
      if (Math.abs(cents) <= IN_TUNE) {
        if (!e.inTuneSince) e.inTuneSince = now;
        if (!e.confirmed && now - e.inTuneSince >= 150) {
          e.confirmed = true;
          playConfirm();
          if (index !== null) setTuned((prev) => ({ ...prev, [`${t.id}-${index}`]: true }));
        }
      } else if (Math.abs(cents) > 12) {
        e.inTuneSince = 0;
        e.confirmed = false;
      }
      setReading({ target, hz: med, cents, index });
      Animated.timing(needle, { toValue: Math.max(-50, Math.min(50, cents)), duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    } else if (now - e.lastVoice > SILENCE_MS && e.smooth) {
      e.history = [];
      e.smooth = 0;
      e.inTuneSince = 0;
      e.confirmed = false;
      setReading(null);
      Animated.timing(needle, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        AudioManager.setAudioSessionOptions({ iosCategory: 'playAndRecord', iosMode: 'default', iosOptions: ['defaultToSpeaker', 'allowBluetoothA2DP'] });
        const permission = await AudioManager.requestRecordingPermissions();
        if (permission !== 'Granted') { setError('Autorise le micro dans Réglages > ChordSplit pour utiliser l\'accordeur.'); return; }
        if (cancelled) return;
        engine.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
        resetPitch();
        const recorder = new AudioRecorder();
        recorder.onAudioReady({ sampleRate: SAMPLE_RATE, bufferLength: BUFFER, channelCount: 1 },
          ({ buffer }) => onSamples(buffer.getChannelData(0)));
        const started = await recorder.start();
        if (started?.status === 'error') throw new Error(started.message);
        engine.recorder = recorder;
      } catch (err) {
        setError(`Micro indisponible : ${err?.message || err}`);
      }
    })();
    return () => {
      cancelled = true;
      try { engine.recorder?.clearOnAudioReady(); engine.recorder?.stop(); } catch {}
      engine.recorder = null;
      engine.ctx?.close();
      engine.ctx = null;
      // Retour à la lecture seule (sortie haut-parleur normale) pour le lecteur.
      AudioManager.setAudioSessionOptions({ iosCategory: 'playback', iosMode: 'default', iosOptions: [] });
    };
  }, []);

  function chooseString(i) {
    const next = manual === i ? null : i;
    setManual(next);
    engine.history = [];
    if (next === null || !engine.ctx) return;
    // Son de référence : le micro est ignoré le temps qu'il sonne.
    const s = tuning.strings[i];
    const key = `${s.name}${s.octave}`;
    if (!engine.plucks[key]) {
      const data = pluck(s.hz, SAMPLE_RATE);
      const buffer = engine.ctx.createBuffer(1, data.length, SAMPLE_RATE);
      buffer.copyToChannel(data, 0);
      engine.plucks[key] = buffer;
    }
    const source = engine.ctx.createBufferSource();
    source.buffer = engine.plucks[key];
    source.connect(engine.ctx.destination);
    source.start();
    engine.muteUntil = Date.now() + REFERENCE_MS;
  }

  function chooseTuning(id) {
    setTuningId(id);
    setManual(null);
    setReading(null);
    engine.history = [];
    engine.smooth = 0;
  }

  const cents = reading?.cents ?? 0;
  const color = reading ? colorFor(cents) : C.muted;
  const rotate = needle.interpolate({ inputRange: [-50, 50], outputRange: ['-60deg', '60deg'] });
  const advice = !reading ? (tuning.strings.length ? 'Joue une corde' : 'Joue une note')
    : Math.abs(cents) <= IN_TUNE ? 'Juste !'
      : cents < 0 ? 'Trop bas — resserre' : 'Trop haut — desserre';

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ Bibliothèque</Text></TouchableOpacity>
      <Text style={styles.title}>Accordeur</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tunings}>
        {TUNINGS.map((t) => (
          <TouchableOpacity key={t.id} onPress={() => chooseTuning(t.id)} style={[styles.pill, t.id === tuningId && styles.pillOn]}>
            <Text style={[styles.pillText, t.id === tuningId && styles.pillTextOn]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {error ? <Text style={styles.err}>{error}</Text> : null}

      <Gauge rotate={rotate} color={color} reading={reading} advice={advice} />

      {tuning.strings.length > 0 && (
        <Headstock tuning={tuning} active={manual ?? reading?.index ?? null} manual={manual}
          tuned={tuned} onPick={chooseString} />
      )}
      <Text style={styles.hint}>
        {tuning.strings.length
          ? (manual === null ? 'Mode automatique : la corde jouée est reconnue. Touche une mécanique pour l\'entendre et la verrouiller.'
            : 'Corde verrouillée. Touche-la de nouveau pour revenir au mode automatique.')
          : 'Mode chromatique : n\'importe quelle note, pour tout instrument ou la voix.'}
      </Text>
    </ScrollView>
  );
}

// ── Cadran ───────────────────────────────────────────────────────────

const R = 120;
const TICKS = Array.from({ length: 21 }, (_, i) => -50 + i * 5);

function Gauge({ rotate, color, reading, advice }) {
  // Chaque graduation et l'aiguille sont posées en haut d'un carré de
  // côté 2R centré sur le pivot : la rotation par défaut (autour du
  // centre du carré) les fait tourner autour du pivot. Le bas du carré
  // est masqué (demi-cercle).
  return (
    <View style={styles.gauge}>
      <View style={styles.arc}>
        {TICKS.map((c) => (
          <View key={c} style={[styles.square, { transform: [{ rotate: `${c * 1.2}deg` }] }]}>
            <View style={{ width: c % 25 === 0 ? 3 : 2, height: c % 25 === 0 ? 18 : 10, borderRadius: 1,
              backgroundColor: Math.abs(c) <= IN_TUNE ? '#4CAF50' : '#4a5060' }} />
          </View>
        ))}
        <Animated.View style={[styles.square, { transform: [{ rotate }] }]}>
          <View style={{ marginTop: 14, width: 4, height: R - 14, borderRadius: 2, backgroundColor: color }} />
        </Animated.View>
        <View style={[styles.hub, { backgroundColor: color }]} />
      </View>
      <Text style={[styles.note, { color }]}>
        {reading ? reading.target.name : '—'}
        <Text style={styles.octave}>{reading ? reading.target.octave : ''}</Text>
      </Text>
      <Text style={styles.cents}>
        {reading ? `${reading.cents > 0 ? '+' : ''}${Math.round(reading.cents)} cents — ${reading.hz.toFixed(1)} Hz` : ' '}
      </Text>
      <Text style={[styles.advice, { color }]}>{advice}</Text>
    </View>
  );
}

// ── Tête d'instrument ────────────────────────────────────────────────

function Headstock({ tuning, active, manual, tuned, onPick }) {
  const n = tuning.strings.length;
  const half = Math.ceil(n / 2);
  // Comme sur un manche vu de face : cordes graves à gauche (de bas en
  // haut), aiguës à droite (de haut en bas).
  const left = tuning.strings.slice(0, half).map((s, i) => ({ s, i })).reverse();
  const right = tuning.strings.slice(half).map((s, k) => ({ s, i: half + k }));
  const peg = ({ s, i }) => {
    const isActive = active === i;
    const done = tuned[`${tuning.id}-${i}`];
    return (
      <TouchableOpacity key={i} onPress={() => onPick(i)}
        style={[styles.peg, isActive && styles.pegActive, manual === i && styles.pegLocked]}>
        <Text style={[styles.pegText, isActive && styles.pegTextActive]}>{s.name}</Text>
        {done ? <View style={styles.check}><Text style={styles.checkText}>✓</Text></View> : null}
      </TouchableOpacity>
    );
  };
  return (
    <View style={styles.headRow}>
      <View style={styles.pegColumn}>{left.map(peg)}</View>
      <View style={styles.head}>
        {tuning.strings.map((s, i) => (
          <View key={i} style={[styles.headString, active === i && styles.headStringActive]} />
        ))}
      </View>
      <View style={styles.pegColumn}>{right.map(peg)}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingTop: 60, gap: 14 },
  back: { color: C.accent, fontSize: 16 },
  title: { color: C.text, fontSize: 24, fontWeight: '700' },
  tunings: { gap: 8 },
  pill: { backgroundColor: C.chip, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  pillOn: { backgroundColor: C.accent },
  pillText: { color: C.text, fontSize: 14 },
  pillTextOn: { color: '#111', fontWeight: '600' },
  err: { color: C.err, fontSize: 15 },
  hint: { color: C.muted, fontSize: 13, textAlign: 'center', lineHeight: 19 },

  gauge: { alignItems: 'center', backgroundColor: C.card, borderRadius: 16, paddingTop: 18, paddingBottom: 14 },
  // Pivot au point (R, R + 6) de la zone visible, haute de R + 14.
  arc: { width: 2 * R, height: R + 14, overflow: 'hidden' },
  square: { position: 'absolute', left: 0, top: 6, width: 2 * R, height: 2 * R, alignItems: 'center' },
  hub: { position: 'absolute', left: R - 8, top: R + 6 - 8, width: 16, height: 16, borderRadius: 8 },
  note: { fontSize: 64, fontWeight: '800', marginTop: 6 },
  octave: { fontSize: 22, fontWeight: '600' },
  cents: { color: C.muted, fontSize: 14 },
  advice: { fontSize: 18, fontWeight: '700', marginTop: 6 },

  headRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 14 },
  pegColumn: { gap: 14 },
  peg: { width: 54, height: 54, borderRadius: 27, backgroundColor: C.chip, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  pegActive: { backgroundColor: C.accent },
  pegLocked: { borderColor: '#fff' },
  pegText: { color: C.text, fontSize: 20, fontWeight: '700' },
  pegTextActive: { color: '#111' },
  check: { position: 'absolute', right: -4, top: -4, width: 20, height: 20, borderRadius: 10, backgroundColor: '#4CAF50', alignItems: 'center', justifyContent: 'center' },
  checkText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  head: { width: 96, height: 210, backgroundColor: '#3b2a20', borderTopLeftRadius: 40, borderTopRightRadius: 40, borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
    flexDirection: 'row', justifyContent: 'space-evenly', paddingTop: 30 },
  headString: { width: 2, height: '100%', backgroundColor: '#c9b48a', opacity: 0.6 },
  headStringActive: { backgroundColor: '#fff', opacity: 1, width: 3 },
});
