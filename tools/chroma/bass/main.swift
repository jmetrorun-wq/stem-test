// Banc d'essai Mac de BassChroma.swift contre bass_chroma.py.
import Foundation
func read(_ path: String) -> [Float] {
  let data = try! Data(contentsOf: URL(fileURLWithPath: path))
  return data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
}
let mono = read(CommandLine.arguments[1]), ref = read(CommandLine.arguments[2])
let t0 = Date()
let out = mono.withUnsafeBufferPointer { BassChroma.shared.compute(mono: $0.baseAddress!, count: $0.count) }
print("calcul :", Int(Date().timeIntervalSince(t0) * 1000), "ms pour", mono.count / 44100, "s")
precondition(out.count == ref.count, "tailles \(out.count) / \(ref.count)")
var e = 0.0, d = 0.0, sameNote = 0
for f in 0..<(out.count / 12) {
  let a = (0..<12).max { out[f * 12 + $0] < out[f * 12 + $1] }!, b = (0..<12).max { ref[f * 12 + $0] < ref[f * 12 + $1] }!
  if a == b { sameNote += 1 }
  for i in 0..<12 { e += Double(ref[f * 12 + i] * ref[f * 12 + i]); d += Double((out[f * 12 + i] - ref[f * 12 + i]) * (out[f * 12 + i] - ref[f * 12 + i])) }
}
print(String(format: "SNR %.1f dB, même note de basse sur %d / %d trames", 10 * log10(e / d), sameNote, out.count / 12))
