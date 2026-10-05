// Séparation de pistes htdemucs dans le navigateur (WebGPU), pensée pour
// tenir dans la mémoire limitée d'un onglet Safari iPhone :
// - modèle en 21 morceaux fp16 (126 Mo) au lieu d'un bloc fp32 (172 Mo) ;
// - morceau traité par tranches de ~7,8 s, seul l'accumulateur de la
//   tranche en cours est en float32 ;
// - pistes résultat stockées en Int16 (moitié moins que du float32).
// Pré/post-traitement (STFT, masque, iSTFT) repris de demucs-web (MIT).

import { stft, istft, reflectPad } from './fft.js';

export const SAMPLE_RATE = 44100;
export const TRACKS = ['drums', 'bass', 'other', 'vocals'];

const FFT_SIZE = 4096;
const HOP = 1024;
const SEG = 343980;
const BINS = 2048;
const FRAMES = 336;
const STRIDE = Math.floor(SEG * 0.75);

const MODEL_BASE = 'https://huggingface.co/monteslu/htdemucs-web-onnx/resolve/main/';
// Prologue de normalisation fragile en fp16 : à garder sur CPU sinon NaN
// sur WebGPU (cf. README du modèle).
const CPU_NODES = ['/ReduceMean', '/Sub', '/Pow', '/ReduceMean_1', '/Clip', '/Sqrt', '/Add', '/Div',
  '/ReduceMean_2', '/Sub_1', '/Pow_1', '/ReduceMean_3', '/Clip_1', '/Sqrt_1', '/Add_1', '/Div_1'];

