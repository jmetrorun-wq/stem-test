// Détection de la hauteur jouée pour l'accordeur, portage de l'accordeur de
// ChordSplit (static/tuner.js), mis au point sur iPhone :
//  - passe-haut ~70 Hz (ronflement, manipulation), état conservé d'un
//    appel à l'autre, puis sous-échantillonnage par 2 ;
//  - NSDF de McLeod, n(τ) = 2·Σ x[i]x[i+τ] / Σ (x[i]² + x[i+τ]²), plus
//    robuste qu'un YIN quand la corde s'éteint ;
//  - recherche bornée à [fmin, fmax] (sinon erreurs d'octave) ; premier
//    pic ≥ 0,9 x le plus haut ; interpolation parabolique.
// En natif : en JavaScript (Hermes), ce calcul ne suivait pas le micro.
//
// Sans dépendance à ExpoModulesCore : testable sur Mac (tools/tuner).

import Foundation

public final class PitchDetector {
  public static let shared = PitchDetector()

  static let highPassHz: Float = 70
  static let decimation = 2
  static let pickRatio: Float = 0.9   // 1er pic ≥ 0,9 x pic max (anti-octave)
  static let minClarity: Float = 0.55 // en deçà : pas assez périodique
  static let rmsGate: Float = 0.004   // en deçà : silence

  private var hpY: Float = 0
  private var hpX: Float = 0

  public func reset() {
    hpY = 0
    hpX = 0
  }

  /// Fréquence (Hz) de `samples` (mono, `sampleRate`), ou -1 si aucune
  /// note nette entre fmin et fmax.
  public func detect(samples: UnsafePointer<Float>, count: Int, sampleRate: Double, fmin: Double, fmax: Double) -> Double {
    // Passe-haut du 1er ordre + moyenne par paquets de `decimation`.
    let rc: Float = 1 / (2 * Float.pi * PitchDetector.highPassHz)
    let dt: Float = 1 / Float(sampleRate)
    let a: Float = rc / (rc + dt)
    let d = PitchDetector.decimation
    let n = count / d
    var x = [Float](repeating: 0, count: n)
    var y = hpY, xp = hpX
    for i in 0..<n {
      var s: Float = 0
      for k in 0..<d {
        let xi = samples[i * d + k]
        y = a * (y + xi - xp)
        xp = xi
        s += y
      }
      x[i] = s / Float(d)
    }
    hpY = y
    hpX = xp
    let sr: Double = sampleRate / Double(d)

    var energy: Float = 0
    for i in 0..<n { energy += x[i] * x[i] }
    let rms: Float = sqrtf(energy / Float(max(n, 1)))
    if rms < PitchDetector.rmsGate { return -1 }

    let tauMax: Int = min(n / 2, Int((sr / fmin).rounded(.up)))
    let tauMin: Int = max(2, Int((sr / fmax).rounded(.down)))
    if tauMax <= tauMin + 2 { return -1 }
    let w: Int = n - tauMax

    var e0: Float = 0
    for i in 0..<w { e0 += x[i] * x[i] }
    var nsdf = [Float](repeating: 0, count: tauMax + 2)
    for tau in tauMin...tauMax {
      var r: Float = 0
      var et: Float = 0
      for i in 0..<w {
        let p: Float = x[i]
        let q: Float = x[i + tau]
        r += p * q
        et += q * q
      }
      let m: Float = e0 + et
      nsdf[tau] = m > 0 ? (2 * r) / m : 0
    }

    // Maxima locaux positifs ; premier pic ≥ pickRatio x le plus haut.
    var peaks: [Int] = []
    var maxValue: Float = 0
    var t = tauMin + 1
    while t < tauMax {
      if nsdf[t] > 0 && nsdf[t] >= nsdf[t - 1] && nsdf[t] >= nsdf[t + 1] {
        peaks.append(t)
        if nsdf[t] > maxValue { maxValue = nsdf[t] }
        t += 1
      }
      t += 1
    }
    if maxValue < PitchDetector.minClarity { return -1 }
    var chosen = -1
    for p in peaks where nsdf[p] >= PitchDetector.pickRatio * maxValue {
      chosen = p
      break
    }
    if chosen < 0 { return -1 }

    var period = Double(chosen)
    if chosen > tauMin && chosen < tauMax {
      let y1 = Double(nsdf[chosen - 1]), y2 = Double(nsdf[chosen]), y3 = Double(nsdf[chosen + 1])
      let denom: Double = y1 - 2 * y2 + y3
      if denom != 0 {
        let shift: Double = 0.5 * (y1 - y3) / denom
        if shift > -1 && shift < 1 { period = Double(chosen) + shift }
      }
    }
    let f: Double = sr / period
    return (f >= fmin && f <= fmax) ? f : -1
  }
}
