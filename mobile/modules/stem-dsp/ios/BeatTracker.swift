// Temps du morceau à partir de l'activation de temps (DownbeatRNN, temps +
// premier temps, 100 /s). Remplace le décodeur de madmom (plus de 1,5 Go en
// production). Sur 4 morceaux : mêmes temps que madmom à 99-100 %.
//
// - Tempo : autocorrélation de l'activation entre 50 et 200 BPM ; parmi les
//   pics au moins à 80 % du plus fort, le plus rapide (le plus fort tombe
//   souvent sur la mesure entière) ; au-delà de 140 BPM, la moitié si elle
//   est bien marquée (balancement ternaire : le réseau marque aussi les
//   croches).
// - Temps : programmation dynamique (Ellis 2007), écart entre temps
//   pénalisé par -100 x log(écart / période)².
// Équivalent de tools/beats/rnn_dp.py (mis au point sur Mac).
//
// Sans dépendance à ExpoModulesCore : testable sur Mac (tools/beats).

import Foundation

public enum BeatTracker {
  public static let fps = 100
  static let minBpm = 50.0, maxBpm = 200.0
  static let peakRatio: Float = 0.8
  static let halveAbove = 140.0
  static let tightness: Float = 100

  /// Période des temps, en trames.
  public static func period(activation env: [Float]) -> Int {
    let n = env.count
    let mean = env.reduce(0, +) / Float(max(n, 1))
    let centered = env.map { $0 - mean }
    let minLag = Int(60.0 * Double(fps) / maxBpm), maxLag = Int(60.0 * Double(fps) / minBpm)
    let maxNeeded = min(n - 1, 2 * maxLag + 3)
    guard maxNeeded > minLag + 2 else { return max(minLag, 1) }
    var ac = [Float](repeating: 0, count: maxNeeded + 1)
    for lag in 0...maxNeeded {
      var s: Float = 0
      for i in lag..<n { s += centered[i] * centered[i - lag] }
      ac[lag] = s
    }
    let lags = Array(minLag...min(maxLag, maxNeeded))
    var peaks: [Int] = []
    if lags.count >= 3 {
      for k in 1..<(lags.count - 1) where ac[lags[k]] >= ac[lags[k - 1]] && ac[lags[k]] >= ac[lags[k + 1]] {
        peaks.append(k)
      }
    }
    guard var best = peaks.first else { return lags[lags.indices.max { ac[lags[$0]] < ac[lags[$1]] }!] }
    for k in peaks where ac[lags[k]] > ac[lags[best]] { best = k }
    let strong = peaks.filter { ac[lags[$0]] >= peakRatio * ac[lags[best]] }
    var lag = lags[strong.min()!]
    if 60.0 * Double(fps) / Double(lag) > halveAbove && 2 * lag + 3 <= maxNeeded {
      let w = 3
      var bestHalf = 2 * lag - w
      for l in (2 * lag - w)...(2 * lag + w) where ac[l] > ac[bestHalf] { bestHalf = l }
      if ac[bestHalf] >= 0.5 * ac[lag] { lag = bestHalf }
    }
    return lag
  }

  /// Indices (trames) des temps.
  public static func track(activation env: [Float], period: Int) -> [Int] {
    let n = env.count
    guard n > period, period > 1 else { return [] }
    var score = env
    var back = [Int](repeating: -1, count: n)
    let p = Float(period)
    for i in 0..<n {
      let lo = max(0, i - 2 * period), hi = i - period / 2
      guard hi > 0, lo < hi else { continue }
      var bestScore = -Float.infinity, bestJ = -1
      for j in lo..<hi {
        let l = logf(Float(i - j) / p)
        let s = score[j] - tightness * l * l
        if s > bestScore { bestScore = s; bestJ = j }
      }
      score[i] = env[i] + bestScore
      back[i] = bestJ
    }
    var i = n - period
    for k in (n - period)..<n where score[k] > score[i] { i = k }
    var beats: [Int] = []
    while i >= 0 { beats.append(i); i = back[i] }
    return beats.reversed()
  }
}
