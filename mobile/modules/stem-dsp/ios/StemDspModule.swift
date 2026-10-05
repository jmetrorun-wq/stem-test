import ExpoModulesCore

// Expose StemDsp à JavaScript. Les tableaux sont alloués côté JS et remplis
// sur place : aucune copie de ~10 Mo par appel. Appels synchrones (quelques
// dizaines de ms par tranche).
public class StemDspModule: Module {
  public func definition() -> ModuleDefinition {
    Name("StemDsp")

    Function("prepareInput") { (left: Float32Array, right: Float32Array, out: Float32Array) in
      guard left.length == StemDsp.segment, right.length == StemDsp.segment,
            out.length == 4 * StemDsp.bins * StemDsp.frames else {
        throw Exception(name: "BadLength", description: "prepareInput : tailles de tableaux inattendues")
      }
      StemDsp.shared.prepareInput(
        left: left.rawPointer.assumingMemoryBound(to: Float.self),
        right: right.rawPointer.assumingMemoryBound(to: Float.self),
        out: out.rawPointer.assumingMemoryBound(to: Float.self))
    }

    Function("freqToTime") { (freq: Float32Array, out: Float32Array) in
      guard freq.length == 16 * StemDsp.bins * StemDsp.frames, out.length == 8 * StemDsp.segment else {
        throw Exception(name: "BadLength", description: "freqToTime : tailles de tableaux inattendues")
      }
      StemDsp.shared.freqToTime(
        freq: freq.rawPointer.assumingMemoryBound(to: Float.self),
        out: out.rawPointer.assumingMemoryBound(to: Float.self))
    }
  }
}
