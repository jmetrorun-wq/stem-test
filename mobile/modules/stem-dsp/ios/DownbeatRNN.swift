// Activations de temps / premiers temps de madmom (RNNDownBeatProcessor,
// Böck et al. 2016) recalculées avec Accelerate : pour chaque centième de
// seconde, probabilité d'un temps et d'un premier temps de mesure. C'est la
// référence utilisée par ChordSplit en production ; le décodage (tempo,
// temps, mesure) est fait ensuite par BeatTracker et beats.js, sans le
// décodeur de madmom qui dépassait 1,5 Go.
//
// Caractéristiques, identiques à madmom : pour 3 tailles de trame (1024,
// 2048, 4096) à 100 trames/s, centrées, fenêtre de Hann symétrique, module
// de la FFT, banc de filtres logarithmique (3, 6, 12 bandes par octave,
// 30 Hz-17 kHz), log10(1 + x), et différence positive avec la trame
// d'écart diff_frames ; les 3 [spectre, différence] mis bout à bout (314
// valeurs). Réseau : moyenne de 8 BLSTM (3 couches de 25 x 2, portes à
// peephole) suivis d'un softmax à 3 classes (pas de temps, temps, premier
// temps). Paramètres extraits de madmom par tools/beats/export_downbeats.py.
//
// Sans dépendance à ExpoModulesCore : testable sur Mac (tools/beats).

import Accelerate
import Foundation

public final class DownbeatRNN {
  public static let sampleRate = 44100
  public static let fps = 100
  public static let hop = sampleRate / fps

  private struct Resolution {
    let frameSize: Int
    let bins: Int
    let bands: Int
    let diffFrames: Int
    let filterbank: [Float]  // bins x bands
    let window: [Float]
    let dft: vDSP_DFT_Setup
  }

  private struct Direction {
    let inputs: Int
    let hidden: Int
    let weights: [Float]     // inputs x (4 * hidden) : portes entrée, oubli, cellule, sortie
    let bias: [Float]        // 4 * hidden
    let recurrent: [Float]   // hidden x (4 * hidden)
    let peephole: [Float]    // 4 * hidden (zéros pour la cellule)
    let initOutput: [Float]
    let initCell: [Float]
  }

  private struct Model {
    let layers: [(forward: Direction, backward: Direction)]
    let outInputs: Int
    let outClasses: Int
    let outWeights: [Float]
    let outBias: [Float]
  }

  private let resolutions: [Resolution]
  private let models: [Model]
  public let featureCount: Int

  public init(contentsOf url: URL) throws {
    let data = try Data(contentsOf: url)
    var offset = 4
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
    guard data.count > 16, data.prefix(4) == Data("DBT1".utf8) else {
      throw NSError(domain: "DownbeatRNN", code: 1, userInfo: [NSLocalizedDescriptionKey: "fichier de poids invalide"])
    }

    var resolutions: [Resolution] = []
    for _ in 0..<ints(1)[0] {
      let h = ints(4)
      let n = h[0]
      let window: [Float] = (0..<n).map { 0.5 - 0.5 * cos(2 * Float.pi * Float($0) / Float(n - 1)) }
      resolutions.append(Resolution(frameSize: n, bins: h[1], bands: h[2], diffFrames: h[3],
                                    filterbank: floats(h[1] * h[2]), window: window,
                                    dft: vDSP_DFT_zop_CreateSetup(nil, vDSP_Length(n), .FORWARD)!))
    }
    self.resolutions = resolutions
    featureCount = resolutions.reduce(0) { $0 + 2 * $1.bands }

    func direction() -> Direction {
      let h = ints(2)
      let (n, hid) = (h[0], h[1])
      // Les 4 portes lues séparément puis regroupées par colonnes.
      var w = [Float](repeating: 0, count: n * 4 * hid)
      var r = [Float](repeating: 0, count: hid * 4 * hid)
      var b = [Float](repeating: 0, count: 4 * hid)
      var p = [Float](repeating: 0, count: 4 * hid)
      for g in 0..<4 {
        let gw = floats(n * hid), gb = floats(hid), gr = floats(hid * hid), gp = floats(hid)
        for i in 0..<n { for j in 0..<hid { w[i * 4 * hid + g * hid + j] = gw[i * hid + j] } }
        for i in 0..<hid { for j in 0..<hid { r[i * 4 * hid + g * hid + j] = gr[i * hid + j] } }
        for j in 0..<hid { b[g * hid + j] = gb[j]; p[g * hid + j] = gp[j] }
      }
      let initOutput = floats(hid), initCell = floats(hid)
      return Direction(inputs: n, hidden: hid, weights: w, bias: b, recurrent: r, peephole: p,
                       initOutput: initOutput, initCell: initCell)
    }
    var models: [Model] = []
    for _ in 0..<ints(1)[0] {
      var layers: [(forward: Direction, backward: Direction)] = []
      for _ in 0..<ints(1)[0] {
        let forward = direction()
        let backward = direction()
        layers.append((forward, backward))
      }
      let o = ints(2)
      models.append(Model(layers: layers, outInputs: o[0], outClasses: o[1], outWeights: floats(o[0] * o[1]), outBias: floats(o[1])))
    }
    self.models = models
    guard offset == data.count, models.first?.layers.first?.forward.inputs == featureCount,
          models.first?.outClasses == 3 else {
      throw NSError(domain: "DownbeatRNN", code: 2, userInfo: [NSLocalizedDescriptionKey: "dimensions de poids inattendues"])
    }
  }

  public static func frameCount(samples: Int) -> Int {
    return (samples + hop - 1) / hop
  }

