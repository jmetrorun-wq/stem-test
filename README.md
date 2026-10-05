# stem-test

Prototype : séparation de pistes (voix / batterie / basse / autres) entièrement dans le navigateur, via WebGPU, pour vérifier la faisabilité sur iPhone.

- Modèle : [htdemucs découpé en 21 morceaux fp16](https://huggingface.co/monteslu/htdemucs-web-onnx) (MIT, htdemucs © Meta AI)
- FFT et pré/post-traitement inspirés de [demucs-web](https://github.com/timcsy/demucs-web) (MIT)
