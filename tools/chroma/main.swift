// Banc d'essai Mac de DeepChroma.swift contre la référence madmom produite
// par export_deep_chroma.py.
import Foundation

func read(_ path: String) -> [Float] {
  let data = try! Data(contentsOf: URL(fileURLWithPath: path))
  return data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
}
func compare(_ name: String, _ a: [Float], _ b: [Float]) {
  precondition(a.count == b.count, "\(name) : tailles différentes \(a.count) / \(b.count)")
  var maxDiff: Float = 0
  var energy: Double = 0, noise: Double = 0
  for i in 0..<a.count {
    maxDiff = max(maxDiff, abs(a[i] - b[i]))
    energy += Double(b[i] * b[i]); noise += Double((a[i] - b[i]) * (a[i] - b[i]))
  }
  print(name, "écart max", maxDiff, "| SNR", String(format: "%.1f dB", 10 * log10(energy / max(noise, 1e-30))))
}

let dir = CommandLine.arguments[1]
let model = try! DeepChroma(contentsOf: URL(fileURLWithPath: dir + "/deep_chroma.bin"))
let audio = read(dir + "/ref_audio.f32")
let t0 = Date()
let spec = audio.withUnsafeBufferPointer { model.logSpectrogram(mono: $0.baseAddress!, count: $0.count) }
let chroma = audio.withUnsafeBufferPointer { model.chroma(mono: $0.baseAddress!, count: $0.count) }
print("calcul :", Int(Date().timeIntervalSince(t0) * 1000), "ms pour", audio.count / DeepChroma.sampleRate, "s d'audio")
compare("spectrogramme", spec, read(dir + "/ref_logspec.f32"))
compare("chroma", chroma, read(dir + "/ref_chroma.f32"))
