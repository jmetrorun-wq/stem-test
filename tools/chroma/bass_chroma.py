"""Chroma de basse simple, facile à porter en Swift : trames de 32768 (0,74 s : résolution de 1,3 Hz, nécessaire pour séparer les notes graves)
échantillons (44,1 kHz) toutes les 4410, fenêtre de Hann, module de la FFT ;
pour chaque note candidate de E1 (41 Hz) à G3 (196 Hz), somme des modules
aux 5 premières harmoniques (bin le plus fort à ±1/4 de demi-ton), ajoutée
à sa classe de hauteur. Comparé à un CQT librosa sur la piste basse."""
import subprocess, sys, numpy as np
SR, N, HOP = 44100, int(sys.argv[1]) if False else 32768, 4410
def bass_chroma(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'], capture_output=True).stdout
    x = np.frombuffer(raw, dtype=np.float32)
    frames = (len(x) + HOP - 1) // HOP
    win = np.hanning(N).astype(np.float32)
    pad = np.concatenate([np.zeros(N // 2, np.float32), x, np.zeros(N, np.float32)])
    out = np.zeros((frames, 12), np.float32)
    midis = np.arange(28, 56)  # E1..G3
    for f in range(frames):
        seg = pad[f * HOP: f * HOP + N] * win
        mag = np.abs(np.fft.rfft(seg))[:N // 2]
        for m in midis:
            f0 = 440 * 2 ** ((m - 69) / 12)
            s = 0.0
            for h in range(1, 6):
                lo = int(np.floor(h * f0 * 2 ** (-1 / 48) * N / SR)); hi = int(np.ceil(h * f0 * 2 ** (1 / 48) * N / SR))
                s += mag[lo:hi + 1].max() / h
            out[f, m % 12] += s
    return out
if __name__ == '__main__':
    for i in sys.argv[1:]:
        bc = bass_chroma(f'song{i}_bass.wav')
        bc.astype('<f4').tofile(f'bass{i}.f32')
        print(i, bc.shape)
