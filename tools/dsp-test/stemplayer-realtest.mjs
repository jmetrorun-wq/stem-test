// StemPlayer + vrai code JS de react-native-audio-api ; seule la partie
// native (objets JSI) est imitée, avec les mêmes contrôles d'arguments.
const LIB = '/Users/utilisateur/.local/bin/stem-test/mobile/node_modules/react-native-audio-api/lib/module';
let now = 0;
const log = [];
const SR = 44100;
const nativeBuffer = (channels, length, sampleRate, fill) => {
  const ch = Array.from({ length: channels }, (_, c) => (fill ? Float32Array.from({ length }, (_, i) => fill(c, i)) : new Float32Array(length)));
  return { length, sampleRate, numberOfChannels: channels, duration: length / sampleRate, ch,
    getChannelData: (c) => ch[c],
    copyFromChannel(dest, c, start) { if (typeof start !== 'number') throw new Error('start non numérique'); dest.set(ch[c].subarray(start, start + dest.length)); },
    copyToChannel(src, c, start = 0) { ch[c].set(src, start); } };
};
// Réglage natif : toute méthode inconnue répond « succès ».
const paramStub = () => new Proxy({ value: 0, defaultValue: 0, minValue: -1e9, maxValue: 1e9 },
  { get: (o, k) => (k in o ? o[k] : () => ({ status: 'success' })) });
const nodeStub = (kind) => ({ kind, numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'max', channelInterpretation: 'speakers',
  gain: paramStub(), detune: paramStub(), playbackRate: paramStub(), queue: [],
  connect() {}, disconnect() {},
  start(when, offset) { if (typeof when !== 'number' || typeof offset !== 'number') throw new Error(`start natif : arguments non numériques (${when}, ${offset})`); log.push(`${kind}.start(${when.toFixed(2)}, ${offset})`); },
  stop() {}, clearBuffers() { this.queue = []; },
  enqueueBuffer(b) { if (!b || !b.ch) throw new Error('enqueue : pas un buffer natif'); this.queue.push(b); return String(this.queue.length); } });
const native = { sampleRate: SR, destination: nodeStub('destination'), get currentTime() { return now; },
  createGain: () => nodeStub('gain'), createBufferQueueSource: () => nodeStub('queue'),
  createBuffer: (c, l, s) => nativeBuffer(c, l, s) };
globalThis.AudioEventEmitter = { addAudioEventListener: () => ({ subscriptionId: '1' }), removeAudioEventListener() {} };
globalThis.createAudioBuffer = (opts) => nativeBuffer(opts.numberOfChannels, opts.length, opts.sampleRate);
const { default: AudioBuffer } = await import(`${LIB}/core/AudioBuffer.js`);
const { default: GainNode } = await import(`${LIB}/core/GainNode.js`);
const { default: AudioBufferQueueSourceNode } = await import(`${LIB}/core/AudioBufferQueueSourceNode.js`);
// Contexte minimal reproduisant BaseAudioContext pour ces trois classes réelles.
class BaseAudioContext {
  constructor(context) { this.context = context; this.sampleRate = context.sampleRate; }
  get currentTime() { return this.context.currentTime; }
  createGain() { return new GainNode(this); }
  createBufferQueueSource(options) { return options !== undefined ? new AudioBufferQueueSourceNode(this, options) : new AudioBufferQueueSourceNode(this); }
  createBuffer(c, l, s) { return new AudioBuffer(this.context.createBuffer(c, l, s)); }
}
const { StemPlayer } = await import('/Users/utilisateur/.local/bin/stem-test/mobile/stemPlayer.js');
const ctx = new BaseAudioContext(native);
const TRACKS = ['drums', 'bass', 'other', 'vocals'];
const LEN = SR * 30;
const buffers = Object.fromEntries(TRACKS.map((t, k) => [t, new AudioBuffer(nativeBuffer(2, LEN, SR, (c, i) => Math.sin(i * 0.0003 * (k + 1) + c)))]));
const gains = Object.fromEntries(TRACKS.map((t) => [t, ctx.createGain()]));
const player = new StemPlayer(ctx, buffers, gains);
player.onError = (e) => { console.log('ERREUR remplissage :', e.message); };
const startedAt = player.start(12.5);
console.log(log.join(' | '));
for (let k = 0; k < 120; k++) { now += 0.25; player.fill(); }
const counts = player.nodes.map(({ node }) => node.node.queue.length);
console.log('morceaux par piste :', counts.join(', '), '| startedAt', startedAt.toFixed(2));
player.start(3); player.stop();
console.log('saut puis arrêt : ok');