  /// Caractéristiques : frameCount x featureCount.
  public func features(mono: UnsafePointer<Float>, count: Int) -> [Float] {
    let frames = DownbeatRNN.frameCount(samples: count)
    var out = [Float](repeating: 0, count: frames * featureCount)
    var column = 0
    for res in resolutions {
      let n = res.frameSize
      var spec = [Float](repeating: 0, count: frames * res.bands)
      var inReal = [Float](repeating: 0, count: n)
      let inImag = [Float](repeating: 0, count: n)
      var outReal = [Float](repeating: 0, count: n)
      var outImag = [Float](repeating: 0, count: n)
      var magnitude = [Float](repeating: 0, count: res.bins)
      for f in 0..<frames {
        let start = f * DownbeatRNN.hop - n / 2
        for i in 0..<n {
          let j = start + i
          inReal[i] = (j >= 0 && j < count) ? mono[j] * res.window[i] : 0
        }
        vDSP_DFT_Execute(res.dft, inReal, inImag, &outReal, &outImag)
        for k in 0..<res.bins { magnitude[k] = sqrtf(outReal[k] * outReal[k] + outImag[k] * outImag[k]) }
        spec.withUnsafeMutableBufferPointer { s in
          cblas_sgemv(CblasRowMajor, CblasTrans, Int32(res.bins), Int32(res.bands), 1, res.filterbank, Int32(res.bands),
                      magnitude, 1, 0, s.baseAddress! + f * res.bands, 1)
        }
      }
      for i in 0..<spec.count { spec[i] = log10f(1 + spec[i]) }
      for f in 0..<frames {
        let row = f * featureCount + column
        for b in 0..<res.bands {
          let value = spec[f * res.bands + b]
          out[row + b] = value
          let previous = f >= res.diffFrames ? spec[(f - res.diffFrames) * res.bands + b] : value
          out[row + res.bands + b] = f >= res.diffFrames ? max(0, value - previous) : 0
        }
      }
      column += 2 * res.bands
    }
    return out
  }

  private static func sigmoid(_ x: Float) -> Float { return 1 / (1 + expf(-x)) }

  /// Une direction LSTM sur toute la séquence (dans l'ordre donné).
  private func run(_ d: Direction, input: [Float], frames: Int, reverse: Bool) -> [Float] {
    let h = d.hidden, g4 = 4 * h
    // Projection des entrées pour toutes les trames d'un coup.
    var projected = [Float](repeating: 0, count: frames * g4)
    for f in 0..<frames { for j in 0..<g4 { projected[f * g4 + j] = d.bias[j] } }
    cblas_sgemm(CblasRowMajor, CblasNoTrans, CblasNoTrans, Int32(frames), Int32(g4), Int32(d.inputs),
                1, input, Int32(d.inputs), d.weights, Int32(g4), 1, &projected, Int32(g4))
    var out = [Float](repeating: 0, count: frames * h)
    var prev = d.initOutput, state = d.initCell
    var z = [Float](repeating: 0, count: g4)
    for step in 0..<frames {
      let f = reverse ? frames - 1 - step : step
      for j in 0..<g4 { z[j] = projected[f * g4 + j] }
      // + sortie précédente x poids récurrents
      cblas_sgemv(CblasRowMajor, CblasTrans, Int32(h), Int32(g4), 1, d.recurrent, Int32(g4), prev, 1, 1, &z, 1)
      for j in 0..<h {
        let ig = DownbeatRNN.sigmoid(z[j] + state[j] * d.peephole[j])
        let fg = DownbeatRNN.sigmoid(z[h + j] + state[j] * d.peephole[h + j])
        let cell = tanhf(z[2 * h + j])
        state[j] = cell * ig + state[j] * fg
        let og = DownbeatRNN.sigmoid(z[3 * h + j] + state[j] * d.peephole[3 * h + j])
        let value = tanhf(state[j]) * og
        out[f * h + j] = value
        prev[j] = value
      }
    }
    return out
  }

  /// Activations : frameCount x 2 (temps, premier temps), moyenne des 8
  /// réseaux comme madmom.
  public func activations(mono: UnsafePointer<Float>, count: Int) -> [Float] {
    let x0 = features(mono: mono, count: count)
    let frames = x0.count / featureCount
    var sum = [Float](repeating: 0, count: frames * 2)
    for model in models {
      var x = x0
      for layer in model.layers {
        let fwd = run(layer.forward, input: x, frames: frames, reverse: false)
        let bwd = run(layer.backward, input: x, frames: frames, reverse: true)
        let hf = layer.forward.hidden, hb = layer.backward.hidden
        var next = [Float](repeating: 0, count: frames * (hf + hb))
        for f in 0..<frames {
          for j in 0..<hf { next[f * (hf + hb) + j] = fwd[f * hf + j] }
          for j in 0..<hb { next[f * (hf + hb) + hf + j] = bwd[f * hb + j] }
        }
        x = next
      }
      for f in 0..<frames {
        var logits = model.outBias
        for i in 0..<model.outInputs {
          let v = x[f * model.outInputs + i]
          for c in 0..<model.outClasses { logits[c] += v * model.outWeights[i * model.outClasses + c] }
        }
        let m = logits.max()!
        let e = logits.map { expf($0 - m) }
        let total = e.reduce(0, +)
        sum[f * 2] += e[1] / total
        sum[f * 2 + 1] += e[2] / total
      }
    }
    let scale = 1 / Float(models.count)
    for i in 0..<sum.count { sum[i] *= scale }
    return sum
  }
}
