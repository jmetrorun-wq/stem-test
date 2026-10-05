// Compare StemDsp (natif) à jsDsp (separator.js) sur une tranche du milieu
// d'un morceau : segmentInput -> accumulate -> flush.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsDsp, SEGMENT_STRIDE as STRIDE } from '../../separator.js';

const SEG = 343980, PLANE = 2048 * 336, TOTAL = 900000;
const start = STRIDE, segLen = SEG, finalLen = STRIDE;
const dir = mkdtempSync(join(tmpdir(), 'stemdsp-'));
const rand = (n, amp) => Float32Array.from({ length: n }, () => (Math.random() * 2 - 1) * amp);
const randI16 = (n) => Int16Array.from({ length: n }, () => Math.round((Math.random() * 2 - 1) * 12000));
const left = randI16(TOTAL), right = randI16(TOTAL);
const freq = rand(16 * PLANE, 1), time = rand(8 * SEG, 0.3);
const acc = rand(8 * SEG, 0.3), wacc = Float32Array.from({ length: SEG }, () => Math.random());
const inputs = { 'params.i32': Int32Array.from([start, segLen, finalLen]), 'left.i16': left, 'right.i16': right,
  'freq.f32': freq, 'time.f32': time, 'acc.f32': acc, 'wacc.f32': wacc };
for (const [name, arr] of Object.entries(inputs)) writeFileSync(join(dir, name), Buffer.from(arr.buffer));

console.log(execFileSync(join(process.cwd(), 'stemdsp-test'), [dir]).toString().trim());
const t0 = performance.now();
const ref = jsDsp.segmentInput(left, right, start, segLen);
jsDsp.accumulate(freq, time, acc, wacc, segLen, false, false);
const refOut = jsDsp.flush(acc, wacc, finalLen);
console.log('JS (Node, avec JIT) :', Math.round(performance.now() - t0), 'ms');

const load = (name, T) => new T(readFileSync(join(dir, name)).buffer.slice(0));
const snr = (a, b) => { let e = 0, d = 0; for (let i = 0; i < a.length; i++) { e += a[i] ** 2; d += (a[i] - b[i]) ** 2; } return d === 0 ? 'identique' : (10 * Math.log10(e / d)).toFixed(1) + ' dB'; };
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
console.log('waveform :', snr(ref.waveform, load('native_waveform.f32', Float32Array)));
console.log('magSpec  :', snr(ref.magSpec, load('native_mag.f32', Float32Array)));
console.log('acc      :', snr(acc, load('native_acc.f32', Float32Array)));
console.log('wacc     :', snr(wacc, load('native_wacc.f32', Float32Array)));
console.log('sortie Int16 : écart max', maxDiff(refOut, load('native_out.i16', Int16Array)), 'pas');
