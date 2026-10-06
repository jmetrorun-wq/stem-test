// Banc d'essai Mac de StemAudio.writeAAC : encode une piste de 4:47
// (signal réel lu depuis un fichier Int16 stéréo entrelacé) et mesure le
// temps ; la vérification du contenu se fait ensuite avec ffmpeg.
import Foundation
let input = CommandLine.arguments[1], output = CommandLine.arguments[2]
let data = try! Data(contentsOf: URL(fileURLWithPath: input))
let interleaved = data.withUnsafeBytes { Array($0.bindMemory(to: Int16.self)) }
let count = interleaved.count / 2
var left = [Int16](repeating: 0, count: count), right = left
for i in 0..<count { left[i] = interleaved[2 * i]; right[i] = interleaved[2 * i + 1] }
let t0 = Date()
try! StemAudio.writeAAC(url: URL(fileURLWithPath: output), left: left, right: right, count: count)
print("encodé", count / 44100, "s en", Int(Date().timeIntervalSince(t0) * 1000), "ms")
