// Enregistrement d'une piste séparée en AAC (.m4a) avec l'encodeur d'iOS.
// En WAV, les 4 pistes d'une chanson de 4-5 min pèsent ~200 Mo ; en AAC
// 192 kb/s, ~25 Mo. Et la conversion Int16 -> float ne peut pas se faire
// en JavaScript : ~100 millions d'échantillons par chanson, plus d'une
// minute et demie sous Hermes.
//
// Sans dépendance à ExpoModulesCore : testable sur Mac (tools/dsp-test).

import AVFoundation
import Foundation

public enum StemAudio {
  public static let sampleRate = 44100.0
  public static let bitRate = 192_000

  /// Écrit left/right (Int16, `count` échantillons) dans `url` (.m4a).
  public static func writeAAC(url: URL, left: UnsafePointer<Int16>, right: UnsafePointer<Int16>, count: Int) throws {
    try? FileManager.default.removeItem(at: url)
    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: sampleRate,
      AVNumberOfChannelsKey: 2,
      AVEncoderBitRateKey: bitRate,
    ]
    let file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
    let chunk = Int(sampleRate) * 10
    guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(chunk)),
          let channels = buffer.floatChannelData else {
      throw NSError(domain: "StemAudio", code: 1, userInfo: [NSLocalizedDescriptionKey: "tampon audio impossible à créer"])
    }
    var position = 0
    while position < count {
      let n = min(chunk, count - position)
      for i in 0..<n {
        channels[0][i] = Float(left[position + i]) / 32768
        channels[1][i] = Float(right[position + i]) / 32768
      }
      buffer.frameLength = AVAudioFrameCount(n)
      try file.write(from: buffer)
      position += n
    }
    // Le fichier est finalisé à la libération de `file`, en fin de fonction.
  }
}
