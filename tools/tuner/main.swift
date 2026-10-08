// Banc d'essai Mac de PitchDetector.swift : cordes pincées synthétiques
// (Karplus-Strong, comme le son de référence de l'accordeur) désaccordées
// de -30 à +30 cents, analysées par fenêtres de 4096 comme dans l'app.
import Foundation
let sr = 44100.0
func pluck(_ f: Double, seconds: Double) -> [Float] {
  let n = max(2, Int((sr / f).rounded()))
  var line = (0..<n).map { _ in Float.random(in: -1...1) }
  for _ in 0..<2 { for i in 1..<n { line[i] = 0.5 * (line[i] + line[i - 1]) } }
  let len = Int(sr * seconds); var out = [Float](repeating: 0, count: len); var idx = 0
  for i in 0..<len { let a = line[idx], b = line[(idx + n - 1) % n]; let v: Float = 0.996 * 0.5 * (a + b); out[i] = v; line[idx] = v; idx = (idx + 1) % n }
  return out.map { $0 * 0.5 }
}
let strings: [(String, Double)] = [("E2", 82.41), ("A2", 110.0), ("D3", 146.83), ("G3", 196.0), ("B3", 246.94), ("E4", 329.63), ("Basse E1", 41.20), ("Uku A4", 440.0)]
var worst = 0.0, octaveErrors = 0, missed = 0, total = 0
var perString: [String: (Int, Int, Double)] = [:]
let t0 = Date()
for (name, f0) in strings {
  for cents in stride(from: -30.0, through: 30.0, by: 10.0) {
    let f = f0 * pow(2, cents / 1200)
    // Karplus-Strong : délai entier n + demi-échantillon du filtre moyenneur,
    // d'où une fréquence réelle sr / (n + 0,5).
    let actual = sr / ((sr / f).rounded() + 0.5)
    let sig = pluck(f, seconds: 1.5)
    PitchDetector.shared.reset()
    let fmin = f0 < 60 ? 30.0 : 70.0, fmax = f0 > 400 ? 1000.0 : 400.0
    for start in stride(from: 4096, to: sig.count - 4096, by: 4096) {
      let det = sig[start..<start + 4096].withUnsafeBufferPointer { PitchDetector.shared.detect(samples: $0.baseAddress!, count: 4096, sampleRate: sr, fmin: fmin, fmax: fmax) }
      total += 1
      var st = perString[name] ?? (0, 0, 0)
      st.0 += 1
      if det < 0 { missed += 1; perString[name] = st; continue }
      st.1 += 1
      let err = 1200 * log2(det / actual)
      if abs(err) > 600 { octaveErrors += 1 } else { worst = max(worst, abs(err)); st.2 = max(st.2, abs(err)) }
      perString[name] = st
    }
  }
  let st = perString[name]!
  print(name, "détecté", st.1, "/", st.0, String(format: "erreur max %.2f cents", st.2))
}
print(String(format: "%d analyses en %d ms | erreur max %.2f cents | erreurs d'octave %d | sans résultat %d", total, Int(Date().timeIntervalSince(t0) * 1000), worst, octaveErrors, missed))
