// Traitement d'une tranche hors modèle pour htdemucs, équivalent natif de
// jsDsp (separator.js) : STFT / iSTFT avec Accelerate (vDSP), assemblage
// par fondu et conversion Int16. En JavaScript (Hermes, sans JIT), les FFT
// prenaient ~33 s par tranche sur iPhone 13, puis les boucles restantes
// ~6 s, contre ~4-5 s pour le modèle lui-même.
//
// Volontairement sans dépendance à ExpoModulesCore : testable sur Mac avec
// swiftc (cf. tools/test_stem_dsp.sh).

import Accelerate
import Foundation

public final class StemDsp {
  public static let fftSize = 4096
  public static let hop = 1024
  public static let segment = 343980
  public static let bins = 2048
  public static let frames = 336
  public static let stride = Int(Double(segment) * 0.75)

  // Trames STFT avec padding demucs : 336 utiles + 2 vides de chaque côté.
  private static let paddedFrames = frames + 4
  private static let istftLength = (paddedFrames - 1) * hop + fftSize
  private static let istftOffset = fftSize / 2 + (hop / 2) * 3

  public static let shared = StemDsp()

  private let window: [Float]
  private let windowSum: [Float]
  private let forward: vDSP_DFT_Setup
  private let inverse: vDSP_DFT_Setup
  // Sortie de freqToTime réutilisée d'une tranche à l'autre (8 x segment).
  private lazy var freqTimeScratch = [Float](repeating: 0, count: 8 * StemDsp.segment)

  private init() {
    let n = StemDsp.fftSize
    window = (0..<n).map { 0.5 * (1 - cos(2 * Float.pi * Float($0) / Float(n))) }
    // Somme des fenêtres au carré sur toutes les trames : ne dépend pas du
    // signal, donc calculée une fois.
    var sum = [Float](repeating: 0, count: StemDsp.istftLength)
    for f in 0..<StemDsp.paddedFrames {
      let start = f * StemDsp.hop
      for i in 0..<n where start + i < sum.count {
        sum[start + i] += window[i] * window[i]
      }
    }
    windowSum = sum
    forward = vDSP_DFT_zop_CreateSetup(nil, vDSP_Length(n), .FORWARD)!
    inverse = vDSP_DFT_zop_CreateSetup(nil, vDSP_Length(n), .INVERSE)!
  }

  private static func reflectPad(_ signal: [Float], _ left: Int, _ right: Int) -> [Float] {
    let length = signal.count
    var out = [Float](repeating: 0, count: left + length + right)
    for i in 0..<left { out[i] = signal[min(left - i, length - 1)] }
    for i in 0..<length { out[left + i] = signal[i] }
    for i in 0..<right { out[left + length + i] = signal[max(0, length - 2 - i)] }
    return out
  }

  /// left/right : `segment` échantillons. out : 4 x bins x frames
  /// (réel G, imaginaire G, réel D, imaginaire D), comme le `magSpec` JS.
  public func prepareInput(left: UnsafePointer<Float>, right: UnsafePointer<Float>, out: UnsafeMutablePointer<Float>) {
    let n = StemDsp.fftSize, hop = StemDsp.hop, seg = StemDsp.segment
    let bins = StemDsp.bins, frames = StemDsp.frames, plane = bins * frames
    let le = (seg + hop - 1) / hop
    let pad = (hop / 2) * 3
    let padRight = pad + le * hop - seg
    let scale = 1 / sqrtf(Float(n))

    var inReal = [Float](repeating: 0, count: n)
    let inImag = [Float](repeating: 0, count: n)
    var outReal = [Float](repeating: 0, count: n)
    var outImag = [Float](repeating: 0, count: n)

    for (c, src) in [left, right].enumerated() {
      let signal = Array(UnsafeBufferPointer(start: src, count: seg))
      let padded = StemDsp.reflectPad(StemDsp.reflectPad(signal, pad, padRight), n / 2, n / 2)
      let realPlane = out + (2 * c) * plane
      let imagPlane = out + (2 * c + 1) * plane
      for f in 0..<frames {
        let start = (f + 2) * hop
        for i in 0..<n { inReal[i] = padded[start + i] * window[i] }
        vDSP_DFT_Execute(forward, inReal, inImag, &outReal, &outImag)
        for b in 0..<bins {
          realPlane[b * frames + f] = outReal[b] * scale
          imagPlane[b * frames + f] = outImag[b] * scale
        }
      }
    }
  }

