(function (global) {
  'use strict';

  var PSD = global.PSD = global.PSD || {};
  var EPS = 1e-12;

  function fft(re, im, inverse) {
    var n = re.length;
    if (n <= 1) return;
    if ((n & (n - 1)) !== 0) throw new Error('FFT length must be a power of two, got ' + n);

    for (var i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        var tr = re[i]; re[i] = re[j]; re[j] = tr;
        var ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }

    for (var len = 2; len <= n; len <<= 1) {
      var ang = (inverse ? 2 : -2) * Math.PI / len;
      var wlenRe = Math.cos(ang);
      var wlenIm = Math.sin(ang);
      var half = len >> 1;
      for (var start = 0; start < n; start += len) {
        var wRe = 1;
        var wIm = 0;
        for (var k = 0; k < half; k++) {
          var uRe = re[start + k];
          var uIm = im[start + k];
          var vRe = re[start + k + half] * wRe - im[start + k + half] * wIm;
          var vIm = re[start + k + half] * wIm + im[start + k + half] * wRe;
          re[start + k] = uRe + vRe;
          im[start + k] = uIm + vIm;
          re[start + k + half] = uRe - vRe;
          im[start + k + half] = uIm - vIm;
          var nextRe = wRe * wlenRe - wIm * wlenIm;
          wIm = wRe * wlenIm + wIm * wlenRe;
          wRe = nextRe;
        }
      }
    }

    if (inverse) {
      for (var z = 0; z < n; z++) {
        re[z] /= n;
        im[z] /= n;
      }
    }
  }

  function frameFFT(frame, windowType) {
    var n = PSD.nextPowerOfTwo(Math.max(2, frame.length));
    var re = new Float64Array(n);
    var im = new Float64Array(n);
    var w = PSD.periodicWindow(windowType || 'hann', frame.length);
    for (var i = 0; i < frame.length; i++) re[i] = frame[i] * w[i];
    fft(re, im, false);
    return { re: re, im: im, n: n };
  }

  function magnitudeSpectrum(frame, fs, opts) {
    opts = opts || {};
    var n = PSD.nextPowerOfTwo(Math.max(2, frame.length * (opts.zeroPad || 1)));
    var re = new Float64Array(n);
    var im = new Float64Array(n);
    var w = opts.window === null ? null : PSD.periodicWindow(opts.window || 'hann', frame.length);
    var mean = 0;
    if (opts.detrend !== false) {
      for (var m = 0; m < frame.length; m++) mean += frame[m];
      mean /= Math.max(1, frame.length);
    }
    var wsum = 0;
    for (var i = 0; i < frame.length; i++) {
      var wi = w ? w[i] : 1;
      re[i] = (frame[i] - mean) * wi;
      wsum += wi;
    }
    fft(re, im, false);
    var half = n >> 1;
    var freqs = new Float64Array(half + 1);
    var mag = new Float64Array(half + 1);
    var db = new Float64Array(half + 1);
    var scale = 2 / Math.max(EPS, wsum);
    for (var k = 0; k <= half; k++) {
      freqs[k] = k * fs / n;
      mag[k] = Math.hypot(re[k], im[k]) * scale;
      if (k === 0 || k === half) mag[k] *= 0.5;
      db[k] = 20 * Math.log10(Math.max(mag[k], 1e-9));
    }
    return { freqs: freqs, mag: mag, db: db, nfft: n, fs: fs };
  }

  function computeSpectrum(signal, fs, opts) {
    opts = opts || {};
    var start = opts.start || 0;
    var end = opts.end == null ? signal.length : Math.min(opts.end, signal.length);
    var seg = signal.subarray ? signal.subarray(start, end) : signal.slice(start, end);
    return magnitudeSpectrum(seg, fs, opts);
  }

  function welchSpectrum(signal, fs, opts) {
    opts = opts || {};
    var fftSize = PSD.nextPowerOfTwo(opts.fftSize || 4096);
    var hop = opts.hopSize || (fftSize >> 1);
    var windowType = opts.window || 'hann';
    var maxFrames = opts.maxFrames || 512;
    var totalFrames = Math.max(1, Math.floor((signal.length - fftSize) / hop) + 1);
    var stride = Math.max(1, Math.ceil(totalFrames / maxFrames));
    var w = PSD.periodicWindow(windowType, fftSize);
    var wsum = 0;
    for (var q = 0; q < fftSize; q++) wsum += w[q];
    var half = fftSize >> 1;
    var power = new Float64Array(half + 1);
    var used = 0;
    var globalMean = PSD.mean(signal);
    var re = new Float64Array(fftSize);
    var im = new Float64Array(fftSize);

    for (var f = 0; f < totalFrames; f += stride) {
      var offset = f * hop;
      if (offset + fftSize > signal.length) break;
      for (var i = 0; i < fftSize; i++) {
        re[i] = (signal[offset + i] - globalMean) * w[i];
        im[i] = 0;
      }
      fft(re, im, false);
      var scale = 2 / Math.max(EPS, wsum);
      for (var k = 0; k <= half; k++) {
        var mag = Math.hypot(re[k], im[k]) * scale;
        if (k === 0 || k === half) mag *= 0.5;
        power[k] += mag * mag;
      }
      used++;
    }
    if (used === 0) {
      var spec = magnitudeSpectrum(signal, fs, { window: windowType });
      return { freqs: spec.freqs, power: spec.mag.map(function (v) { return v * v; }), magDb: spec.db, frames: 1, fftSize: fftSize };
    }
    var freqs = new Float64Array(half + 1);
    var magDb = new Float64Array(half + 1);
    for (var j = 0; j <= half; j++) {
      power[j] /= used;
      freqs[j] = j * fs / fftSize;
      magDb[j] = 10 * Math.log10(Math.max(power[j], 1e-18));
    }
    return { freqs: freqs, power: power, magDb: magDb, frames: used, fftSize: fftSize };
  }

  function spectrogram(signal, fs, opts) {
    opts = opts || {};
    var fftSize = PSD.nextPowerOfTwo(opts.fftSize || 2048);
    var hop = opts.hopSize || (fftSize >> 1);
    var maxFrames = opts.maxFrames || 900;
    var windowType = opts.window || 'hann';
    var totalFrames = Math.max(1, Math.floor((signal.length - fftSize) / hop) + 1);
    var stride = Math.max(1, Math.ceil(totalFrames / maxFrames));
    var w = PSD.periodicWindow(windowType, fftSize);
    var half = fftSize >> 1;
    var re = new Float64Array(fftSize);
    var im = new Float64Array(fftSize);
    var frames = [];
    var times = [];
    var maxDb = -Infinity;
    var minDb = Infinity;

    for (var f = 0; f < totalFrames; f += stride) {
      var offset = f * hop;
      if (offset + fftSize > signal.length) break;
      for (var i = 0; i < fftSize; i++) { re[i] = signal[offset + i] * w[i]; im[i] = 0; }
      fft(re, im, false);
      var row = new Float32Array(half + 1);
      for (var k = 0; k <= half; k++) {
        var dbv = 10 * Math.log10(Math.max(re[k] * re[k] + im[k] * im[k], 1e-14));
        row[k] = dbv;
        if (dbv > maxDb) maxDb = dbv;
        if (dbv < minDb) minDb = dbv;
      }
      frames.push(row);
      times.push((offset + fftSize / 2) / fs);
    }
    if (!frames.length) {
      frames.push(new Float32Array(half + 1));
      times.push(0);
      maxDb = 0;
      minDb = -100;
    }
    var freqs = new Float64Array(half + 1);
    for (var j = 0; j <= half; j++) freqs[j] = j * fs / fftSize;
    return {
      frames: frames,
      times: times,
      freqs: freqs,
      fftSize: fftSize,
      hopSize: hop * stride,
      maxDb: maxDb,
      minDb: minDb
    };
  }

  function peakFrequency(freqs, mag, minHz, maxHz) {
    minHz = minHz == null ? 0 : minHz;
    maxHz = maxHz == null ? Infinity : maxHz;
    var best = -1;
    var bestVal = -Infinity;
    for (var i = 0; i < mag.length; i++) {
      if (freqs[i] < minHz || freqs[i] > maxHz) continue;
      if (mag[i] > bestVal) { bestVal = mag[i]; best = i; }
    }
    return best >= 0 ? freqs[best] : 0;
  }

  PSD.fft = fft;
  PSD.frameFFT = frameFFT;
  PSD.magnitudeSpectrum = magnitudeSpectrum;
  PSD.computeSpectrum = computeSpectrum;
  PSD.welchSpectrum = welchSpectrum;
  PSD.spectrogram = spectrogram;
  PSD.peakFrequency = peakFrequency;
})(typeof globalThis !== 'undefined' ? globalThis : this);
