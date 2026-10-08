// ChordSplit (nom de travail « Stem Test ») : sépare un morceau en pistes et
// détecte ses accords directement sur l'iPhone, pour jouer à la place d'un
// instrument. Écrans : bibliothèque -> nouveau morceau -> analyse -> jeu.

import { useEffect, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Updates from 'expo-updates';

import { analyzeSong, fmt, readCrumb } from './analyze.js';
import { deleteSong, listSongs, songSizeMb } from './library.js';
import Player from './Player.js';
import { C, INSTRUMENTS } from './theme.js';

// Version autonome (build « preview ») : au lancement, si une mise à jour
// EAS Update est disponible, la télécharger et redémarrer dessus tout de
// suite (sinon elle ne s'appliquerait qu'au lancement suivant). Seulement
// depuis la bibliothèque, jamais pendant une analyse.
function useUpdateOnLaunch() {
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;
    (async () => {
      try {
        const check = await Updates.checkForUpdateAsync();
        if (!check.isAvailable) return;
        setStatus('Mise à jour de l\'app…');
        await Updates.fetchUpdateAsync();
        await Updates.reloadAsync();
      } catch {
        setStatus(''); // hors connexion : on garde la version actuelle
      }
    })();
  }, []);
  return status;
}

const versionLabel = () => {
  const date = Updates.createdAt ? Updates.createdAt.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : null;
  if (Updates.isEmbeddedLaunch || !date) return 'Version intégrée au build';
  return `Mise à jour du ${date}`;
};

export default function App() {
  const updating = useUpdateOnLaunch();
  const [screen, setScreen] = useState('library');
  const [songs, setSongs] = useState(listSongs);
  const [current, setCurrent] = useState(null);
  const [previous, setPrevious] = useState(readCrumb);

  const refresh = () => setSongs(listSongs());
  const open = (song) => { setCurrent(song); setScreen('play'); };

  if (screen === 'play' && current) {
    return <><StatusBar style="light" /><Player song={current} onBack={() => { refresh(); setScreen('library'); }} /></>;
  }
  if (screen === 'new') {
    return (
      <>
        <StatusBar style="light" />
        <NewSong
          onCancel={() => setScreen('library')}
          onDone={(song) => { setPrevious(null); refresh(); open(song); }}
        />
      </>
    );
  }
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <StatusBar style="light" />
      <Image source={require('./assets/logo.png')} style={styles.logo} resizeMode="contain" />
      {updating ? <Text style={styles.hint}>{updating}</Text> : null}

      {previous && previous.phase !== 'fini' && (
        <View style={styles.card}>
          <Text style={styles.err}>⚠️ La dernière analyse s'est interrompue</Text>
          <Text style={styles.muted}>
            Étape : {previous.phase}
            {previous.done ? ` — tranche ${previous.done}/${previous.total}` : ''}
            {previous.step ? ` (${previous.step})` : ''}
            {previous.duration ? ` — morceau de ${fmt(previous.duration)}` : ''}
          </Text>
        </View>
      )}

      <TouchableOpacity style={styles.primary} onPress={() => setScreen('new')}>
        <Text style={styles.primaryText}>＋ Nouveau morceau</Text>
      </TouchableOpacity>

      <Text style={styles.h2}>Mes morceaux</Text>
      {songs.length === 0 && (
        <Text style={styles.muted}>Aucun morceau pour l'instant. Ajoute un fichier audio : l'app sépare les pistes et trouve les accords, directement sur ton téléphone.</Text>
      )}
      {songs.map((song) => (
        <TouchableOpacity key={song.id} style={styles.songRow} onPress={() => open(song)}
          onLongPress={() => Alert.alert(song.title, `${songSizeMb(song.id).toFixed(0)} Mo sur le téléphone`, [
            { text: 'Annuler', style: 'cancel' },
            { text: 'Supprimer', style: 'destructive', onPress: () => { deleteSong(song.id); refresh(); } },
          ])}>
          <View style={{ flex: 1 }}>
            <Text style={styles.songTitle} numberOfLines={1}>{song.title}</Text>
            <Text style={styles.muted}>
              {fmt(song.duration)} — {song.key?.fr} — {INSTRUMENTS.find((i) => i.id === song.instrument)?.label}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
      ))}
      {songs.length > 0 && <Text style={styles.hint}>Appui long sur un morceau pour le supprimer.</Text>}
      <Text style={[styles.hint, { marginTop: 16 }]}>{versionLabel()}</Text>
    </ScrollView>
  );
}

