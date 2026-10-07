import sys, numpy as np
def fmeasure(est, ref, tol=0.07):
    if len(est) == 0 or len(ref) == 0: return 0
    used = set(); hit = 0
    for r in ref:
        j = int(np.argmin(np.abs(est - r)))
        if abs(est[j] - r) <= tol and j not in used: used.add(j); hit += 1
    p, rc = hit / len(est), hit / len(ref)
    return 2 * p * rc / (p + rc) if p + rc else 0
if __name__ == '__main__':
    for i in [1, 2, 3, 4]:
        mm = np.load(f'mm{i}.npy'); ref = mm[:, 0]; est = np.load(f'beats{i}.npy')
        print(i, f'F-mesure temps {fmeasure(est, ref):.2f} | tempo nous {60/np.median(np.diff(est)):.1f} madmom {60/np.median(np.diff(ref)):.1f}')
