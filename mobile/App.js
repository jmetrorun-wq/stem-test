// Test de faisabilité : séparation htdemucs en natif sur iPhone
// (onnxruntime-react-native), là où Safari fermait la page faute de mémoire.

import { useEffect, useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { AudioContext, decodeAudioData } from 'react-native-audio-api';
import * as ort from 'onnxruntime-react-native';

import { Separator, SAMPLE_RATE, TRACKS, toInt16 } from '../separator.js';
import { chordColor, chromaToChords, detectKey } from '../chords.js';
import { MonolithRunner } from './monolithRunner.js';
import { deepChroma, loadDeepChroma, nativeDsp } from './nativeDsp.js';

// Modèle réexporté avec l'attention par paquets (tools/export_htdemucs.py) :
// ~1,3 Go au pic au lieu de 2,6-3,2 Go (l'app était tuée par iOS). Hébergé
// en release GitHub (fichier > 100 Mo, hors du dépôt), SHA-256
// 03781f4cfac687d8ca405e518f33c5fe187ea33db8cc1f019019b1313a02ae02.
const RELEASE = 'https://github.com/jmetrorun-wq/stem-test/releases/download/model-v1/';
const MODEL_URL = RELEASE + 'htdemucs_chunk128.onnx';
// Poids du « chroma profond » de madmom (accords), extraits par
// tools/chroma/export_deep_chroma.py. SHA-256
// 738c8219d804cbd2ea6a6ddbe85fc1bb88f0847316a2ff2696f56c6b78ced972.
const CHROMA_URL = RELEASE + 'deep_chroma.bin';

const LABELS = { drums: 'Batterie', bass: 'Basse', other: 'Autres (guitare, piano…)', vocals: 'Voix' };
const MODES = { cpu: 'processeur', cpu2: '2 cœurs rapides', coreml: 'Core ML', mlprogram: 'Core ML récent' };
// cpu2 : l'iPhone 13 a 2 cœurs rapides + 4 lents ; avec tous les cœurs,
// chaque étape attend les plus lents.
const THREADS = { cpu2: 2 };
// Drapeaux Core ML d'onnxruntime : 8 = formes d'entrée statiques
// uniquement, 16 = format ML Program (plus récent, fp16). Le mode
// « coreml » (ancien format NeuralNetwork) plantait au chargement.
const COREML_FLAGS = { coreml: 0, mlprogram: 8 | 16 };
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const modelFile = new File(Paths.document, 'htdemucs_chunk128.onnx');
const chromaFile = new File(Paths.document, 'deep_chroma.bin');
let chromaLoaded = false;
// Trace d'avancement écrite sur disque : si iOS tue l'app (mémoire), on
// retrouve au relancement l'étape où ça s'est arrêté.
const crumbFile = new File(Paths.document, 'crumb.json');
const crumb = (data) => { try { crumbFile.write(JSON.stringify(data)); } catch {} };
const readCrumb = () => { try { return crumbFile.exists ? JSON.parse(crumbFile.textSync()) : null; } catch { return null; } };

// Télécharge un fichier une seule fois (3 essais), s'il manque ou est
// incomplet.
async function ensureFile(file, url, minSize, label, onStatus) {
  if (file.exists && file.size >= minSize) return;
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      onStatus(`Téléchargement ${label}, une seule fois… essai ${attempt}/3`);
      if (file.exists) file.delete();
      await File.downloadFileAsync(url, file);
      return;
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`Téléchargement ${label} impossible (${lastError?.message || lastError})`);
}

