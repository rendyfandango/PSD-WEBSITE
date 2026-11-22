(function (global) {
  'use strict';

  var PSD = global.PSD = global.PSD || {};
  var EPS = 1e-12;

  function onsetEnvelope(signal, fs, options) {
    options = options || {};
    var frameSize = PSD.nextPowerOfTwo(options.frameSize || 1024);
    var hopSize = Math.max(1, options.hopSize || (frameSize >> 1));
    var maxFrames = options.maxFrames || 6000;
    var w = PSD.periodicWindow('hann', frameSize);
    var half = frameSize >> 1;
    var re = new Float64Array(frameSize);
    var im = new Float64Array(frameSize);
    var prev = null;
    var raw = [];
    var times = [];
    var mean = PSD.mean(signal);
    var totalFrames = Math.max(1, Math.floor((signal.length - frameSize) / hopSize) + 1);
    if (totalFrames > maxFrames) {
      hopSize = Math.ceil((signal.length - frameSize) / (maxFrames - 1));
      totalFrames = Math.max(1, Math.floor((signal.length - frameSize) / hopSize) + 1);
    }

    for (var frame = 0; frame < totalFrames; frame++) {
      var offset = frame * hopSize;
      for (var i = 0; i < frameSize; i++) {
        re[i] = (signal[offset + i] - mean) * w[i];
        im[i] = 0;
      }
      PSD.fft(re, im, false);
      var mag = new Float64Array(half + 1);
      for (var k = 1; k <= half; k++) {
        mag[k] = Math.log1p(30 * Math.hypot(re[k], im[k]));
      }
      var flux = 0;
      if (prev) {
        for (var j = 1; j <= half; j++) {
          var d = mag[j] - prev[j];
          if (d > 0) flux += d;
        }
        flux /= half;
      }
      raw.push(flux);
      times.push((offset + frameSize / 2) / fs);
      prev = mag;
    }

    var arr = new Float64Array(raw.length);
    for (var r = 0; r < raw.length; r++) arr[r] = raw[r];
    var localMean = PSD.movingAverage(arr, Math.max(2, Math.round(0.45 * fs / hopSize)));
    var rectified = new Float64Array(arr.length);
    for (var q = 0; q < arr.length; q++) {
      rectified[q] = Math.max(0, arr[q] - localMean[q]);
    }
    var smoothed = PSD.movingAverage(rectified, 1);
    var maxVal = 0;
    for (var m = 0; m < smoothed.length; m++) if (smoothed[m] > maxVal) maxVal = smoothed[m];
    if (maxVal > EPS) {
      for (var p = 0; p < smoothed.length; p++) smoothed[p] /= maxVal;
    }
    return {
      envelope: smoothed,
      rawFlux: arr,
      times: times,
      frameSize: frameSize,
      hopSize: hopSize,
      fs: fs,
      frameRate: fs / hopSize
    };
  }

  function autocorrelation(env, maxLag) {
    var n = env.length;
    var r = new Float64Array(maxLag + 1);
    var sum = 0;
    var mean = 0;
    for (var i = 0; i < n; i++) mean += env[i];
    mean /= Math.max(1, n);
    var centered = new Float64Array(n);
    for (var c = 0; c < n; c++) { centered[c] = env[c] - mean; sum += centered[c] * centered[c]; }
    if (sum < EPS) return r;
    for (var lag = 0; lag <= maxLag; lag++) {
      var acc = 0;
      for (var j = lag; j < n; j++) acc += centered[j] * centered[j - lag];
      r[lag] = acc / Math.max(1, n - lag);
    }
    var zero = r[0];
    for (var k = 0; k <= maxLag; k++) r[k] /= Math.max(EPS, zero);
    return r;
  }

  function acfAt(r, lag) {
    if (lag <= 0) return 0;
    if (lag >= r.length - 1) return 0;
    var i0 = Math.floor(lag);
    var t = lag - i0;
    return r[i0] * (1 - t) + r[i0 + 1] * t;
  }

  function refineLag(r, lag) {
    var m = Math.round(lag);
    if (m < 1 || m >= r.length - 1) return lag;
    var a = r[m - 1];
    var b = r[m];
    var c = r[m + 1];
    var den = a - 2 * b + c;
    if (Math.abs(den) < 1e-9) return m;
    var delta = 0.5 * (a - c) / den;
    if (delta > 1) delta = 1;
    if (delta < -1) delta = -1;
    return m + delta;
  }

  function tempoPrior(bpm) {
    var ratio = Math.log2(bpm / 120);
    return Math.exp(-0.5 * (ratio / 0.95) * (ratio / 0.95));
  }

  function estimateBPM(signal, fs, options) {
    options = options || {};
    var envData = options.envelopeData || onsetEnvelope(signal, fs, options);
    var env = envData.envelope;
    var hop = envData.hopSize;
    var minBpm = options.minBpm || 60;
    var maxBpm = options.maxBpm || 200;
    var maxLag = Math.min(env.length - 2, Math.ceil(60 * fs / (Math.max(20, minBpm * 0.85) * hop)));
    var acf = autocorrelation(env, maxLag);

    var best = { bpm: 120, lag: 0, score: -Infinity };
    var candidates = [];
    for (var bpm = minBpm; bpm <= maxBpm; bpm += 0.25) {
      var lag = 60 * fs / (bpm * hop);
      if (lag < 1.5 || lag > maxLag) continue;
      var score = acfAt(acf, lag)
        + 0.5 * acfAt(acf, 2 * lag)
        + 0.25 * acfAt(acf, 3 * lag)
        + 0.12 * acfAt(acf, 4 * lag);
      score *= 0.55 + 0.45 * tempoPrior(bpm);
      candidates.push({ bpm: bpm, lag: lag, score: score });
      if (score > best.score) best = { bpm: bpm, lag: lag, score: score };
    }

    if (!candidates.length) {
      return { bpm: 0, confidence: 0, acf: acf, envelopeData: envData, candidates: [] };
    }

    var refinedLag = refineLag(acf, best.lag);
    var refinedBpm = 60 * fs / (refinedLag * hop);
    var meanScore = 0;
    for (var s = 0; s < candidates.length; s++) meanScore += candidates[s].score;
    meanScore /= candidates.length;
    var confidence = PSD.clamp((best.score - meanScore) / (Math.abs(best.score) + EPS), 0, 1);
    confidence = PSD.clamp(0.55 * confidence + 0.45 * PSD.clamp(acfAt(acf, best.lag), 0, 1), 0, 1);

    var foldedBpm = refinedBpm;
    var foldRatio = 1;
    while (foldedBpm > 160 && foldedBpm / 2 >= 60) {
      foldedBpm /= 2;
      foldRatio *= 0.5;
    }
    if (foldRatio !== 1) confidence = PSD.clamp(confidence * 0.88, 0, 1);

    return {
      bpm: foldedBpm,
      bpmRounded: Math.round(foldedBpm * 10) / 10,
      rawBpm: refinedBpm,
      folded: foldRatio !== 1,
      foldRatio: foldRatio,
      bpmHalf: foldedBpm / 2,
      bpmDouble: foldedBpm * 2,
      lagFrames: foldedBpm === refinedBpm ? refinedLag : refinedLag / foldRatio,
      confidence: confidence,
      acf: acf,
      envelopeData: envData,
      hopSize: hop,
      frameSize: envData.frameSize,
      candidates: candidates
    };
  }

  function detectBeats(signal, fs, bpm, options) {
    options = options || {};
    var envData = options.envelopeData || onsetEnvelope(signal, fs, options);
    var env = envData.envelope;
    var hop = envData.hopSize;
    if (!bpm || !isFinite(bpm) || bpm <= 0) return { times: [], frames: [], count: 0, intervals: [], meanInterval: 0, bpmMeasured: 0 };
    var period = 60 * fs / (bpm * hop);
    if (period < 2) return { times: [], frames: [], count: 0, intervals: [], meanInterval: 0, bpmMeasured: 0 };

    var nOffsets = Math.max(1, Math.round(period));
    var bestOffset = 0;
    var bestScore = -Infinity;
    for (var offset = 0; offset < nOffsets; offset++) {
      var score = 0;
      for (var pos = offset; pos < env.length; pos += period) {
        var idx = Math.round(pos);
        if (idx < env.length) score += env[idx];
      }
      if (score > bestScore) { bestScore = score; bestOffset = offset; }
    }

    var frames = [];
    var radius = Math.max(1, Math.round(period * 0.1));
    for (var p = bestOffset; p < env.length; p += period) {
      var center = Math.round(p);
      var localBest = center;
      var localVal = -Infinity;
      for (var q = Math.max(0, center - radius); q <= Math.min(env.length - 1, center + radius); q++) {
        if (env[q] > localVal) { localVal = env[q]; localBest = q; }
      }
      if (!frames.length || localBest > frames[frames.length - 1] + 1) frames.push(localBest);
    }

    var times = frames.map(function (f) { return (f * hop + envData.frameSize / 2) / fs; });
    var intervals = [];
    for (var i = 1; i < times.length; i++) intervals.push(times[i] - times[i - 1]);
    var meanInterval = 0;
    for (var j = 0; j < intervals.length; j++) meanInterval += intervals[j];
    meanInterval /= Math.max(1, intervals.length);
    return {
      times: times,
      frames: frames,
      count: times.length,
      intervals: intervals,
      meanInterval: meanInterval,
      bpmMeasured: meanInterval > 0 ? 60 / meanInterval : 0,
      envelopeData: envData
    };
  }

  function tempoCategory(bpm) {
    if (!bpm || !isFinite(bpm)) return '—';
    if (bpm < 60) return 'Largo';
    if (bpm < 76) return 'Adagio';
    if (bpm < 108) return 'Andante';
    if (bpm < 120) return 'Moderato';
    if (bpm < 156) return 'Allegro';
    if (bpm < 176) return 'Vivace';
    return 'Presto';
  }

  PSD.onsetEnvelope = onsetEnvelope;
  PSD.autocorrelation = autocorrelation;
  PSD.refineLag = refineLag;
  PSD.estimateBPM = estimateBPM;
  PSD.detectBeats = detectBeats;
  PSD.tempoCategory = tempoCategory;
})(typeof globalThis !== 'undefined' ? globalThis : this);
