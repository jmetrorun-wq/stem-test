"""Extrait de madmom tout ce qu'il faut pour recalculer ses activations de
temps / premiers temps (RNNDownBeatProcessor, Böck et al. 2016) sur iPhone :
3 bancs de filtres (trames de 1024, 2048, 4096 à 100 /s), écarts de trames
des différences spectrales, et les 8 réseaux BLSTM (3 couches de 25 x 2,
sortie softmax 3 classes). Plus une référence calculée par madmom pour
vérifier l'implémentation Swift.

Le décodage de madmom (DBNDownBeatTrackingProcessor) n'est PAS porté : il
dépassait 1,5 Go en production. L'app décode les activations elle-même
(tempo, programmation dynamique, mesure), cf. beats.js : sur 4 morceaux,
mêmes temps et premiers temps que madmom à 99-100 %.

À lancer avec le Python de ChordSplit (madmom installé) :
  ~/.local/bin/detecteur-accords-web/.venv/bin/python export_downbeats.py <sortie> [audio_de_reference]
"""

import struct
import subprocess
import sys

import numpy as np
from madmom.audio.signal import FramedSignal, Signal
from madmom.audio.spectrogram import FilteredSpectrogram, LogarithmicSpectrogram, SpectrogramDifference
from madmom.audio.stft import ShortTimeFourierTransform
from madmom.features.downbeats import RNNDownBeatProcessor
from madmom.ml.nn import NeuralNetwork
from madmom.models import DOWNBEATS_BLSTM

SR, FPS = 44100, 100
RESOLUTIONS = [(1024, 3), (2048, 6), (4096, 12)]  # (taille de trame, bandes par octave)
GATES = ['input_gate', 'forget_gate', 'cell', 'output_gate']


def features(sig):
    """Comme le pré-traitement de RNNDownBeatProcessor ; renvoie aussi les
    bancs de filtres et écarts de différence."""
    parts, specs = [], []
    for frame_size, bands in RESOLUTIONS:
        frames = FramedSignal(sig, frame_size=frame_size, fps=FPS)
        filt = FilteredSpectrogram(ShortTimeFourierTransform(frames), num_bands=bands,
                                   fmin=30, fmax=17000, norm_filters=True)
        spec = LogarithmicSpectrogram(filt, mul=1, add=1)
        diff = SpectrogramDifference(spec, diff_ratio=0.5, positive_diffs=True)
        parts.append(np.hstack((spec, diff)))
        specs.append((frame_size, np.asarray(filt.filterbank, np.float32), int(diff.diff_frames)))
    return np.hstack(parts).astype(np.float32), specs


def write_bin(path, specs, models):
    """En-tête 'DBT1'. Puis, pour chaque résolution : taille de trame,
    nb de bins, nb de bandes, écart de différence, banc de filtres (bins x
    bandes). Puis nb de modèles ; pour chaque modèle, nb de couches BLSTM,
    et pour chaque couche et sens (avant puis arrière) : entrées, cachés,
    puis pour chaque porte (entrée, oubli, cellule, sortie) poids
    (entrées x cachés), biais, poids récurrents (cachés x cachés), peephole
    (cachés, zéros pour la cellule) ; puis état initial de sortie et de
    cellule. Enfin la couche de sortie : entrées, sorties, poids, biais.
    Tout en int32 / float32 petit-boutiste."""
    f = open(path, 'wb')
    i32 = lambda *v: f.write(struct.pack(f'<{len(v)}i', *v))
    f32 = lambda a: f.write(np.ascontiguousarray(a, dtype='<f4').tobytes())
    f.write(b'DBT1')
    i32(len(specs))
    for frame_size, fb, diff_frames in specs:
        i32(frame_size, fb.shape[0], fb.shape[1], diff_frames)
        f32(fb)
    i32(len(models))
    for nn in models:
        blstm, out = nn.layers[:-1], nn.layers[-1]
        i32(len(blstm))
        for layer in blstm:
            for d in (layer.fwd_layer, layer.bwd_layer):
                n_in, n_h = d.cell.weights.shape
                i32(n_in, n_h)
                for g in GATES:
                    gate = getattr(d, g)
                    f32(gate.weights); f32(np.broadcast_to(gate.bias, (n_h,)))
                    f32(gate.recurrent_weights)
                    f32(gate.peephole_weights if getattr(gate, 'peephole_weights', None) is not None else np.zeros(n_h))
                f32(np.broadcast_to(d.init, (n_h,))); f32(np.broadcast_to(d.cell_init, (n_h,)))
        assert out.activation_fn.__name__ == 'softmax'
        i32(*out.weights.shape)
        f32(out.weights); f32(np.broadcast_to(out.bias, (out.weights.shape[1],)))
    f.close()


def main():
    out_dir = sys.argv[1]
    models = [NeuralNetwork.load(p) for p in DOWNBEATS_BLSTM]
    for nn in models:
        for layer in nn.layers[:-1]:
            for d in (layer.fwd_layer, layer.bwd_layer):
                assert d.activation_fn.__name__ == 'tanh' and d.cell.activation_fn.__name__ == 'tanh'
                assert all(getattr(d, g).activation_fn.__name__ == 'sigmoid' for g in ('input_gate', 'forget_gate', 'output_gate'))
    _, specs = features(Signal(np.zeros(SR, np.float32), sample_rate=SR))
    write_bin(f'{out_dir}/downbeats.bin', specs, models)
    print('résolutions', [(fs, fb.shape, d) for fs, fb, d in specs], '|', len(models), 'modèles')

    if len(sys.argv) > 2:
        raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', sys.argv[2], '-f', 's16le', '-ac', '1', '-ar', str(SR), '-'],
                             capture_output=True, check=True).stdout
        audio = np.frombuffer(raw, dtype=np.int16)
        (audio.astype(np.float32) / 32768).astype('<f4').tofile(f'{out_dir}/ref_audio.f32')
        sig = Signal(audio, sample_rate=SR)
        feats, _ = features(sig)
        feats.astype('<f4').tofile(f'{out_dir}/ref_features.f32')
        act = RNNDownBeatProcessor()(sig)
        np.asarray(act, dtype='<f4').tofile(f'{out_dir}/ref_activations.f32')
        print('référence :', feats.shape, 'caractéristiques,', act.shape, 'activations')


if __name__ == '__main__':
    main()
