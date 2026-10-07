// Banc d'essai Mac de DownbeatRNN.swift contre la référence madmom
// produite par export_downbeats.py.
import Foundation
func read(_ path: String) -> [Float] {
  let data = try! Data(contentsOf: URL(fileURLWithPath: path))
  return data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
}
func compare(_ name: String, _ a: [Float], _ b: [Float]) {
  precondition(a.count == b.count, "\(name) : tailles \(a.count) / \(b.count)")
  var e = 0.0, d = 0.0, m: Float = 0
  for i in 0..<a.count { e += Double(b[i] * b[i]); d += Double((a[i] - b[i]) * (a[i] - b[i])); m = max(m, abs(a[i] - b[i])) }
  print(name, "écart max", m, "| SNR", String(format: "%.1f dB", 10 * log10(e / max(d, 1e-30))))
}
let dir = CommandLine.arguments[1]
let rnn = try! DownbeatRNN(contentsOf: URL(fileURLWithPath: dir + "/downbeats.bin"))
let audio = read(dir + "/ref_audio.f32")
var t0 = Date()
let feats = audio.withUnsafeBufferPointer { rnn.features(mono: $0.baseAddress!, count: $0.count) }
print("caractéristiques :", Int(Date().timeIntervalSince(t0) * 1000), "ms")
compare("caractéristiques", feats, read(dir + "/ref_features.f32"))
t0 = Date()
let act = audio.withUnsafeBufferPointer { rnn.activations(mono: $0.baseAddress!, count: $0.count) }
print("activations :", Int(Date().timeIntervalSince(t0) * 1000), "ms pour", audio.count / 44100, "s")
compare("activations", act, read(dir + "/ref_activations.f32"))