export default function App() {
  const [previous] = useState(readCrumb);
  const [song, setSong] = useState(null);
  const [short, setShort] = useState(true);
  const [mode, setMode] = useState('cpu');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [detail, setDetail] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');
  const [stems, setStems] = useState(null);
  const [chords, setChords] = useState(null);
  const [key, setKey] = useState(null);
  const [position, setPosition] = useState(0);
  const [enabled, setEnabled] = useState(() => Object.fromEntries(TRACKS.map((t) => [t, true])));
  const [playing, setPlaying] = useState(false);
  const player = useRef({ ctx: null, source: null, startedAt: 0, offset: 0 });

  useEffect(() => {
    if (!busy) return undefined;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - t0) / 1000), 250);
    return () => clearInterval(id);
  }, [busy]);

  // Position de lecture (en boucle), pour afficher l'accord en cours.
  useEffect(() => {
    if (!playing || !stems) return undefined;
    const length = stems.vocals.left.length / SAMPLE_RATE;
    const id = setInterval(() => {
      const p = player.current;
      if (p.ctx) setPosition((p.ctx.currentTime - p.startedAt) % length);
    }, 100);
    return () => clearInterval(id);
  }, [playing, stems]);

  const current = chords ? chords.findIndex((c) => c.time <= position && position < c.end) : -1;
  const nowChord = current >= 0 ? chords[current].chord : null;
  const nextChord = current >= 0 ? chords.slice(current + 1).find((c) => c.chord !== 'N')?.chord : null;

  async function pick() {
    const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
    if (!res.canceled) setSong(res.assets[0]);
  }

  async function run() {
    stopPlayback();
    setBusy(true); setError(''); setSummary(''); setStems(null); setChords(null); setKey(null); setDetail('');
    await activateKeepAwakeAsync();
    const t0 = Date.now();
    try {
      setStatus('Décodage du fichier audio…');
      crumb({ phase: 'décodage', mode });
      const audio = await decodeAudioData(song.uri, SAMPLE_RATE);
      const keep = short ? Math.min(audio.length, 30 * SAMPLE_RATE) : audio.length;
      const duration = keep / SAMPLE_RATE;
      const left = toInt16(audio.getChannelData(0).subarray(0, keep));
      const right = audio.numberOfChannels > 1 ? toInt16(audio.getChannelData(1).subarray(0, keep)) : left;

      // Accords : chroma profond (natif) sur le mix complet, puis gabarits
      // (JS). Isoler les pistes n'améliorait pas la détection (mesuré sur
      // 3 morceaux), donc pas besoin d'attendre la séparation.
      crumb({ phase: 'accords', mode, duration });
      await ensureFile(chromaFile, CHROMA_URL, 3e6, 'des poids des accords (4 Mo)', setStatus);
      if (!chromaLoaded) { loadDeepChroma(chromaFile.uri); chromaLoaded = true; }
      setStatus('Détection des accords…');
      const tChords = Date.now();
      const chroma = deepChroma(left, right);
      const found = chromaToChords(chroma, duration);
      const songKey = detectKey(chroma);
      const chordSec = (Date.now() - tChords) / 1000;
      setChords(found);
      setKey(songKey);

      crumb({ phase: 'chargement du modèle', mode, duration });
      await ensureFile(modelFile, MODEL_URL, 100e6, 'du modèle (174 Mo)', setStatus);
      setStatus('Chargement du modèle…');
      const runner = new MonolithRunner(ort);
      // Optimisations de graphe désactivées : elles dupliquaient une partie
      // du modèle (pic mesuré 2,4 Go avec, 1,3 Go sans, pour ~20 % de temps
      // de calcul en plus).
      await runner.load(modelFile.uri, {
        executionProviders: mode in COREML_FLAGS
          ? [{ name: 'coreml', coreMlFlags: COREML_FLAGS[mode] }, { name: 'cpu', useArena: false }]
          : [{ name: 'cpu', useArena: false }],
        ...(THREADS[mode] ? { intraOpNumThreads: THREADS[mode] } : {}),
        graphOptimizationLevel: 'disabled',
        enableCpuMemArena: false,
        enableMemPattern: false,
      });
      const loadSec = (Date.now() - t0) / 1000;

      const sep = new Separator(runner, nativeDsp);
      let segment = 1, segments = '?', modelMs = 0;
      sep.onStep = (step) => crumb({ phase: 'séparation', done: segment, total: segments, step, mode, duration });
      setStatus('Séparation en cours…');
      const tSep = Date.now();
      const result = await sep.separate(left, right, ({ done, total, segmentMs }) => {
        segment = done + 1; segments = total;
        const spent = (Date.now() - tSep) / 1000;
        modelMs += runner.lastRunMs;
        setDetail(`Tranche ${done}/${total} — ${(segmentMs / 1000).toFixed(1)} s la tranche `
          + `(modèle ${(runner.lastRunMs / 1000).toFixed(1)} s, audio ${((segmentMs - runner.lastRunMs) / 1000).toFixed(1)} s) `
          + `— reste ~${fmt(spent / done * (total - done))}`);
      });
      const sepSec = (Date.now() - tSep) / 1000;
      crumb({ phase: 'fini' });
      setStems(result);
      setStatus('Terminé');
      setSummary(`✓ [${MODES[mode]}] Séparé en ${fmt(sepSec)} pour un morceau de ${fmt(duration)} `
        + `(dont modèle ${fmt(modelMs / 1000)}, audio ${fmt(sepSec - modelMs / 1000)}) `
        + `+ ${loadSec.toFixed(0)} s de décodage, accords et chargement du modèle. `
        + `${found.filter((c) => c.chord !== 'N').length} accords trouvés en ${chordSec.toFixed(1)} s, tonalité ${songKey.fr}`);
    } catch (e) {
      crumb({ phase: 'fini' });
      setStatus('Échec');
      setError(String(e?.message || e));
    } finally {
      deactivateKeepAwake();
      setBusy(false);
    }
  }

  // Lecture : mixe les pistes actives dans un AudioBuffer et le joue depuis
  // la position courante (relancé à chaque changement de piste).
  function startPlayback(active = enabled, offset = player.current.offset) {
    const p = player.current;
    p.ctx ??= new AudioContext({ sampleRate: SAMPLE_RATE });
    const length = stems.vocals.left.length;
    const buffer = p.ctx.createBuffer(2, length, SAMPLE_RATE);
    const on = TRACKS.filter((t) => active[t]).map((t) => stems[t]);
    for (const [c, key] of [[0, 'left'], [1, 'right']]) {
      const mix = new Float32Array(length);
      for (const s of on) { const src = s[key]; for (let i = 0; i < length; i++) mix[i] += src[i] / 32768; }
      buffer.copyToChannel(mix, c);
    }
    p.source?.stop();
    p.source = p.ctx.createBufferSource();
    p.source.buffer = buffer;
    p.source.loop = true;
    p.source.connect(p.ctx.destination);
    p.source.start(0, offset % (length / SAMPLE_RATE));
    p.startedAt = p.ctx.currentTime - offset;
    setPlaying(true);
  }

  function stopPlayback() {
    const p = player.current;
    if (p.source) {
      p.offset = p.ctx.currentTime - p.startedAt;
      p.source.stop();
      p.source = null;
    }
    setPlaying(false);
  }

  function toggleStem(t) {
    const next = { ...enabled, [t]: !enabled[t] };
    setEnabled(next);
    if (playing) {
      const p = player.current;
      startPlayback(next, p.ctx.currentTime - p.startedAt);
    }
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <StatusBar style="light" />
      <Image source={require('./assets/logo.png')} style={styles.logo} resizeMode="contain" />
      <Text style={styles.h1}>Test de séparation (app native)</Text>
      <Text style={styles.muted}>Tout se calcule sur ce téléphone, rien n'est envoyé.</Text>

      {previous && previous.phase !== 'fini' && (
        <View style={styles.card}>
          <Text style={styles.err}>⚠️ L'essai précédent s'est interrompu</Text>
          <Text style={styles.muted}>
            Étape : {previous.phase}
            {previous.done ? ` — tranche ${previous.done}/${previous.total}` : ''}
            {previous.step ? ` (étape : ${previous.step})` : ''}
            {previous.duration ? ` — morceau de ${fmt(previous.duration)}` : ''}
            {previous.mode ? ` — calcul sur ${MODES[previous.mode]}` : ''}
          </Text>
        </View>
      )}

      <View style={styles.card}>
        <TouchableOpacity style={styles.secondary} onPress={pick} disabled={busy}>
          <Text style={styles.secondaryText}>{song ? `🎵 ${song.name}` : 'Choisir un morceau'}</Text>
        </TouchableOpacity>
        <View style={styles.row}>
          <Text style={styles.label}>Seulement les 30 premières secondes</Text>
          <Switch value={short} onValueChange={setShort} disabled={busy} />
        </View>
        <View style={styles.row}>
          {Object.entries(MODES).map(([key, label]) => (
            <TouchableOpacity key={key} onPress={() => setMode(key)} disabled={busy}
              style={[styles.chip, mode === key && styles.chipOn]}>
              <Text style={[styles.chipText, mode === key && styles.chipTextOn]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={[styles.primary, (!song || busy) && styles.disabled]} onPress={run} disabled={!song || busy}>
          <Text style={styles.primaryText}>Séparer</Text>
        </TouchableOpacity>
      </View>

      {(busy || status) ? (
        <View style={styles.card}>
          <Text style={styles.muted}>{status}</Text>
          <Text style={styles.big}>{fmt(elapsed)}</Text>
          <Text style={styles.muted}>{detail}</Text>
          {summary ? <Text style={styles.ok}>{summary}</Text> : null}
          {error ? <Text style={styles.err}>Échec : {error}</Text> : null}
        </View>
      ) : null}

      {stems && (
        <View style={styles.card}>
          {chords && (
            <View style={styles.chordBox}>
              <Text style={styles.muted}>Tonalité : {key?.fr} — {fmt(position)}</Text>
              <Text style={[styles.chordNow, { color: nowChord ? chordColor(nowChord) : C.muted }]}>
                {!nowChord || nowChord === 'N' ? '—' : nowChord}
              </Text>
              <Text style={styles.muted}>Ensuite : {nextChord ?? '—'}</Text>
            </View>
          )}
          <View style={styles.stems}>
            {TRACKS.map((t) => (
              <TouchableOpacity key={t} onPress={() => toggleStem(t)} style={[styles.stem, !enabled[t] && styles.stemOff]}>
                <Text style={[styles.stemText, !enabled[t] && styles.stemTextOff]}>{LABELS[t]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.primary} onPress={() => (playing ? stopPlayback() : startPlayback())}>
            <Text style={styles.primaryText}>{playing ? '⏸ Pause' : '▶︎ Écouter'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const C = { bg: '#000000', card: '#1f232c', text: '#eef0f4', muted: '#9aa3b2', accent: '#f2b8a3', ok: '#a3c9a8', err: '#f28b8b', chip: '#2a2f3a' };

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingTop: 64, gap: 12 },
  logo: { width: '70%', height: 200, alignSelf: 'center' },
  h1: { color: C.text, fontSize: 22, fontWeight: '700' },
  muted: { color: C.muted, fontSize: 14, lineHeight: 20 },
  label: { color: C.text, fontSize: 15, flex: 1 },
  card: { backgroundColor: C.card, borderRadius: 14, padding: 14, gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  primary: { backgroundColor: C.accent, borderRadius: 10, padding: 14, alignItems: 'center' },
  primaryText: { color: '#1a1a1a', fontWeight: '700', fontSize: 16 },
  secondary: { backgroundColor: C.chip, borderRadius: 10, padding: 14, alignItems: 'center' },
  secondaryText: { color: C.text, fontSize: 15 },
  disabled: { opacity: 0.4 },
  chip: { width: '48%', backgroundColor: C.chip, borderRadius: 10, padding: 10, alignItems: 'center' },
  chipOn: { backgroundColor: C.accent },
  chipText: { color: C.text, fontSize: 14 },
  chipTextOn: { color: '#1a1a1a', fontWeight: '600' },
  big: { color: C.text, fontSize: 32, fontWeight: '700', fontVariant: ['tabular-nums'] },
  ok: { color: C.ok, fontSize: 15 },
  err: { color: C.err, fontSize: 15 },
  stems: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chordBox: { alignItems: 'center', gap: 4 },
  chordNow: { fontSize: 56, fontWeight: '800' },
  stem: { width: '48%', backgroundColor: C.chip, borderRadius: 10, padding: 12, alignItems: 'center' },
  stemOff: { opacity: 0.35 },
  stemText: { color: C.text },
  stemTextOff: { textDecorationLine: 'line-through' },
});