// Pas de Cache API : elle gardait une seconde copie de chaque morceau en
// mémoire pendant le chargement. Le cache HTTP du navigateur suffit.
async function fetchBytes(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Téléchargement impossible (${resp.status}) : ${url}`);
  return new Uint8Array(await resp.arrayBuffer());
}

export class Separator {
  // provider : 'webgpu' dans le navigateur ; 'cpu' pour les tests sous Node.
  constructor(ort, provider = 'webgpu') {
    this.ort = ort;
    this.provider = provider;
    this.sessions = [];
    this.pieces = [];
    // Appelé avant chaque étape du calcul d'une tranche (diagnostic).
    this.onStep = null;
  }

  // onPiece(i, total) est appelé avant chaque morceau : sert à savoir où
  // le chargement s'est arrêté si Safari ferme la page.
  async load(onStatus, onPiece = () => {}) {
    const manifest = JSON.parse(new TextDecoder().decode(
      await fetchBytes(MODEL_BASE + 'htdemucs_split_manifest.json')));
    this.pieces = manifest.pieces;
    this.freqName = manifest.outputs.freq;
    this.timeName = manifest.outputs.time;

    // Dernier morceau qui consomme chaque tenseur, pour libérer la mémoire
    // GPU dès qu'il ne sert plus.
    this.lastUse = new Map();
    this.pieces.forEach((p, i) => p.inputs.forEach((n) => this.lastUse.set(n, i)));

    let loadedBytes = 0;
    for (let i = 0; i < this.pieces.length; i++) {
      onPiece(i + 1, this.pieces.length);
      const bytes = await fetchBytes(MODEL_BASE + this.pieces[i].file);
      loadedBytes += bytes.length;
      onStatus(`Modèle : morceau ${i + 1}/${this.pieces.length} (${(loadedBytes / 1e6).toFixed(0)} Mo)`);
      const gpu = this.provider === 'webgpu';
      const ep = gpu && i === 0 ? { name: 'webgpu', forceCpuNodeNames: CPU_NODES } : this.provider;
      this.sessions.push(await this.ort.InferenceSession.create(bytes, {
        executionProviders: [ep],
        graphOptimizationLevel: 'all',
        enableCpuMemArena: false,
        enableMemPattern: false,
        ...(gpu ? { preferredOutputLocation: 'gpu-buffer' } : {}),
      }));
    }
  }

  async _runSegment(left, right) {
    const { waveform, magSpec } = prepareInput(left, right);
    const ort = this.ort;
    const map = new Map([
      ['mix', new ort.Tensor('float32', waveform, [1, 2, SEG])],
      ['mag', new ort.Tensor('float32', magSpec, [1, 4, BINS, FRAMES])],
    ]);
    const keep = new Set([this.freqName, this.timeName]);

    for (let i = 0; i < this.pieces.length; i++) {
      const piece = this.pieces[i];
      const feeds = {};
      for (const name of piece.inputs) feeds[name] = map.get(name);
      this.onStep?.(i + 1, this.pieces.length);
      const out = await this.sessions[i].run(feeds);
      for (const [name, tensor] of Object.entries(out)) {
        if (!keep.has(name) && !this.lastUse.has(name)) tensor.dispose();
        else map.set(name, tensor);
      }
      for (const name of piece.inputs) {
        if (this.lastUse.get(name) === i && !keep.has(name)) {
          map.get(name).dispose();
          map.delete(name);
        }
      }
    }
    const freq = await map.get(this.freqName).getData(true);
    const time = await map.get(this.timeName).getData(true);
    return { freq, time };
  }

  /**
   * Sépare un morceau stéréo 44,1 kHz fourni en Int16 (left/right, comme
   * toInt16) pour économiser la mémoire. Renvoie, pour chaque piste de
   * TRACKS, { left: Int16Array, right: Int16Array }.
   */
  async separate(left, right, onProgress) {
    const total = left.length;
    const numSegments = total <= SEG ? 1 : Math.ceil((total - SEG) / STRIDE) + 1;
    const out = TRACKS.map(() => ({ left: new Int16Array(total), right: new Int16Array(total) }));

    // Accumulateur aligné sur le début de la tranche en cours :
    // 4 pistes x 2 canaux, + somme des poids de fondu.
    const acc = Array.from({ length: 8 }, () => new Float32Array(SEG));
    const wacc = new Float32Array(SEG);
    const fade = STRIDE * 0.5;

    for (let s = 0; s < numSegments; s++) {
      const t0 = performance.now();
      const start = s * STRIDE;
      const segLen = Math.min(SEG, total - start);
      const isFirst = s === 0;
      const isLast = s === numSegments - 1;

      const segL = new Float32Array(SEG);
      const segR = new Float32Array(SEG);
      for (let i = 0; i < segLen; i++) {
        segL[i] = left[start + i] / 32768;
        segR[i] = right[start + i] / 32768;
      }

      const { freq, time } = await this._runSegment(segL, segR);

      for (let t = 0; t < 4; t++) {
        const spec = freqToTimeDomain(freq, t);
        for (let c = 0; c < 2; c++) {
          const timeOffset = (t * 2 + c) * SEG;
          const freqPart = c === 0 ? spec.left : spec.right;
          const row = acc[t * 2 + c];
          for (let i = 0; i < segLen; i++) {
            const w = Math.min(isFirst ? 1 : i / fade, isLast ? 1 : (segLen - i) / fade, 1);
            row[i] += (time[timeOffset + i] + freqPart[i]) * w;
            if (t === 0 && c === 0) wacc[i] += w;
          }
        }
      }

      // La zone [start, start + STRIDE) ne recevra plus rien : on la fige
      // en Int16 puis on décale l'accumulateur pour la tranche suivante.
      const finalLen = isLast ? segLen : STRIDE;
      for (let t = 0; t < 4; t++) {
        for (let c = 0; c < 2; c++) {
          const row = acc[t * 2 + c];
          const dst = c === 0 ? out[t].left : out[t].right;
          for (let i = 0; i < finalLen; i++) {
            const v = wacc[i] > 1e-8 ? row[i] / wacc[i] : 0;
            dst[start + i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
          }
          row.copyWithin(0, STRIDE);
          row.fill(0, SEG - STRIDE);
        }
      }
      wacc.copyWithin(0, STRIDE);
      wacc.fill(0, SEG - STRIDE);

      onProgress({ done: s + 1, total: numSegments, segmentMs: performance.now() - t0 });
    }
    return Object.fromEntries(TRACKS.map((name, t) => [name, out[t]]));
  }
}

export function toInt16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
  }
  return out;
}

function prepareInput(left, right) {
  const le = Math.ceil(SEG / HOP);
  const pad = Math.floor(HOP / 2) * 3;
  const padRight = pad + le * HOP - SEG;
  const centerPad = FFT_SIZE / 2;

  const specL = stft(reflectPad(reflectPad(left, pad, padRight), centerPad, centerPad), FFT_SIZE, HOP);
  const specR = stft(reflectPad(reflectPad(right, pad, padRight), centerPad, centerPad), FFT_SIZE, HOP);

  const plane = BINS * FRAMES;
  const magSpec = new Float32Array(4 * plane);
  for (let f = 0; f < FRAMES; f++) {
    const src = (f + 2) * specL.numBins;
    for (let b = 0; b < BINS; b++) {
      const dst = b * FRAMES + f;
      magSpec[dst] = specL.real[src + b];
      magSpec[plane + dst] = specL.imag[src + b];
      magSpec[2 * plane + dst] = specR.real[src + b];
      magSpec[3 * plane + dst] = specR.imag[src + b];
    }
  }

  const waveform = new Float32Array(2 * SEG);
  waveform.set(left, 0);
  waveform.set(right, SEG);
  return { waveform, magSpec };
}

// Branche fréquentielle d'une piste -> signal temporel (iSTFT), même
// convention de padding/décalage que demucs.
function freqToTimeDomain(freq, track) {
  const plane = BINS * FRAMES;
  const base = track * 4 * plane;
  const paddedBins = BINS + 1;
  const paddedFrames = FRAMES + 4;
  const istftLength = (paddedFrames - 1) * HOP + FFT_SIZE;
  const offset = FFT_SIZE / 2 + Math.floor(HOP / 2) * 3;

  const channel = (realPlane, imagPlane) => {
    const real = new Float32Array(paddedFrames * paddedBins);
    const imag = new Float32Array(paddedFrames * paddedBins);
    for (let f = 0; f < FRAMES; f++) {
      const dstRow = (f + 2) * paddedBins;
      for (let b = 0; b < BINS; b++) {
        real[dstRow + b] = freq[base + realPlane * plane + b * FRAMES + f];
        imag[dstRow + b] = freq[base + imagPlane * plane + b * FRAMES + f];
      }
    }
    return istft(real, imag, paddedFrames, paddedBins, FFT_SIZE, HOP, istftLength)
      .subarray(offset, offset + SEG);
  };

  return { left: channel(0, 1), right: channel(2, 3) };
}
