"""Prototype temps/mesures : enveloppe d'attaques de la piste batterie
(flux spectral, 100 trames/s), tempo par autocorrélation, temps par
programmation dynamique (Ellis 2007), mesure et premier temps d'après les
changements d'accords. Comparé aux mesures de ChordSplit en production."""
import json, subprocess, sys, numpy as np
SR, N, HOP = 44100, 2048, 441  # 100 trames/s

def mono(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'], capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)

def onset_env(x):
    frames = (len(x) + HOP - 1) // HOP
    win = np.hanning(N).astype(np.float32)
    pad = np.concatenate([np.zeros(N // 2, np.float32), x, np.zeros(N, np.float32)])
    prev = None; env = np.zeros(frames, np.float32)
    for f in range(frames):
        mag = np.log1p(100 * np.abs(np.fft.rfft(pad[f * HOP: f * HOP + N] * win)))
        if prev is not None: env[f] = np.maximum(mag - prev, 0).sum()
        prev = mag
    env -= np.convolve(env, np.ones(31) / 31, 'same')  # retire la tendance locale
    env = np.maximum(env, 0)
    return env / (env.std() or 1)

def tempo(env, fps=100):
    ac = np.correlate(env, env, 'full')[len(env) - 1:]
    lags = np.arange(len(ac)); bpm = 60 * fps / np.maximum(lags, 1)
    w = np.exp(-0.5 * (np.log2(bpm / 110) / 0.9) ** 2)  # préférence douce autour de 110 BPM
    ok = (bpm >= 50) & (bpm <= 200)
    lag = int(np.argmax(np.where(ok, ac * w, 0)))
    return 60 * fps / lag, lag

def track(env, period, tightness=100):
    n = len(env); score = env.copy(); back = -np.ones(n, int)
    for i in range(n):
        lo, hi = i - 2 * period, i - period // 2
        if hi <= 0: continue
        j = np.arange(max(0, lo), hi)
        cost = -tightness * np.log((i - j) / period) ** 2
        k = np.argmax(score[j] + cost); score[i] = env[i] + score[j[k]] + cost[k]; back[i] = j[k]
    # dernier temps : maximum sur la dernière période
    i = int(np.argmax(score[n - period:]) + n - period); beats = []
    while i >= 0: beats.append(i); i = back[i]
    return np.array(beats[::-1])

if __name__ == '__main__':
    for i in sys.argv[1:]:
        env = onset_env(mono(f'song{i}_drums.wav'))
        bpm, lag = tempo(env)
        beats = track(env, lag) / 100
        np.save(f'beats{i}.npy', beats)
        ref = json.load(open(f'ref{i}.json'))
        rb = 60 / ref['tempo']; ours = np.median(np.diff(beats))
        print(f'{i} : tempo {bpm:.1f} (prod {ref["tempo"]}) | {len(beats)} temps, intervalle médian {ours:.3f}s, écart-type {np.std(np.diff(beats)):.3f}s')
