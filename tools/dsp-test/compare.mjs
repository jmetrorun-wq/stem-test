// Compare StemDsp (natif) à jsDsp (separator.js) sur les mêmes entrées.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsDsp } from '../../separator.js';

const SEG = 343980, PLANE = 2048 * 336;
const dir = mkdtempSync(join(tmpdir(), 'stemdsp-'));
const rand = (n, amp) => Float32Array.from({ length: n }, () => (Math.random() * 2 - 1) * amp);
const left = rand(SEG, 0.3), right = rand(SEG, 0.3), freq = rand(16 * PLANE, 1);
for (const [name, arr] of [['left', left], ['right', right], ['freq', freq]]) writeFileSync(join(dir, name + '.f32'), Buffer.from(arr.buffer));

console.log(execFileSync(join(process.cwd(), 'stemdsp-test'), [dir]).toString().trim());
let t0 = performance.now();
const ref = jsDsp.prepareInput(left, right);
const refTime = jsDsp.freqToTime(freq);
console.log('JS (Node, avec JIT) :', Math.round(performance.now() - t0), 'ms');

const load = (name) => new Float32Array(readFileSync(join(dir, name)).buffer.slice(0));
const snr = (a, b) => { let e = 0, d = 0; for (let i = 0; i < a.length; i++) { e += a[i] ** 2; d += (a[i] - b[i]) ** 2; } return (10 * Math.log10(e / d)).toFixed(1); };
console.log('magSpec  natif vs JS (dB) :', snr(ref.magSpec, load('native_mag.f32')));
console.log('freqToTime natif vs JS (dB) :', snr(refTime, load('native_time.f32')));
