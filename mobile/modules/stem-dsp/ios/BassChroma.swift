// Note de basse lue sur la piste basse séparée, pour les accords renversés
// (A♭/C) et pour l'accord lui-même : sur le mix, les harmoniques d'une
// basse en mi (si, sol#) faisaient prendre un B♭m7♭5/E pour un « E ».
//
// Trames de 32768 échantillons (0,74 s, résolution 1,3 Hz : à 8192, deux
// notes graves voisines se confondaient) centrées tous les 4410 (10 /s,
// comme le chroma profond), fenêtre de Hann symétrique, module de la FFT.
// Pour chaque note de E1 (41 Hz) à G3 (196 Hz) : somme des modules de ses
// 5 premières harmoniques (bin le plus fort à ±1/4 de demi-ton, harmonique
// h pondérée par 1/h), ajoutée à sa classe de hauteur. Équivalent de
// bass_chroma.py (mis au point sur Mac, cf. tools/chroma).
//
// Sans dépendance à ExpoModulesCore : testable sur Mac (tools/chroma).

import Accelerate
import Foundation

public final class BassChroma {
  public static let sampleRate = 44100.0
  public static let frameSize = 32768
  public static let hop = 4410

  public static let shared = BassChroma()

  private let window: [Float]
  private let dft: vDSP_DFT_Setup
  // Pour chaque note candidate (MIDI 28 à 55) : classe de hauteur et
  // intervalles de bins [lo, hi] de ses 5 harmoniques.
  private let candidates: [(pitchClass: Int, ranges: [(lo: Int, hi: Int)])]

  private init() {
    let n = BassChroma.frameSize
    window = (0..<n).map { 0.5 - 0.5 * cos(2 * Float.pi * Float($0) / Float(n - 1)) }
    dft = vDSP_DFT_zop_CreateSetup(nil, vDSP_Length(n), .FORWARD)!
    let binHz: Double = BassChroma.sampleRate / Double(n)
    let quarterTone: Double = pow(2.0, 1.0 / 48.0)
    var list: [(pitchClass: Int, ranges: [(lo: Int, hi: Int)])] = []
    for midi in 28...55 {
      let f0: Double = 440.0 * pow(2.0, Double(midi - 69) / 12.0)
      var ranges: [(lo: Int, hi: Int)] = []
      for h in 1...5 {
        let center: Double = Double(h) * f0 / binHz
        let lo = Int((center / quarterTone).rounded(.down))
        let hi = Int((center * quarterTone).rounded(.up))
        ranges.append((lo: lo, hi: hi))
      }
      list.append((pitchClass: midi % 12, ranges: ranges))
    }
    candidates = list
  }

  public static func frameCount(samples: Int) -> Int {
    return (samples + hop - 1) / hop
  }

  /// mono : `count` échantillons à 44,1 kHz -> frameCount x 12.
  public func compute(mono: UnsafePointer<Float>, count: Int) -> [Float] {
    let n = BassChroma.frameSize, hop = BassChroma.hop
    let frames = BassChroma.frameCount(samples: count)
    var out = [Float](repeating: 0, count: frames * 12)
    var inReal = [Float](repeating: 0, count: n)
    let inImag = [Float](repeating: 0, count: n)
    var outReal = [Float](repeating: 0, count: n)
    var outImag = [Float](repeating: 0, count: n)
    // Seuls les bins jusqu'à la 5e harmonique de G3 (~1 kHz) servent.
    let maxBin = candidates.flatMap { $0.ranges.map { $0.hi } }.max()! + 1
    var magnitude = [Float](repeating: 0, count: maxBin)

    for f in 0..<frames {
      let start = f * hop - n / 2
      for i in 0..<n {
        let j = start + i
        inReal[i] = (j >= 0 && j < count) ? mono[j] * window[i] : 0
      }
      vDSP_DFT_Execute(dft, inReal, inImag, &outReal, &outImag)
      for k in 0..<maxBin {
        magnitude[k] = sqrtf(outReal[k] * outReal[k] + outImag[k] * outImag[k])
      }
      for candidate in candidates {
        var sum: Float = 0
        for (h, range) in candidate.ranges.enumerated() {
          var peak: Float = 0
          for k in range.lo...range.hi where magnitude[k] > peak { peak = magnitude[k] }
          sum += peak / Float(h + 1)
        }
        out[f * 12 + candidate.pitchClass] += sum
      }
    }
    return out
  }
}
