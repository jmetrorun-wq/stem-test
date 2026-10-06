// Analyse complète d'un morceau sur le téléphone : décodage, séparation des
// 4 pistes (htdemucs, onnxruntime), accords (méthode B de chords.js :
// chroma profond de la piste « autres » + note de la piste basse), puis
// enregistrement dans la bibliothèque.

import { File, Paths } from 'expo-file-system';
import { decodeAudioData } from 'react-native-audio-api';
import * as ort from 'onnxruntime-react-native';

import { Separator, SAMPLE_RATE, toInt16 } from '../separator.js';
import { CHORD_TIMING, combineChroma, detectChords, detectKey, spellChord, spellKey } from '../chords.js';
import { MonolithRunner } from './monolithRunner.js';
import { bassChroma, deepChroma, loadDeepChroma, nativeDsp } from './nativeDsp.js';
import { newSongId, saveSong } from './library.js';

const RELEASE = 'https://github.com/jmetrorun-wq/stem-test/releases/download/model-v1/';
// Modèle réexporté avec l'attention par paquets (tools/export_htdemucs.py) :
// ~1,3 Go au pic au lieu de 2,6-3,2 Go (l'app était tuée par iOS). SHA-256
// 03781f4cfac687d8ca405e518f33c5fe187ea33db8cc1f019019b1313a02ae02.
const MODEL_URL = RELEASE + 'htdemucs_chunk128.onnx';
// Poids du « chroma profond » de madmom (tools/chroma/export_deep_chroma.py).
// SHA-256 738c8219d804cbd2ea6a6ddbe85fc1bb88f0847316a2ff2696f56c6b78ced972.
const CHROMA_URL = RELEASE + 'deep_chroma.bin';

const modelFile = new File(Paths.document, 'htdemucs_chunk128.onnx');
const chromaFile = new File(Paths.document, 'deep_chroma.bin');
let chromaLoaded = false;

// Trace d'avancement écrite sur disque : si iOS tue l'app (mémoire), on
// retrouve au relancement l'étape où ça s'est arrêté.
const crumbFile = new File(Paths.document, 'crumb.json');
export const crumb = (data) => { try { crumbFile.write(JSON.stringify(data)); } catch {} };
export const readCrumb = () => {
  try { return crumbFile.exists ? JSON.parse(crumbFile.textSync()) : null; } catch { return null; }
};

export const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Laisse l'interface afficher un statut avant un calcul natif synchrone.
const repaint = () => new Promise((r) => setTimeout(r, 50));

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

/**
 * source : { uri, name } (sélecteur de fichiers). Renvoie les infos du
 * morceau enregistré (cf. library.js).
 */
export async function analyzeSong(source, { instrument, short, onStatus, onDetail }) {
  const t0 = Date.now();
  onStatus('Décodage du fichier audio…');
  crumb({ phase: 'décodage' });
  const audio = await decodeAudioData(source.uri, SAMPLE_RATE);
  const keep = short ? Math.min(audio.length, 30 * SAMPLE_RATE) : audio.length;
  const duration = keep / SAMPLE_RATE;
  const left = toInt16(audio.getChannelData(0).subarray(0, keep));
  const right = audio.numberOfChannels > 1 ? toInt16(audio.getChannelData(1).subarray(0, keep)) : left;

  // Téléchargements d'abord : rien ne doit échouer après 4 min de calcul.
  await ensureFile(chromaFile, CHROMA_URL, 3e6, 'des poids des accords (4 Mo)', onStatus);
  crumb({ phase: 'chargement du modèle', duration });
  await ensureFile(modelFile, MODEL_URL, 100e6, 'du modèle de séparation (174 Mo)', onStatus);
  onStatus('Chargement du modèle…');
  const runner = new MonolithRunner(ort);
  // Optimisations de graphe désactivées : elles dupliquaient une partie du
  // modèle (pic mesuré 2,4 Go avec, 1,3 Go sans, ~20 % plus lent).
  await runner.load(modelFile.uri, {
    executionProviders: [{ name: 'cpu', useArena: false }],
    graphOptimizationLevel: 'disabled',
    enableCpuMemArena: false,
    enableMemPattern: false,
  });

  const sep = new Separator(runner, nativeDsp);
  let segment = 1, segments = '?';
  sep.onStep = (step) => crumb({ phase: 'séparation', done: segment, total: segments, step, duration });
  onStatus('Séparation des pistes…');
  const tSep = Date.now();
  const stems = await sep.separate(left, right, ({ done, total }) => {
    segment = done + 1; segments = total;
    const spent = (Date.now() - tSep) / 1000;
    onDetail({ progress: done / total, remaining: spent / done * (total - done) });
  });

  // Accords : sur les pistes séparées (l'accord sur « autres », la vraie
  // basse sur « basse »), cf. méthode B de chords.js.
  crumb({ phase: 'accords', duration });
  onStatus('Détection des accords…');
  await repaint();
  if (!chromaLoaded) { loadDeepChroma(chromaFile.uri); chromaLoaded = true; }
  const otherChroma = deepChroma(stems.other.left, stems.other.right);
  const bass = bassChroma(stems.bass.left, stems.bass.right);
  const key = detectKey(combineChroma(otherChroma, bass));
  const chords = detectChords(otherChroma, bass, duration).map((c) => ({ ...c, chord: spellChord(c.chord, key) }));

  onStatus('Enregistrement des pistes…');
  crumb({ phase: 'enregistrement', duration });
  await repaint();
  const meta = {
    id: newSongId(),
    title: (source.name || 'Morceau').replace(/\.[^.]+$/, ''),
    duration,
    key: spellKey(key),
    chords,
    chordTiming: CHORD_TIMING,
    chordMethod: 'B',
    instrument,
    createdAt: Date.now(),
    analysisSeconds: Math.round((Date.now() - t0) / 1000),
  };
  saveSong(meta, stems);
  crumb({ phase: 'fini' });
  return meta;
}
