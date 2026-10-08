// Grille d'accords en HTML (A4), transformée en PDF par l'app
// (expo-print). Même principe que l'export PDF de ChordSplit
// (pdf_export.py) : 4 mesures par ligne, titre, tonalité et tempo ; en
// plus, plusieurs accords par mesure quand l'accord change en cours de
// mesure, et numéro de la première mesure de chaque ligne.

const BARS_PER_ROW = 4;

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// « Bbm7b5/E » -> « B♭m7♭5/E » pour l'impression.
const pretty = (name) => name.replace(/([A-G])b/g, '$1♭').replace(/([A-G])#/g, '$1♯').replace(/b5/g, '♭5');

/**
 * song : { title, key: { fr }, duration } ; grid : { tempo, beatsPerBar } ;
 * bars : barsFromCells(…). -> document HTML complet.
 */
export function chordChartHtml(song, grid, bars) {
  const rows = [];
  for (let i = 0; i < bars.length; i += BARS_PER_ROW) rows.push(bars.slice(i, i + BARS_PER_ROW));
  const cell = (bar) => {
    if (!bar) return '<td class="empty"></td>';
    const size = bar.chords.length >= 3 ? 'small' : bar.chords.length === 2 ? 'medium' : '';
    return `<td class="${size}">${bar.chords.map((c) => `<span>${escapeHtml(pretty(c))}</span>`).join('')}</td>`;
  };
  const table = rows.map((row) => {
    const first = row[0].number;
    const cells = [0, 1, 2, 3].map((k) => cell(row[k])).join('');
    return `<tr><th>${first > 0 ? first : ''}</th>${cells}</tr>`;
  }).join('\n');
  const minutes = Math.floor(song.duration / 60), seconds = String(Math.floor(song.duration % 60)).padStart(2, '0');
  const info = [
    song.key?.fr && `Tonalité : ${escapeHtml(song.key.fr)}`,
    grid && `♩ = ${grid.tempo}`,
    grid && `${grid.beatsPerBar} temps par mesure`,
    `${minutes}:${seconds}`,
  ].filter(Boolean).join(' — ');
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 1.5cm; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 22pt; margin: 0 0 4pt; }
  .info { color: #444; font-size: 11pt; margin-bottom: 14pt; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  th { width: 1.1cm; font-size: 8pt; font-weight: normal; color: #888; text-align: right; padding-right: 5pt; vertical-align: middle; }
  td { border: 0.75pt solid #999; height: 1.35cm; text-align: center; vertical-align: middle;
       font-weight: 700; font-size: 15pt; padding: 0 3pt; }
  td span { display: inline-block; margin: 0 4pt; white-space: nowrap; }
  td.medium { font-size: 12pt; }
  td.small { font-size: 10pt; }
  td.empty { border: none; }
  tr { page-break-inside: avoid; }
  .footer { margin-top: 12pt; color: #999; font-size: 8pt; text-align: right; }
</style></head>
<body>
  <h1>${escapeHtml(song.title)}</h1>
  <div class="info">${info}</div>
  <table>${table}</table>
  <div class="footer">Grille générée par ChordSplit</div>
</body></html>`;
}

/** Nom de fichier sans caractères interdits. */
export const safeFileName = (s) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Morceau';
