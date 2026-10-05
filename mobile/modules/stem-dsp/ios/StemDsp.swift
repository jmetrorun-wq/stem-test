// STFT / iSTFT de htdemucs avec Accelerate (vDSP), équivalents exacts de
// prepareInput / freqToTimeDomain de separator.js. En JavaScript (Hermes,
// sans JIT), ces ~3 400 FFT de 4096 points prenaient ~33 s par tranche sur
// iPhone 13, contre ~5 s pour le modèle lui-même.
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

  // Trames STFT avec padding demucs : 336 utiles + 2 vides de chaque côté.
  private static let paddedFrames = frames + 4
  private static let istftLength = (paddedFrames - 1) * hop + fftSize
  private static let istftOffset = fftSize / 2 + (hop / 2) * 3

  public static let shared = StemDsp()

  private let window: [Float]
  private let windowSum: [Float]
  private let forward: vDSP_DFT_Setup
  private let inverse: vDSP_DFT_Setup

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
}
