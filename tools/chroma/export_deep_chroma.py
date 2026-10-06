"""Extrait de madmom tout ce qu'il faut pour recalculer son « chroma
profond » (DeepChromaProcessor, Korzeniowski & Widmer 2016) sur iPhone :
banc de filtres logarithmique, poids du réseau (4 couches denses), et une
référence calculée par madmom pour vérifier l'implémentation Swift.

À lancer avec le Python de ChordSplit (madmom installé) :
  ~/.local/bin/detecteur-accords-web/.venv/bin/python export_deep_chroma.py <sortie> [audio_de_reference]

Sorties : deep_chroma.bin (format décrit dans write_bin), et si un audio
est donné : ref_audio.f32 (mono 44,1 kHz), ref_logspec.f32, ref_chroma.f32.
"""

import struct
import subprocess
import sys

import numpy as np
from madmom.audio.chroma import DeepChromaProcessor
from madmom.audio.signal import FramedSignal, Signal
from madmom.audio.spectrogram import LogarithmicFilteredSpectrogram
from madmom.audio.stft import ShortTimeFourierTransform
from madmom.ml.nn import NeuralNetwork
from madmom.models import CHROMA_DNN

FRAME_SIZE, FPS, SR = 8192, 10, 44100


def filterbank():
    sig = Signal(np.zeros(FRAME_SIZE * 2, dtype=np.float32), sample_rate=SR)
    frames = FramedSignal(sig, frame_size=FRAME_SIZE, fps=FPS)
    spec = LogarithmicFilteredSpectrogram(ShortTimeFourierTransform(frames),
                                          num_bands=24, fmin=65, fmax=2100, unique_filters=True)
    return np.asarray(spec.filterbank, dtype=np.float32)  # (4096, bandes)


def write_bin(path, fb, layers):
    """En-tête : 'DCH1', nb_bins, nb_bandes, nb_couches, puis pour chaque
    couche (entrées, sorties). Ensuite, en float32 petit-boutiste : le banc
    de filtres (nb_bins x nb_bandes), puis pour chaque couche poids
    (entrées x sorties) et biais (sorties)."""
    with open(path, 'wb') as f:
        f.write(b'DCH1')
        f.write(struct.pack('<3i', fb.shape[0], fb.shape[1], len(layers)))
        for w, _ in layers:
            f.write(struct.pack('<2i', *w.shape))
        f.write(fb.astype('<f4').tobytes())
        for w, b in layers:
            f.write(w.astype('<f4').tobytes())
            f.write(b.astype('<f4').tobytes())


def main():
    out_dir = sys.argv[1]
    fb = filterbank()
    nn = NeuralNetwork.load(CHROMA_DNN[0])
    layers = [(np.asarray(l.weights, np.float32), np.asarray(l.bias, np.float32)) for l in nn.layers]
    acts = [l.activation_fn.__name__ for l in nn.layers]
    assert acts == ['relu', 'relu', 'relu', 'sigmoid'], acts
    assert layers[0][0].shape[0] == 15 * fb.shape[1], (layers[0][0].shape, fb.shape)
    write_bin(f'{out_dir}/deep_chroma.bin', fb, layers)
    print('banc de filtres', fb.shape, '| couches', [w.shape for w, _ in layers])

    if len(sys.argv) > 2:
        raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', sys.argv[2], '-f', 's16le', '-ac', '1', '-ar', str(SR), '-'],
                             capture_output=True, check=True).stdout
        audio = np.frombuffer(raw, dtype=np.int16)
        (audio.astype(np.float32) / 32768).astype('<f4').tofile(f'{out_dir}/ref_audio.f32')
        sig = Signal(audio, sample_rate=SR)
        frames = FramedSignal(sig, frame_size=FRAME_SIZE, fps=FPS)
        logspec = LogarithmicFilteredSpectrogram(ShortTimeFourierTransform(frames),
                                                 num_bands=24, fmin=65, fmax=2100, unique_filters=True)
        np.asarray(logspec, dtype='<f4').tofile(f'{out_dir}/ref_logspec.f32')
        chroma = DeepChromaProcessor()(sig)
        np.asarray(chroma, dtype='<f4').tofile(f'{out_dir}/ref_chroma.f32')
        print('référence :', len(audio), 'échantillons ->', logspec.shape, 'spectre,', chroma.shape, 'chroma')


if __name__ == '__main__':
    main()
