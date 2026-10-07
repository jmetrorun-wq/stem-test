import ExpoModulesCore

// Expose StemDsp à JavaScript avec la même interface que jsDsp
// (separator.js). Les tableaux sont alloués côté JS et remplis ou modifiés
// sur place : aucune copie de ~10 Mo par appel. Appels synchrones (moins
// de 100 ms par tranche sur Mac).
public class StemDspModule: Module {
  private static let specLength = 4 * StemDsp.bins * StemDsp.frames
  // Chroma profond (accords), chargé une fois depuis le fichier de poids
  // téléchargé par l'app (deep_chroma.bin, cf. tools/chroma).
  private var deepChroma: DeepChroma?
  // Réseau de temps / premiers temps (downbeats.bin, cf. tools/beats).
  private var downbeatRNN: DownbeatRNN?

  public func definition() -> ModuleDefinition {
    Name("StemDsp")

    Function("segmentInput") { (left: Int16Array, right: Int16Array, start: Int, segLen: Int,
                                waveform: Float32Array, magSpec: Float32Array) in
      guard start >= 0, segLen > 0, segLen <= StemDsp.segment,
            start + segLen <= left.length, start + segLen <= right.length,
            waveform.length == 2 * StemDsp.segment, magSpec.length == StemDspModule.specLength else {
        throw Exception(name: "BadLength", description: "segmentInput : tailles de tableaux inattendues")
      }
      StemDsp.shared.segmentInput(
        left: left.rawPointer.assumingMemoryBound(to: Int16.self),
        right: right.rawPointer.assumingMemoryBound(to: Int16.self),
        start: start, segLen: segLen,
        waveform: waveform.rawPointer.assumingMemoryBound(to: Float.self),
        magOut: magSpec.rawPointer.assumingMemoryBound(to: Float.self))
    }

    Function("accumulate") { (freq: Float32Array, time: Float32Array, acc: Float32Array, wacc: Float32Array,
                              segLen: Int, isFirst: Bool, isLast: Bool) in
      guard freq.length == 4 * StemDspModule.specLength, time.length == 8 * StemDsp.segment,
            acc.length == 8 * StemDsp.segment, wacc.length == StemDsp.segment,
            segLen > 0, segLen <= StemDsp.segment else {
        throw Exception(name: "BadLength", description: "accumulate : tailles de tableaux inattendues")
      }
      StemDsp.shared.accumulate(
        freq: freq.rawPointer.assumingMemoryBound(to: Float.self),
        time: time.rawPointer.assumingMemoryBound(to: Float.self),
        acc: acc.rawPointer.assumingMemoryBound(to: Float.self),
        wacc: wacc.rawPointer.assumingMemoryBound(to: Float.self),
        segLen: segLen, isFirst: isFirst, isLast: isLast)
    }

    Function("loadDeepChroma") { (uri: String) in
      let url = URL(string: uri).flatMap { $0.isFileURL ? $0 : nil } ?? URL(fileURLWithPath: uri)
      self.deepChroma = try DeepChroma(contentsOf: url)
    }

    // Chroma (trames x 12) du morceau entier à partir des pistes Int16 :
    // mono = moyenne des canaux, comme madmom. out : frameCount x 12.
    Function("deepChroma") { (left: Int16Array, right: Int16Array, out: Float32Array) in
      guard let model = self.deepChroma else {
        throw Exception(name: "NotLoaded", description: "deepChroma : appeler loadDeepChroma d'abord")
      }
      let count = left.length
      guard right.length == count, out.length == DeepChroma.frameCount(samples: count) * 12 else {
        throw Exception(name: "BadLength", description: "deepChroma : tailles de tableaux inattendues")
      }
      let l = left.rawPointer.assumingMemoryBound(to: Int16.self)
      let r = right.rawPointer.assumingMemoryBound(to: Int16.self)
      var mono = [Float](repeating: 0, count: count)
      for i in 0..<count { mono[i] = (Float(l[i]) + Float(r[i])) / 65536 }
      let chroma = mono.withUnsafeBufferPointer { model.chroma(mono: $0.baseAddress!, count: count) }
      let dst = out.rawPointer.assumingMemoryBound(to: Float.self)
      for i in 0..<chroma.count { dst[i] = chroma[i] }
    }

    // Chroma de la note de basse (trames x 12, 10 /s) d'une piste basse
    // séparée (Int16 stéréo) ; cf. BassChroma.
    Function("bassChroma") { (left: Int16Array, right: Int16Array, out: Float32Array) in
      let count = left.length
      guard right.length == count, out.length == BassChroma.frameCount(samples: count) * 12 else {
        throw Exception(name: "BadLength", description: "bassChroma : tailles de tableaux inattendues")
      }
      let l = left.rawPointer.assumingMemoryBound(to: Int16.self)
      let r = right.rawPointer.assumingMemoryBound(to: Int16.self)
      var mono = [Float](repeating: 0, count: count)
      for i in 0..<count { mono[i] = (Float(l[i]) + Float(r[i])) / 65536 }
      let chroma = mono.withUnsafeBufferPointer { BassChroma.shared.compute(mono: $0.baseAddress!, count: count) }
      let dst = out.rawPointer.assumingMemoryBound(to: Float.self)
      for i in 0..<chroma.count { dst[i] = chroma[i] }
    }

    Function("loadDownbeats") { (uri: String) in
      let url = URL(string: uri).flatMap { $0.isFileURL ? $0 : nil } ?? URL(fileURLWithPath: uri)
      self.downbeatRNN = try DownbeatRNN(contentsOf: url)
    }

    // Temps du morceau (mix Int16 stéréo) : période (trames à 100 /s),
    // trames des temps, et activation « premier temps » à chacun (pour
    // choisir la mesure en JS, cf. beats.js).
    Function("detectBeats") { (left: Int16Array, right: Int16Array) -> [String: Any] in
      guard let rnn = self.downbeatRNN else {
        throw Exception(name: "NotLoaded", description: "detectBeats : appeler loadDownbeats d'abord")
      }
      let count = left.length
      guard right.length == count, count > 0 else {
        throw Exception(name: "BadLength", description: "detectBeats : tailles de tableaux inattendues")
      }
      let l = left.rawPointer.assumingMemoryBound(to: Int16.self)
      let r = right.rawPointer.assumingMemoryBound(to: Int16.self)
      var mono = [Float](repeating: 0, count: count)
      for i in 0..<count { mono[i] = (Float(l[i]) + Float(r[i])) / 65536 }
      let act = mono.withUnsafeBufferPointer { rnn.activations(mono: $0.baseAddress!, count: count) }
      // Écrit en boucles explicites : en expressions compactes, le
      // compilateur Swift des serveurs EAS abandonnait (« unable to
      // type-check this expression in reasonable time »).
      let frames = act.count / 2
      var env = [Float](repeating: 0, count: frames)
      for f in 0..<frames {
        let beat: Float = act[2 * f]
        let downbeat: Float = act[2 * f + 1]
        env[f] = beat + downbeat
      }
      let period: Int = BeatTracker.period(activation: env)
      let beats: [Int] = BeatTracker.track(activation: env, period: period)
      var downbeats: [Double] = []
      downbeats.reserveCapacity(beats.count)
      for b in beats {
        let value: Float = act[2 * b + 1]
        downbeats.append(Double(value))
      }
      var result: [String: Any] = [:]
      result["period"] = period
      result["beats"] = beats
      result["downbeat"] = downbeats
      return result
    }

    // Enregistre une piste (Int16 stéréo) en AAC .m4a (cf. StemAudio).
    Function("saveStem") { (uri: String, left: Int16Array, right: Int16Array) in
      guard left.length == right.length, left.length > 0 else {
        throw Exception(name: "BadLength", description: "saveStem : tailles de tableaux inattendues")
      }
      let url = URL(string: uri).flatMap { $0.isFileURL ? $0 : nil } ?? URL(fileURLWithPath: uri)
      try StemAudio.writeAAC(
        url: url,
        left: left.rawPointer.assumingMemoryBound(to: Int16.self),
        right: right.rawPointer.assumingMemoryBound(to: Int16.self),
        count: left.length)
    }

    Function("flush") { (acc: Float32Array, wacc: Float32Array, finalLen: Int, out: Int16Array) in
      guard acc.length == 8 * StemDsp.segment, wacc.length == StemDsp.segment,
            finalLen > 0, finalLen <= StemDsp.segment, out.length == 8 * finalLen else {
        throw Exception(name: "BadLength", description: "flush : tailles de tableaux inattendues")
      }
      StemDsp.shared.flush(
        acc: acc.rawPointer.assumingMemoryBound(to: Float.self),
        wacc: wacc.rawPointer.assumingMemoryBound(to: Float.self),
        finalLen: finalLen,
        out: out.rawPointer.assumingMemoryBound(to: Int16.self))
    }
  }
}
