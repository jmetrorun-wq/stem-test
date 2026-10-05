import ExpoModulesCore

// Expose StemDsp à JavaScript avec la même interface que jsDsp
// (separator.js). Les tableaux sont alloués côté JS et remplis ou modifiés
// sur place : aucune copie de ~10 Mo par appel. Appels synchrones (moins
// de 100 ms par tranche sur Mac).
public class StemDspModule: Module {
  private static let specLength = 4 * StemDsp.bins * StemDsp.frames

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
