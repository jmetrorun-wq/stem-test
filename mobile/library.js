// Bibliothèque des morceaux analysés, sur le téléphone :
//   Documents/songs/<id>/song.json   titre, durée, tonalité, accords, instrument
//   Documents/songs/<id>/<piste>.m4a  drums, bass, other, vocals (AAC)
// Rouvrir un morceau ne refait ni la séparation (~1x la durée du morceau
// sur iPhone 13) ni la détection d'accords.

import { Directory, File, Paths } from 'expo-file-system';

import { TRACKS } from '../separator.js';
import { saveStem } from './nativeDsp.js';

const songsDir = new Directory(Paths.document, 'songs');

function ensureSongsDir() {
  if (!songsDir.exists) songsDir.create({ intermediates: true, idempotent: true });
}

export function newSongId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function stemUri(id, track) {
  return new File(songsDir, id, `${track}.m4a`).uri;
}

/**
 * Enregistre les pistes (Int16, cf. Separator.separate) puis les infos du
 * morceau. song.json est écrit en dernier : un morceau sans song.json
 * (enregistrement interrompu) est ignoré par listSongs.
 */
export function saveSong(meta, stems, onTrack = () => {}) {
  ensureSongsDir();
  const dir = new Directory(songsDir, meta.id);
  dir.create({ intermediates: true, idempotent: true });
  for (const track of TRACKS) {
    onTrack(track);
    saveStem(stemUri(meta.id, track), stems[track].left, stems[track].right);
  }
  new File(dir, 'song.json').write(JSON.stringify(meta));
}

/** Morceaux enregistrés, du plus récent au plus ancien. */
export function listSongs() {
  if (!songsDir.exists) return [];
  const songs = [];
  for (const entry of songsDir.list()) {
    if (!(entry instanceof Directory)) continue;
    const file = new File(entry, 'song.json');
    if (!file.exists) continue;
    try {
      songs.push(JSON.parse(file.textSync()));
    } catch {
      // song.json illisible : morceau ignoré
    }
  }
  return songs.sort((a, b) => b.createdAt - a.createdAt);
}

export function updateSong(meta) {
  new File(songsDir, meta.id, 'song.json').write(JSON.stringify(meta));
}

export function deleteSong(id) {
  const dir = new Directory(songsDir, id);
  if (dir.exists) dir.delete();
}

/** Place occupée par un morceau (Mo). */
export function songSizeMb(id) {
  const dir = new Directory(songsDir, id);
  if (!dir.exists) return 0;
  let bytes = 0;
  for (const entry of dir.list()) if (entry instanceof File) bytes += entry.size ?? 0;
  return bytes / 1e6;
}
