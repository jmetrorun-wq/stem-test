// « Chroma profond » de madmom (DeepChromaProcessor, Korzeniowski & Widmer
// 2016) recalculé avec Accelerate : énergie des 12 notes, 10 fois par
// seconde, base de la détection d'accords de ChordSplit. Sur 3 morceaux,
// ses accords (par gabarits) rejoignent ceux de ChordSplit en production
// dans 82 % des cas, contre 29 % pour un chroma classique.
//
// Étapes, identiques à madmom : trames de 8192 échantillons centrées tous
// les 4410 (10/s, zéros hors du signal), fenêtre de Hann symétrique, module
// de la FFT (4096 premiers bins), banc de filtres logarithmique (105
// bandes, 65-2100 Hz), log10(1 + x), contexte de 15 trames, puis réseau
// dense 1575 -> 256 -> 256 -> 256 -> 12 (ReLU, ReLU, ReLU, sigmoïde).
// Paramètres extraits de madmom par tools/chroma/export_deep_chroma.py.
//
// Sans dépendance à ExpoModulesCore : testable sur Mac (tools/chroma).

import Accelerate
import Foundation

public final class DeepChroma {
  public static let sampleRate = 44100
  public static let fps = 10
  public static let frameSize = 8192
  public static let hop = sampleRate / fps
  public static let context = 15

  private struct Layer {
    let inputs: Int
    let outputs: Int
    let weights: [Float]  // inputs x outputs, ligne par ligne
    let bias: [Float]
  }

  private let bins: Int
  private let bands: Int
  private let filterbank: [Float]  // bins x bands
  private let layers: [Layer]
  private let window: [Float]
  private let dft: vDSP_DFT_Setup

  public init(contentsOf url: URL) throws {
    let data = try Data(contentsOf: url)
    var offset = 0
    func ints(_ count: Int) -> [Int] {
      let values = data.withUnsafeBytes { raw in
        (0..<count).map { Int(Int32(littleEndian: raw.loadUnaligned(fromByteOffset: offset + 4 * $0, as: Int32.self))) }
      }
      offset += 4 * count
      return values
    }
    func floats(_ count: Int) -> [Float] {
      let values = data.withUnsafeBytes { raw in
        (0..<count).map { raw.loadUnaligned(fromByteOffset: offset + 4 * $0, as: Float.self) }
      }
      offset += 4 * count
      return values
    }
    guard data.count > 16, data.prefix(4) == Data("DCH1".utf8) else {
      throw NSError(domain: "DeepChroma", code: 1, userInfo: [NSLocalizedDescriptionKey: "fichier de poids invalide"])
    }
    offset = 4
    let header = ints(3)
    bins = header[0]
    bands = header[1]
    let shapes = (0..<header[2]).map { _ in ints(2) }
    filterbank = floats(bins * bands)
    layers = shapes.map { Layer(inputs: $0[0], outputs: $0[1], weights: floats($0[0] * $0[1]), bias: floats($0[1])) }
    guard bins == DeepChroma.frameSize / 2, layers.first?.inputs == DeepChroma.context * bands,
          layers.last?.outputs == 12, offset == data.count else {
      throw NSError(domain: "DeepChroma", code: 2, userInfo: [NSLocalizedDescriptionKey: "dimensions de poids inattendues"])
    }
    let n = DeepChroma.frameSize
    // np.hanning : fenêtre de Hann symétrique.
    window = (0..<n).map { 0.5 - 0.5 * cos(2 * Float.pi * Float($0) / Float(n - 1)) }
    dft = vDSP_DFT_zop_CreateSetup(nil, vDSP_Length(n), .FORWARD)!
  }

  public static func frameCount(samples: Int) -> Int {
    return (samples + hop - 1) / hop
  }

  /// Spectrogramme log filtré : frameCount x bands.
  public func logSpectrogram(mono: UnsafePointer<Float>, count: Int) -> [Float] {
    let n = DeepChroma.frameSize, hop = DeepChroma.hop
    let frames = DeepChroma.frameCount(samples: count)
    var spec = [Float](repeating: 0, count: frames * bands)
    var inReal = [Float](repeating: 0, count: n)
    let inImag = [Float](repeating: 0, count: n)
    var outReal = [Float](repeating: 0, count: n)
    var outImag = [Float](repeating: 0, count: n)
    var magnitude = [Float](repeating: 0, count: bins)

    for f in 0..<frames {
      let start = f * hop - n / 2
      for i in 0..<n {
        let j = start + i
        inReal[i] = (j >= 0 && j < count) ? mono[j] * window[i] : 0
      }
      vDSP_DFT_Execute(dft, inReal, inImag, &outReal, &outImag)
      for k in 0..<bins {
        magnitude[k] = sqrtf(outReal[k] * outReal[k] + outImag[k] * outImag[k])
      }
      // (1 x bins) . (bins x bands)
      spec.withUnsafeMutableBufferPointer { out in
        cblas_sgemv(CblasRowMajor, CblasTrans, Int32(bins), Int32(bands), 1, filterbank, Int32(bands),
                    magnitude, 1, 0, out.baseAddress! + f * bands, 1)
      }
    }
    for i in 0..<spec.count { spec[i] = log10f(1 + spec[i]) }
    return spec
  }

  /// Chroma : frameCount x 12, valeurs entre 0 et 1.
  public func chroma(mono: UnsafePointer<Float>, count: Int) -> [Float] {
    let spec = logSpectrogram(mono: mono, count: count)
    let frames = spec.count / bands
    let half = DeepChroma.context / 2

    // Contexte de 15 trames centré sur chaque trame (zéros aux bords).
    var x = [Float](repeating: 0, count: frames * DeepChroma.context * bands)
    for f in 0..<frames {
      for c in 0..<DeepChroma.context {
        let src = f + c - half
        guard src >= 0 && src < frames else { continue }
        let dst = (f * DeepChroma.context + c) * bands
        for b in 0..<bands { x[dst + b] = spec[src * bands + b] }
      }
    }

    for (index, layer) in layers.enumerated() {
      var y = [Float](repeating: 0, count: frames * layer.outputs)
      for f in 0..<frames {
        for o in 0..<layer.outputs { y[f * layer.outputs + o] = layer.bias[o] }
      }
      cblas_sgemm(CblasRowMajor, CblasNoTrans, CblasNoTrans, Int32(frames), Int32(layer.outputs), Int32(layer.inputs),
                  1, x, Int32(layer.inputs), layer.weights, Int32(layer.outputs), 1, &y, Int32(layer.outputs))
      if index == layers.count - 1 {
        for i in 0..<y.count { y[i] = 1 / (1 + expf(-y[i])) }
      } else {
        for i in 0..<y.count where y[i] < 0 { y[i] = 0 }
      }
      x = y
    }
    return x
  }
}