function NewSong({ onCancel, onDone }) {
  const [file, setFile] = useState(null);
  const [instrument, setInstrument] = useState('guitar');
  const [short, setShort] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!busy) return undefined;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - t0) / 1000), 500);
    return () => clearInterval(id);
  }, [busy]);

  async function pick() {
    const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
    if (!res.canceled) setFile(res.assets[0]);
  }

  async function start() {
    setBusy(true); setError(''); setProgress(null);
    await activateKeepAwakeAsync();
    try {
      const song = await analyzeSong(file, { instrument, short, onStatus: setStatus, onDetail: setProgress });
      onDone(song);
    } catch (e) {
      setError(String(e?.message || e));
      setStatus('');
    } finally {
      deactivateKeepAwake();
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      {!busy && <TouchableOpacity onPress={onCancel}><Text style={styles.back}>‹ Bibliothèque</Text></TouchableOpacity>}
      <Text style={styles.h1}>Nouveau morceau</Text>

      <View style={styles.card}>
        <Text style={styles.label}>1. Le morceau</Text>
        <TouchableOpacity style={styles.secondary} onPress={pick} disabled={busy}>
          <Text style={styles.secondaryText} numberOfLines={1}>{file ? `🎵 ${file.name}` : 'Choisir un fichier audio'}</Text>
        </TouchableOpacity>

        <Text style={styles.label}>2. Ce que je joue</Text>
        <View style={styles.wrap}>
          {INSTRUMENTS.map((i) => (
            <TouchableOpacity key={i.id} onPress={() => setInstrument(i.id)} disabled={busy}
              style={[styles.pill, instrument === i.id && styles.pillOn]}>
              <Text style={[styles.pillText, instrument === i.id && styles.pillTextOn]}>{i.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.muted}>Cette partie sera retirée du morceau : tu la joues à la place. Tu pourras changer ensuite.</Text>

        <View style={styles.row}>
          <Text style={[styles.muted, { flex: 1 }]}>Test rapide : seulement les 30 premières secondes</Text>
          <Switch value={short} onValueChange={setShort} disabled={busy} />
        </View>

        <TouchableOpacity style={[styles.primary, (!file || busy) && styles.disabled]} onPress={start} disabled={!file || busy}>
          <Text style={styles.primaryText}>Analyser</Text>
        </TouchableOpacity>
      </View>

      {(busy || error) ? (
        <View style={styles.card}>
          {busy && <Text style={styles.label}>{status}</Text>}
          {progress && busy && (
            <>
              <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(progress.progress * 100)}%` }]} /></View>
              <Text style={styles.muted}>{Math.round(progress.progress * 100)} % — reste environ {fmt(progress.remaining)}</Text>
            </>
          )}
          {busy && <Text style={styles.muted}>Temps écoulé : {fmt(elapsed)}. Garde l'app ouverte, l'écran reste allumé.</Text>}
          {error ? <Text style={styles.err}>Échec : {error}</Text> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingTop: 60, gap: 12 },
  logo: { width: '72%', height: 220, alignSelf: 'center' },
  h1: { color: C.text, fontSize: 24, fontWeight: '700' },
  h2: { color: C.text, fontSize: 18, fontWeight: '700', marginTop: 8 },
  label: { color: C.text, fontSize: 15, fontWeight: '600' },
  muted: { color: C.muted, fontSize: 14, lineHeight: 20 },
  hint: { color: C.muted, fontSize: 12, textAlign: 'center' },
  err: { color: C.err, fontSize: 15 },
  back: { color: C.accent, fontSize: 16 },
  card: { backgroundColor: C.card, borderRadius: 14, padding: 14, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  primary: { backgroundColor: C.accent, borderRadius: 12, padding: 15, alignItems: 'center' },
  primaryText: { color: '#111', fontWeight: '700', fontSize: 16 },
  secondary: { backgroundColor: C.chip, borderRadius: 10, padding: 14, alignItems: 'center' },
  secondaryText: { color: C.text, fontSize: 15 },
  disabled: { opacity: 0.4 },
  pill: { backgroundColor: C.chip, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  pillOn: { backgroundColor: C.accent },
  pillText: { color: C.text, fontSize: 14 },
  pillTextOn: { color: '#111', fontWeight: '600' },
  songRow: { backgroundColor: C.card, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
  songTitle: { color: C.text, fontSize: 16, fontWeight: '600' },
  chevron: { color: C.muted, fontSize: 24 },
  track: { height: 8, backgroundColor: C.chip, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: C.accent },
});
