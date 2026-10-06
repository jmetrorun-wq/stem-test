// Exécute le modèle htdemucs fp32 d'un seul bloc sur une tranche (export
// d'origine : timcsy/demucs-web-onnx ; l'app utilise la version réexportée
// par tools/export_htdemucs.py, mêmes entrées/sorties). En natif, l'app a assez de mémoire pour le
// modèle entier, et le processeur calcule plus vite en fp32 qu'en fp16.
// Indépendant de la plateforme : reçoit le module onnxruntime à utiliser
// (onnxruntime-react-native dans l'app, onnxruntime-web pour les tests Node).

import { MODEL_SHAPES } from '../separator.js';

export class MonolithRunner {
  constructor(ort) {
    this.ort = ort;
    this.session = null;
    // Durée du dernier calcul du modèle, pour distinguer le temps du
    // modèle de celui du pré/post-traitement en JS.
    this.lastRunMs = 0;
  }

  async load(modelPath, sessionOptions) {
    this.session = await this.ort.InferenceSession.create(modelPath, sessionOptions);
  }

  async run(waveform, magSpec, onStep) {
    const { Tensor } = this.ort;
    onStep?.('calcul du modèle');
    const t0 = Date.now();
    const out = await this.session.run({
      input: new Tensor('float32', waveform, MODEL_SHAPES.waveform),
      x: new Tensor('float32', magSpec, MODEL_SHAPES.magSpec),
    });
    this.lastRunMs = Date.now() - t0;
    return { freq: out.output.data, time: out.add_67.data };
  }
}
