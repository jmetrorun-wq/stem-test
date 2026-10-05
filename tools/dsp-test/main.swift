// Banc d'essai Mac de StemDsp.swift : lit les entrées produites par
// compare.mjs, enchaîne segmentInput -> accumulate -> flush comme pour une
// tranche, et écrit les sorties natives pour comparaison avec jsDsp.
import Foundation

func read<T>(_ path: String, as: T.Type) -> [T] {
  let data = try! Data(contentsOf: URL(fileURLWithPath: path))
  return data.withUnsafeBytes { Array($0.bindMemory(to: T.self)) }
}
func write<T>(_ values: [T], _ path: String) {
  values.withUnsafeBufferPointer { try! Data(buffer: $0).write(to: URL(fileURLWithPath: path)) }
}

let dir = CommandLine.arguments[1]
let params = read(dir + "/params.i32", as: Int32.self).map(Int.init)
let (start, segLen, finalLen) = (params[0], params[1], params[2])
let left = read(dir + "/left.i16", as: Int16.self), right = read(dir + "/right.i16", as: Int16.self)
let freq = read(dir + "/freq.f32", as: Float.self), time = read(dir + "/time.f32", as: Float.self)
var acc = read(dir + "/acc.f32", as: Float.self), wacc = read(dir + "/wacc.f32", as: Float.self)

let seg = StemDsp.segment
var waveform = [Float](repeating: 0, count: 2 * seg)
var mag = [Float](repeating: 0, count: 4 * StemDsp.bins * StemDsp.frames)
var out = [Int16](repeating: 0, count: 8 * finalLen)
let dsp = StemDsp.shared

var t0 = Date()
dsp.segmentInput(left: left, right: right, start: start, segLen: segLen, waveform: &waveform, magOut: &mag)
print("segmentInput :", Int(Date().timeIntervalSince(t0) * 1000), "ms")
t0 = Date()
dsp.accumulate(freq: freq, time: time, acc: &acc, wacc: &wacc, segLen: segLen, isFirst: false, isLast: false)
print("accumulate :", Int(Date().timeIntervalSince(t0) * 1000), "ms")
t0 = Date()
dsp.flush(acc: &acc, wacc: &wacc, finalLen: finalLen, out: &out)
print("flush :", Int(Date().timeIntervalSince(t0) * 1000), "ms")

write(waveform, dir + "/native_waveform.f32")
write(mag, dir + "/native_mag.f32")
write(out, dir + "/native_out.i16")
write(acc, dir + "/native_acc.f32")
write(wacc, dir + "/native_wacc.f32")
