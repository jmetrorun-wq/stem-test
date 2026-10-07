// Diagrammes de l'accord en cours, dessinés avec des vues (pas de module
// natif de dessin, donc pas de build) et repris du style de ChordSplit :
// - guitare (static/guitar.js) : bout de manche vu par un droitier, sillet
//   à droite, Mi grave en haut, ✕ / ○ à droite du sillet ;
// - piano (static/piano.js) : une octave Do-Do, pastilles sur les notes de
//   l'accord, plus grosse sur la fondamentale.
// Pour un renversement (Ab/C), la basse est indiquée sous le diagramme.

import { memo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { guitarShape, parseChord } from '../diagrams.js';
import { C } from './theme.js';

const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function bassLabel(name) {
  const chord = parseChord(name);
  if (!chord || chord.bass === chord.root) return null;
  return `Basse : ${name.split('/')[1] ?? NOTE_NAMES[chord.bass]}`;
}

// ── Guitare ─────────────────────────────────────────────────────────

const NF = 5, NS = 6;

function Guitar({ name, width }) {
  const shape = guitarShape(name);
  const H = width * 0.5;
  if (!shape) return <View style={[styles.empty, { height: H }]}><Text style={styles.muted}>—</Text></View>;
  const padL = 16, padR = 30, padT = 14, padB = 14;
  const w = width - padL - padR, h = H - padT - padB;
  const sh = h / (NS - 1), fw = w / NF;
  const nutX = padL + w;
  const winStart = Math.max(1, shape.start);
  const fretX = (f) => nutX - f * fw;
  const stringY = (s) => padT + s * sh;
  const isNut = shape.start <= 1;
  const items = [];
  for (let f = 0; f <= NF; f++) {
    const thick = f === 0 && isNut;
    items.push(<View key={`f${f}`} style={{ position: 'absolute', left: fretX(f) - (thick ? 2 : 0.75), top: padT - 2,
      width: thick ? 4 : 1.5, height: h + 4, backgroundColor: thick ? '#D8D8E8' : '#4A4A6A' }} />);
  }
  for (let s = 0; s < NS; s++) {
    const t = 0.7 + (NS - 1 - s) * 0.35;
    items.push(<View key={`s${s}`} style={{ position: 'absolute', left: padL, top: stringY(s) - t / 2, width: w, height: t, backgroundColor: '#8A8AB0' }} />);
  }
  if (shape.barre > 0) {
    const bx = fretX(shape.barre - winStart + 0.5);
    items.push(<View key="barre" style={{ position: 'absolute', left: bx - 7, top: padT - 4, width: 14, height: h + 8,
      borderRadius: 7, backgroundColor: '#1A56DB', opacity: 0.85 }} />);
  }
  shape.frets.forEach((fret, s) => {
    const y = stringY(s);
    if (fret === -1) {
      items.push(<Text key={`m${s}`} style={[styles.mute, { left: nutX + 9, top: y - 8 }]}>✕</Text>);
    } else if (fret === 0) {
      items.push(<View key={`o${s}`} style={{ position: 'absolute', left: nutX + 10, top: y - 5, width: 10, height: 10,
        borderRadius: 5, borderWidth: 1.5, borderColor: '#AAAACC' }} />);
    } else {
      const cx = fretX(fret - winStart + 0.5);
      const onBarre = shape.barre > 0 && fret === shape.barre;
      items.push(<View key={`d${s}`} style={{ position: 'absolute', left: cx - 8, top: y - 8, width: 16, height: 16,
        borderRadius: 8, backgroundColor: onBarre ? '#4FC3F7' : '#EDEDF2' }} />);
    }
  });
  return (
    <View style={{ width, height: H }}>
      <View style={[styles.board, { left: padL, top: padT - 3, width: w, height: h + 6 }]} />
      {items}
      {!isNut && <Text style={[styles.fretNumber, { left: nutX - fw, width: fw, top: padT - 15 }]}>{shape.start}</Text>}
    </View>
  );
}

// ── Piano ───────────────────────────────────────────────────────────

const WHITE = [0, 2, 4, 5, 7, 9, 11];
// Touches noires : classe de hauteur et touche blanche qui la précède.
const BLACK = [[1, 0], [3, 1], [6, 3], [8, 4], [10, 5]];

function Piano({ name, width }) {
  const chord = parseChord(name);
  const tones = new Set(chord?.tones ?? []);
  const H = width * 0.42;
  const ww = width / 8; // Do à Do : 8 touches blanches
  const bw = ww * 0.6, bh = H * 0.6;
  const dot = (pc, onBlack) => {
    if (!tones.has(pc)) return null;
    const size = pc === chord.root ? 16 : 11;
    return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: onBlack ? '#EDEDF2' : '#1A1A2E' }} />;
  };
  return (
    <View style={{ width, height: H }}>
      {[...WHITE, 0].map((pc, i) => (
        <View key={`w${i}`} style={[styles.white, { left: i * ww, width: ww - 2, height: H }]}>{dot(pc, false)}</View>
      ))}
      {BLACK.map(([pc, after]) => (
        <View key={`b${pc}`} style={[styles.black, { left: (after + 1) * ww - bw / 2 - 1, width: bw, height: bh }]}>{dot(pc, true)}</View>
      ))}
    </View>
  );
}

function ChordDiagram({ name, instrument }) {
  const [width, setWidth] = useState(0);
  const bass = name ? bassLabel(name) : null;
  return (
    <View style={styles.wrap} onLayout={(e) => setWidth(Math.min(360, e.nativeEvent.layout.width))}>
      {width > 0 && (instrument === 'guitar' ? <Guitar name={name} width={width} /> : <Piano name={name} width={width} />)}
      <Text style={styles.bass}>{bass ?? ' '}</Text>
    </View>
  );
}

export default memo(ChordDiagram);

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 4 },
  empty: { alignItems: 'center', justifyContent: 'center' },
  muted: { color: C.muted, fontSize: 18 },
  board: { position: 'absolute', backgroundColor: '#2A2540', borderRadius: 2 },
  mute: { position: 'absolute', color: '#FF5555', fontSize: 12, width: 14, textAlign: 'center' },
  fretNumber: { position: 'absolute', color: '#AAAACC', fontSize: 10, textAlign: 'center' },
  white: { position: 'absolute', top: 0, backgroundColor: '#ECECF2', borderRadius: 4, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 10 },
  black: { position: 'absolute', top: 0, backgroundColor: '#1d1f27', borderRadius: 3, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 8, zIndex: 2 },
  bass: { color: C.muted, fontSize: 14 },
});
