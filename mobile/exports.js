// Partage depuis l'écran de jeu : grille d'accords en PDF (expo-print) et
// morceau tel qu'on l'entend, par exemple sans la voix (assemblage natif
// des pistes, StemAudio.mixAAC), via la feuille de partage d'iOS.

import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { TRACKS } from '../separator.js';
import { barsFromCells } from '../beats.js';
import { chordChartHtml, safeFileName } from '../chordChart.js';
import { stemUri } from './library.js';
import { mixStems } from './nativeDsp.js';

const REMOVED_NAMES = { vocals: 'voix', drums: 'batterie', bass: 'basse', other: 'guitare-piano' };

// Copie dans le cache sous un nom lisible (c'est ce nom que voit le
// destinataire), en remplaçant un ancien export du même nom.
function named(uri, name) {
  const target = new File(Paths.cache, name);
  if (target.exists) target.delete();
  new File(uri).move(target);
  return target.uri;
}

/** Grille d'accords en PDF (A4). */
export async function shareChordChart(song, grid, cells) {
  const html = chordChartHtml(song, grid, barsFromCells(cells));
  const { uri } = await Print.printToFileAsync({ html, width: 595, height: 842 });
  const file = named(uri, `${safeFileName(song.title)} - grille d'accords.pdf`);
  await Sharing.shareAsync(file, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Grille d\'accords' });
}

/** Le morceau avec seulement les pistes actives (enabled : { piste: bool }). */
export async function shareMix(song, enabled) {
  const active = TRACKS.filter((t) => enabled[t]);
  if (!active.length) throw new Error('Toutes les pistes sont coupées.');
  const removed = TRACKS.filter((t) => !enabled[t]).map((t) => REMOVED_NAMES[t]);
  const suffix = removed.length ? ` (sans ${removed.join(' et ')})` : '';
  const target = new File(Paths.cache, `${safeFileName(song.title)}${suffix}.m4a`);
  if (target.exists) target.delete();
  await mixStems(active.map((t) => stemUri(song.id, t)), active.map(() => 1), target.uri);
  await Sharing.shareAsync(target.uri, { mimeType: 'audio/mp4', UTI: 'public.mpeg-4-audio', dialogTitle: 'Partager le morceau' });
}
