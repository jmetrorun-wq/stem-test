// Banc d'essai Mac de StemAudio.mixAAC : additionne des pistes .m4a.
import Foundation
let args = CommandLine.arguments
let output = URL(fileURLWithPath: args[1])
let inputs = args.dropFirst(2).map { URL(fileURLWithPath: $0) }
let t0 = Date()
try! StemAudio.mixAAC(inputs: Array(inputs), gains: inputs.map { _ in 1 }, output: output)
print("mixé", inputs.count, "pistes en", Int(Date().timeIntervalSince(t0) * 1000), "ms")
