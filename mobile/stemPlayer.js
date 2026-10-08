// Lecture des 4 pistes par petits morceaux (files d'attente de
// react-native-audio-api) plutôt qu'une source par piste entière.
//
// Pourquoi : la bibliothèque copie entièrement la piste à chaque
// « source.buffer = … » (~100 Mo par piste pour 4-5 min). Chaque saut
// (glissement de la barre, ±10 s) recopiait ~400 Mo : en enchaînant les
// glissements, l'app plantait faute de mémoire (« out of memory » de
// Hermes), même en libérant les anciennes copies. Ici, un saut ne prépare
// que quelques secondes de son.
//
// Les 4 files démarrent au même instant de l'horloge audio et reçoivent
// des morceaux de mêmes bornes : elles restent synchronisées. Les
// morceaux sont préparés ~3 s à l'avance et complétés 4 fois par seconde.

import { TRACKS } from '../separator.js';

const CHUNK_SECONDS = 1;
const AHEAD_SECONDS = 3;
const REFILL_MS = 250;

export class StemPlayer {
  /** buffers / gains : { piste: AudioBuffer / GainNode }. */
  constructor(ctx, buffers, gains) {
    this.ctx = ctx;
    this.buffers = buffers;
    this.gains = gains;
    this.sampleRate = buffers[TRACKS[0]].sampleRate;
    this.length = Math.min(...TRACKS.map((t) => buffers[t].length));
    this.nodes = [];
    this.timer = null;
    // Tampon intermédiaire réutilisé (copyToChannel / copyFromChannel de
    // la bibliothèque ignorent le décalage d'un subarray : il faut un
    // tableau à part, de la taille exacte du morceau).
    this.scratch = new Float32Array(Math.round(CHUNK_SECONDS * this.sampleRate));
  }

  /** Lit à partir de `from` (s) ; renvoie l'instant d'horloge du début du morceau. */
  start(from) {
    this.stop();
    const when = this.ctx.currentTime + 0.1;
    this.when = when;
    this.from = from;
    this.nextFrame = Math.max(0, Math.min(this.length, Math.floor(from * this.sampleRate)));
    this.nodes = TRACKS.map((track) => {
      const node = this.ctx.createBufferQueueSource();
      node.connect(this.gains[track]);
      return { track, node };
    });
    this.fill();
    for (const { node } of this.nodes) node.start(when);
    this.timer = setInterval(() => this.fill(), REFILL_MS);
    return when - from;
  }

  fill() {
    const sr = this.sampleRate;
    const playhead = this.from + Math.max(0, this.ctx.currentTime - this.when);
    const target = Math.min(this.length, Math.floor((playhead + AHEAD_SECONDS) * sr));
    while (this.nextFrame < target) {
      const end = Math.min(this.length, this.nextFrame + this.scratch.length);
      const size = end - this.nextFrame;
      const tmp = size === this.scratch.length ? this.scratch : new Float32Array(size);
      for (const { track, node } of this.nodes) {
        const source = this.buffers[track];
        const chunk = this.ctx.createBuffer(2, size, sr);
        for (let c = 0; c < 2; c++) {
          source.copyFromChannel(tmp, Math.min(c, source.numberOfChannels - 1), this.nextFrame);
          chunk.copyToChannel(tmp, c);
        }
        node.enqueueBuffer(chunk);
      }
      this.nextFrame = end;
    }
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    for (const { node } of this.nodes) {
      try { node.stop(); } catch {}
      try { node.clearBuffers(); } catch {}
      try { node.disconnect(); } catch {}
    }
    this.nodes = [];
  }
}
