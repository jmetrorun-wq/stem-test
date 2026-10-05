// Banc d'essai Mac de StemDsp.swift : lit les entrées produites par
// compare.mjs, écrit les sorties natives pour comparaison avec le JS.
import Foundation

func read(_ path: String) -> [Float] {
  let data = try! Data(contentsOf: URL(fileURLWithPath: path))
  return data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
}
func write(_ values: [Float], _ path: String) {
  values.withUnsafeBufferPointer { try! Data(buffer: $0).write(to: URL(fileURLWithPath: path)) }
}

let dir = CommandLine.arguments[1]
let left = read(dir + "/left.f32"), right = read(dir + "/right.f32"), freq = read(dir + "/freq.f32")
var mag = [Float](repeating: 0, count: 4 * StemDsp.bins * StemDsp.frames)
var time = [Float](repeating: 0, count: 8 * StemDsp.segment)
var t0 = Date()
StemDsp.shared.prepareInput(left: left, right: right, out: &mag)
print("prepareInput :", Int(Date().timeIntervalSince(t0) * 1000), "ms")
t0 = Date()
StemDsp.shared.freqToTime(freq: freq, out: &time)
print("freqToTime :", Int(Date().timeIntervalSince(t0) * 1000), "ms")
write(mag, dir + "/native_mag.f32")
write(time, dir + "/native_time.f32")
