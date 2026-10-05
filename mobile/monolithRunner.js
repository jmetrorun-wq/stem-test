// Exécute le modèle htdemucs fp32 d'un seul bloc (timcsy/demucs-web-onnx,
// 172 Mo) sur une tranche. En natif, l'app a assez de mémoire pour le
// modèle entier, et le processeur calcule plus vite en fp32 qu'en fp16.
// Indépendant de la plateforme : reçoit le module onnxruntime à utiliser
// (onnxruntime-react-native dans l'app, onnxruntime-web pour les tests Node).

import { MODEL_SHAPES } from '../separator.js';

export const MONOLITH_URL =
  'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx';

export class MonolithRunner {
  constructor(ort) {
    this.ort = ort;
    this.session = null;
  }

  async load(modelPath, sessionOptions) {
    this.session = await this.ort.InferenceSession.create(modelPath, sessionOptions);
  }

  async run(waveform, magSpec, onStep) {
    const { Tensor } = this.ort;
    onStep?.('calcul du modèle');
    const out = await this.session.run({
      input: new Tensor('float32', waveform, MODEL_SHAPES.waveform),
      x: new Tensor('float32', magSpec, MODEL_SHAPES.magSpec),
    });
    return { freq: out.output.data, time: out.add_67.data };
  }
}
