(function (global) {
  'use strict';

  var PSD = global.PSD = global.PSD || {};
  var EPS = 1e-12;

  function normalizeType(type) {
    var t = String(type || 'lowpass').toLowerCase();
    if (t === 'lp' || t === 'low' || t === 'low-pass') return 'lowpass';
    if (t === 'hp' || t === 'high' || t === 'high-pass') return 'highpass';
    if (t === 'bp' || t === 'band' || t === 'band-pass' || t === 'bandpass') return 'bandpass';
    return t;
  }

  function responseAt(coeffs, omega) {
    var re = 0;
    var im = 0;
    for (var n = 0; n < coeffs.length; n++) {
      re += coeffs[n] * Math.cos(omega * n);
      im -= coeffs[n] * Math.sin(omega * n);
    }
    return Math.hypot(re, im);
  }

  function designFIR(options) {
    options = options || {};
    var fs = options.fs || 44100;
    var type = normalizeType(options.type);
    var taps = Math.round(options.numTaps || options.taps || 101);
    taps = Math.max(3, taps);
    if (taps % 2 === 0) taps += 1;
    var windowType = options.window || 'hamming';
    var beta = options.beta == null ? 8.6 : options.beta;
    var cutoff = options.cutoff == null ? 1000 : options.cutoff;
    var cutoff2 = options.cutoff2 == null ? Math.min(fs / 2 - 1, cutoff * 4) : options.cutoff2;

    if (type === 'bandpass') {
      if (cutoff > cutoff2) { var tmp = cutoff; cutoff = cutoff2; cutoff2 = tmp; }
      cutoff = PSD.clamp(cutoff, 1, fs / 2 - 2);
      cutoff2 = PSD.clamp(cutoff2, cutoff + 1, fs / 2 - 1);
    } else {
      cutoff = PSD.clamp(cutoff, 1, fs / 2 - 1);
    }

    var M = (taps - 1) / 2;
    var w = PSD.windowValues(windowType, taps, beta);
    var h = new Float64Array(taps);
    var fc1 = 2 * cutoff / fs;
    var fc2 = 2 * cutoff2 / fs;
    var n;

    if (type === 'lowpass') {
      for (n = 0; n < taps; n++) {
        h[n] = fc1 * PSD.sinc(fc1 * (n - M)) * w[n];
      }
      var g0 = responseAt(h, 0);
      for (n = 0; n < taps; n++) h[n] /= Math.max(EPS, g0);
    } else if (type === 'highpass') {
      for (n = 0; n < taps; n++) {
        var ideal = (n === M ? 1 : 0) - fc1 * PSD.sinc(fc1 * (n - M));
        h[n] = ideal * w[n];
      }
      var gpi = responseAt(h, Math.PI);
      for (n = 0; n < taps; n++) h[n] /= Math.max(EPS, gpi);
    } else {
      for (n = 0; n < taps; n++) {
        h[n] = (fc2 * PSD.sinc(fc2 * (n - M)) - fc1 * PSD.sinc(fc1 * (n - M))) * w[n];
      }
      var center = Math.sqrt(cutoff * cutoff2);
      var gc = responseAt(h, 2 * Math.PI * center / fs);
      for (n = 0; n < taps; n++) h[n] /= Math.max(EPS, gc);
    }

    return {
      engine: 'fir',
      type: type,
      fs: fs,
      numTaps: taps,
      order: taps - 1,
      window: windowType,
      beta: beta,
      cutoff: cutoff,
      cutoff2: cutoff2,
      groupDelaySamples: M,
      coeffs: h
    };
  }

  function unwrapPhase(phase) {
    var out = new Float64Array(phase.length);
    var offset = 0;
    out[0] = phase[0];
    for (var i = 1; i < phase.length; i++) {
      var d = phase[i] - phase[i - 1];
      while (d > Math.PI) { d -= 2 * Math.PI; offset -= 2 * Math.PI; }
      while (d < -Math.PI) { d += 2 * Math.PI; offset += 2 * Math.PI; }
      out[i] = phase[i] + offset;
    }
    return out;
  }

  function frequencyResponse(coeffs, fs, nPoints) {
    nPoints = nPoints || 1024;
    var freqs = new Float64Array(nPoints + 1);
    var mag = new Float64Array(nPoints + 1);
    var magDb = new Float64Array(nPoints + 1);
    var phase = new Float64Array(nPoints + 1);
    for (var k = 0; k <= nPoints; k++) {
      var omega = Math.PI * k / nPoints;
      var re = 0;
      var im = 0;
      for (var n = 0; n < coeffs.length; n++) {
        re += coeffs[n] * Math.cos(omega * n);
        im -= coeffs[n] * Math.sin(omega * n);
      }
      freqs[k] = fs * 0.5 * k / nPoints;
      mag[k] = Math.hypot(re, im);
      magDb[k] = 20 * Math.log10(Math.max(mag[k], 1e-12));
      phase[k] = Math.atan2(im, re);
    }
    var unwrapped = unwrapPhase(phase);
    var gd = new Float64Array(nPoints + 1);
    var dw = Math.PI / nPoints;
    for (var j = 0; j <= nPoints; j++) {
      var a = Math.max(0, j - 1);
      var b = Math.min(nPoints, j + 1);
      gd[j] = -(unwrapped[b] - unwrapped[a]) / (dw * (b - a));
    }
    return { freqs: freqs, mag: mag, magDb: magDb, phase: phase, unwrappedPhase: unwrapped, groupDelay: gd, fs: fs };
  }

  function applyFIR(signal, coeffs, options) {
    options = options || {};
    var full = PSD.convolveFull(signal, coeffs);
    var out = new Float32Array(signal.length);
    var compensate = options.compensateDelay !== false;
    var delay = compensate ? (coeffs.length - 1) >> 1 : 0;
    for (var i = 0; i < signal.length; i++) {
      var j = i + delay;
      out[i] = j < full.length ? full[j] : 0;
    }
    return out;
  }

  function groupDelayAt(coeffs, fs, freqHz) {
    return (coeffs.length - 1) / 2;
  }

  function estimateOps(coeffs) {
    var mults = 0;
    for (var i = 0; i < coeffs.length; i++) if (Math.abs(coeffs[i]) > 1e-14) mults++;
    return {
      taps: coeffs.length,
      multiplications: mults,
      additions: Math.max(0, mults - 1),
      total: mults + Math.max(0, mults - 1)
    };
  }

  function analyzeResponse(resp, spec) {
    spec = spec || {};
    var passband = spec.passband || [0, resp.fs / 2];
    var stopbands = spec.stopbands || [];
    var passMin = Infinity;
    var passMax = -Infinity;
    for (var i = 0; i < resp.freqs.length; i++) {
      var f = resp.freqs[i];
      if (f >= passband[0] && f <= passband[1]) {
        if (resp.magDb[i] < passMin) passMin = resp.magDb[i];
        if (resp.magDb[i] > passMax) passMax = resp.magDb[i];
      }
    }
    var stopMax = -Infinity;
    for (var s = 0; s < stopbands.length; s++) {
      var band = stopbands[s];
      for (var j = 0; j < resp.freqs.length; j++) {
        if (resp.freqs[j] >= band[0] && resp.freqs[j] <= band[1]) {
          if (resp.magDb[j] > stopMax) stopMax = resp.magDb[j];
        }
      }
    }
    return {
      passbandRippleDb: isFinite(passMax) ? passMax - passMin : NaN,
      passbandDeviationDb: isFinite(passMax) ? Math.max(Math.abs(passMax), Math.abs(passMin)) : NaN,
      stopbandAttenuationDb: isFinite(stopMax) ? -stopMax : NaN
    };
  }

  PSD.normalizeFilterType = normalizeType;
  PSD.designFIR = designFIR;
  PSD.applyFIR = applyFIR;
  PSD.firResponseAt = responseAt;
  PSD.firFrequencyResponse = frequencyResponse;
  PSD.firGroupDelayAt = groupDelayAt;
  PSD.firEstimateOps = estimateOps;
  PSD.analyzeFilterResponse = analyzeResponse;
  PSD.unwrapPhase = unwrapPhase;
})(typeof globalThis !== 'undefined' ? globalThis : this);
