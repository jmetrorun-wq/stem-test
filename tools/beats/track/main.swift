// Banc d'essai Mac de BeatTracker.swift contre tools/beats/rnn_dp2.py.
import Foundation
let env: [Float] = { let d = try! Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])); return d.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) } }()
let ref: [Int32] = { let d = try! Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2])); return d.withUnsafeBytes { Array($0.bindMemory(to: Int32.self)) } }()
let t0 = Date()
let lag = BeatTracker.period(activation: env)
let beats = BeatTracker.track(activation: env, period: lag)
print("lag", lag, "|", beats.count, "temps en", Int(Date().timeIntervalSince(t0) * 1000), "ms | identiques :", beats.map(Int32.init) == ref)
