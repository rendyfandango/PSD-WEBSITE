(function (global) {
  'use strict';

  var PSD = global.PSD = global.PSD || {};

  function beatStats(beats, expectedBpm) {
    var times = (beats && beats.times) || [];
    var intervals = (beats && beats.intervals) || [];
    var count = times.length;
    var mean = 0;
    for (var i = 0; i < intervals.length; i++) mean += intervals[i];
    mean /= Math.max(1, intervals.length);
    var variance = 0;
    for (var j = 0; j < intervals.length; j++) variance += (intervals[j] - mean) * (intervals[j] - mean);
    variance /= Math.max(1, intervals.length);
    var std = Math.sqrt(variance);
    var measured = mean > 0 ? 60 / mean : 0;
    var consistency = mean > 0 ? Math.max(0, 1 - std / mean) : 0;
    var bpmError = expectedBpm && measured ? Math.abs(measured - expectedBpm) : null;
    return {
      count: count,
      meanInterval: mean,
      stdInterval: std,
      measuredBpm: measured,
      consistency: consistency,
      expectedBpm: expectedBpm || null,
      bpmError: bpmError,
      firstBeat: count ? times[0] : null,
      lastBeat: count ? times[count - 1] : null
    };
  }

  function evaluateBeatDetection(detectedTimes, referenceTimes, tolerance) {
    tolerance = tolerance == null ? 0.07 : tolerance;
    var used = new Array(referenceTimes.length).fill(false);
    var truePositive = 0;
    for (var i = 0; i < detectedTimes.length; i++) {
      var best = -1;
      var bestDist = Infinity;
      for (var j = 0; j < referenceTimes.length; j++) {
        if (used[j]) continue;
        var d = Math.abs(detectedTimes[i] - referenceTimes[j]);
        if (d < bestDist) { bestDist = d; best = j; }
      }
      if (best >= 0 && bestDist <= tolerance) {
        used[best] = true;
        truePositive++;
      }
    }
    var precision = detectedTimes.length ? truePositive / detectedTimes.length : 0;
    var recall = referenceTimes.length ? truePositive / referenceTimes.length : 0;
    var f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
    return { precision: precision, recall: recall, f1: f1, truePositive: truePositive };
  }

  PSD.beatStats = beatStats;
  PSD.evaluateBeatDetection = evaluateBeatDetection;
})(typeof globalThis !== 'undefined' ? globalThis : this);