  /// freq : sortie fréquentielle du modèle, 4 pistes x 4 plans x bins x
  /// frames. out : 8 lignes de `segment` échantillons (piste * 2 + canal).
  public func freqToTime(freq: UnsafePointer<Float>, out: UnsafeMutablePointer<Float>) {
    let n = StemDsp.fftSize, hop = StemDsp.hop, seg = StemDsp.segment
    let bins = StemDsp.bins, frames = StemDsp.frames, plane = bins * frames
    // ifft divise par n, puis la fenêtre est multipliée par sqrt(n).
    let gain = sqrtf(Float(n)) / Float(n)

    var specReal = [Float](repeating: 0, count: n)
    var specImag = [Float](repeating: 0, count: n)
    var outReal = [Float](repeating: 0, count: n)
    var outImag = [Float](repeating: 0, count: n)
    var signal = [Float](repeating: 0, count: StemDsp.istftLength)

    for track in 0..<4 {
      for c in 0..<2 {
        let realPlane = freq + (track * 4 + 2 * c) * plane
        let imagPlane = freq + (track * 4 + 2 * c + 1) * plane
        for i in 0..<signal.count { signal[i] = 0 }
        // Les trames vides (0, 1, 338, 339) ne contribuent que par la
        // somme des fenêtres, déjà précalculée.
        for f in 0..<frames {
          for k in 0..<bins {
            specReal[k] = realPlane[k * frames + f]
            specImag[k] = imagPlane[k * frames + f]
          }
          specReal[bins] = 0
          specImag[bins] = 0
          for k in 1..<bins {
            specReal[n - k] = specReal[k]
            specImag[n - k] = -specImag[k]
          }
          vDSP_DFT_Execute(inverse, specReal, specImag, &outReal, &outImag)
          let start = (f + 2) * hop
          for i in 0..<n {
            signal[start + i] += outReal[i] * window[i] * gain
          }
        }
        let dst = out + (track * 2 + c) * seg
        for i in 0..<seg {
          let j = StemDsp.istftOffset + i
          let w = windowSum[j]
          dst[i] = w > 1e-8 ? signal[j] / w : 0
        }
      }
    }
  }

  /// Équivalent de jsDsp.segmentInput : extrait [start, start + segLen) des
  /// pistes Int16, remplit waveform (2 x segment, complété de zéros) et
  /// magOut (cf. prepareInput).
  public func segmentInput(left: UnsafePointer<Int16>, right: UnsafePointer<Int16>, start: Int, segLen: Int,
                           waveform: UnsafeMutablePointer<Float>, magOut: UnsafeMutablePointer<Float>) {
    let seg = StemDsp.segment
    waveform.initialize(repeating: 0, count: 2 * seg)
    for i in 0..<segLen {
      waveform[i] = Float(left[start + i]) / 32768
      waveform[seg + i] = Float(right[start + i]) / 32768
    }
    prepareInput(left: waveform, right: waveform + seg, out: magOut)
  }

  /// Équivalent de jsDsp.accumulate : ajoute (branche temps + iSTFT de la
  /// branche fréquence) x poids de fondu à acc (8 x segment), poids à wacc.
  public func accumulate(freq: UnsafePointer<Float>, time: UnsafePointer<Float>,
                         acc: UnsafeMutablePointer<Float>, wacc: UnsafeMutablePointer<Float>,
                         segLen: Int, isFirst: Bool, isLast: Bool) {
    let seg = StemDsp.segment
    let fade = Double(StemDsp.stride) * 0.5
    var weights = [Float](repeating: 0, count: segLen)
    for i in 0..<segLen {
      weights[i] = Float(min(isFirst ? 1 : Double(i) / fade, isLast ? 1 : Double(segLen - i) / fade, 1))
      wacc[i] += weights[i]
    }
    freqTimeScratch.withUnsafeMutableBufferPointer { scratch in
      freqToTime(freq: freq, out: scratch.baseAddress!)
      for row in 0..<8 {
        let offset = row * seg
        for i in 0..<segLen {
          acc[offset + i] += (time[offset + i] + scratch[offset + i]) * weights[i]
        }
      }
    }
  }

  /// Équivalent de jsDsp.flush : écrit les finalLen premiers échantillons
  /// normalisés en Int16 (8 lignes de finalLen) puis décale acc et wacc
  /// de `stride` pour la tranche suivante.
  public func flush(acc: UnsafeMutablePointer<Float>, wacc: UnsafeMutablePointer<Float>,
                    finalLen: Int, out: UnsafeMutablePointer<Int16>) {
    let seg = StemDsp.segment, stride = StemDsp.stride
    for row in 0..<8 {
      let offset = row * seg
      for i in 0..<finalLen {
        let v = wacc[i] > 1e-8 ? acc[offset + i] / wacc[i] : 0
        out[row * finalLen + i] = Int16(max(-32768, min(32767, (v * 32767 + 0.5).rounded(.down))))
      }
      // Zones qui se chevauchent : memmove plutôt que update(from:).
      memmove(acc + offset, acc + offset + stride, (seg - stride) * MemoryLayout<Float>.stride)
      (acc + offset + seg - stride).update(repeating: 0, count: stride)
    }
    memmove(wacc, wacc + stride, (seg - stride) * MemoryLayout<Float>.stride)
    (wacc + seg - stride).update(repeating: 0, count: stride)
  }
}
