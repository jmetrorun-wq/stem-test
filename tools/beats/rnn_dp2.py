import numpy as np
from beats import track
from evalbeats import fmeasure
def peaks(ac, lags):
    v = ac[lags]
    return [k for k in range(1, len(v) - 1) if v[k] >= v[k - 1] and v[k] >= v[k + 1]]
def tempo_lag(env, rule, thr, fps=100, lo=50, hi=200):
    ac = np.correlate(env - env.mean(), env - env.mean(), 'full')[len(env) - 1:]
    lags = np.arange(int(60 * fps / hi), int(60 * fps / lo) + 1)
    pk = peaks(ac, lags)
    best = max(pk, key=lambda k: ac[lags[k]])
    if rule == 'max': return int(lags[best])
    strong = [k for k in pk if ac[lags[k]] >= thr * ac[lags[best]]]
    lag = int(lags[min(strong)])  # le plus rapide parmi les pics forts
    if rule == 'rapide+moitié' and 60 * fps / lag > 140 and 2 * lag < len(ac):
        # au-delà de 140 BPM, la moitié du tempo si elle est bien marquée
        w = 3; half = max(ac[2 * lag - w: 2 * lag + w + 1])
        if half >= 0.5 * ac[lag]: lag = 2 * lag - w + int(np.argmax(ac[2 * lag - w: 2 * lag + w + 1]))
    return lag
for rule, thr in [('rapide', 0.8), ('rapide+moitié', 0.8), ('rapide+moitié', 0.7)]:
    res = []
    for i in [1, 2, 3, 4]:
        act = np.load(f'act{i}.npy'); beat_act = act[:, 0] + act[:, 1]
        lag = tempo_lag(beat_act, rule, thr); beats = track(beat_act, lag)
        best = None
        for bpb in (3, 4):
            for phase in range(bpb):
                s = act[beats[phase::bpb], 1].mean()
                if best is None or s > best[0]: best = (s, bpb, phase)
        _, bpb, phase = best
        mm = np.load(f'mm{i}.npy')
        res.append((6000 / lag, fmeasure(beats / 100, mm[:, 0]), bpb, int(mm[:, 1].max()), fmeasure(beats[phase::bpb] / 100, mm[mm[:, 1] == 1, 0])))
    print(f'{rule} {thr}: ' + ' | '.join(f'{t:.0f}bpm F{fb:.2f} {b}/{rb} Fpt{fd:.2f}' for t, fb, b, rb, fd in res), flush=True)
