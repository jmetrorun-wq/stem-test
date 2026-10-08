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

  /// Additionne des pistes (.m4a, mêmes format et longueur) avec leurs
  /// gains et enregistre le résultat en AAC : export « ce que j'entends »
  /// (par exemple sans la voix). Par tranches de 10 s, sans tout charger.
  public static func mixAAC(inputs: [URL], gains: [Float], output: URL) throws {
    guard !inputs.isEmpty, inputs.count == gains.count else {
      throw NSError(domain: "StemAudio", code: 2, userInfo: [NSLocalizedDescriptionKey: "aucune piste à exporter"])
    }
    // Boucles explicites (cf. StemDspModule : le compilateur d'EAS rejette
    // parfois les expressions compactes).
    var files: [AVAudioFile] = []
    var length: AVAudioFramePosition = .max
    for url in inputs {
      let file = try AVAudioFile(forReading: url, commonFormat: .pcmFormatFloat32, interleaved: false)
      files.append(file)
      if file.length < length { length = file.length }
    }
    let format = files[0].processingFormat
    try? FileManager.default.removeItem(at: output)
    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: format.sampleRate,
      AVNumberOfChannelsKey: format.channelCount,
      AVEncoderBitRateKey: bitRate,
    ]
    let out = try AVAudioFile(forWriting: output, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
    let chunk = AVAudioFrameCount(sampleRate * 10)
    guard let mix = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: chunk),
          let read = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: chunk) else {
      throw NSError(domain: "StemAudio", code: 1, userInfo: [NSLocalizedDescriptionKey: "tampon audio impossible à créer"])
    }
    let channels = Int(format.channelCount)
    var done: AVAudioFramePosition = 0
    while done < length {
      let n = AVAudioFrameCount(min(AVAudioFramePosition(chunk), length - done))
      mix.frameLength = n
      for c in 0..<channels {
        let dst = mix.floatChannelData![c]
        for i in 0..<Int(n) { dst[i] = 0 }
      }
      for (k, file) in files.enumerated() {
        read.frameLength = 0
        try file.read(into: read, frameCount: n)
        let gain: Float = gains[k]
        let count = Int(read.frameLength)
        for c in 0..<channels {
          let src = read.floatChannelData![c]
          let dst = mix.floatChannelData![c]
          for i in 0..<count { dst[i] += src[i] * gain }
        }
      }
      for c in 0..<channels {
        let dst = mix.floatChannelData![c]
        for i in 0..<Int(n) { dst[i] = max(-1, min(1, dst[i])) }
      }
      try out.write(from: mix)
      done += AVAudioFramePosition(n)
    }
  }
}
