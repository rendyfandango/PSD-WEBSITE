(function (global) {
  'use strict';

  var PSD = global.PSD = global.PSD || {};
  var EPS = 1e-12;

  var DEFAULT_BANDS = [
    { name: 'Bass', low: 20, high: 250, color: '#38bdf8' },
    { name: 'Mid', low: 250, high: 4000, color: '#2dd4bf' },
    { name: 'Treble', low: 4000, high: 20000, color: '#fbbf24' }
  ];

  function bandPower(freqs, power, low, high) {
    var sum = 0;
    for (var i = 0; i < freqs.length; i++) {
      if (freqs[i] >= low && freqs[i] <= high) sum += power[i];
    }
    return sum;
  }

  function analyzeEnergy(signal, fs, options) {
    options = options || {};
    var spectrum = options.spectrum || PSD.welchSpectrum(signal, fs, {
      fftSize: options.fftSize || 4096,
      hopSize: options.hopSize || 2048,
      window: options.window || 'hann',
      maxFrames: options.maxFrames || 512
    });
    var nyquist = fs / 2;
    var bands = (options.bands || DEFAULT_BANDS).map(function (b) {
      return {
        name: b.name,
        low: b.low,
        high: Math.min(b.high, nyquist),
        color: b.color || '#38bdf8',
        energy: bandPower(spectrum.freqs, spectrum.power, b.low, Math.min(b.high, nyquist))
      };
    });
    var total = 0;
    for (var i = 0; i < spectrum.freqs.length; i++) {
      if (spectrum.freqs[i] >= 20 && spectrum.freqs[i] <= nyquist) total += spectrum.power[i];
    }
    for (var b = 0; b < bands.length; b++) {
      bands[b].percent = total > EPS ? bands[b].energy / total : 0;
      bands[b].db = 10 * Math.log10(Math.max(bands[b].energy, 1e-18));
    }

    var linearMag = new Float64Array(spectrum.power.length);
    var magSum = 0;
    var weighted = 0;
    for (var k = 0; k < spectrum.power.length; k++) {
      linearMag[k] = Math.sqrt(Math.max(0, spectrum.power[k]));
      var f = spectrum.freqs[k];
      if (f >= 20) {
        magSum += linearMag[k];
        weighted += f * linearMag[k];
      }
    }
    var centroid = magSum > EPS ? weighted / magSum : 0;
    var target = 0.85 * magSum;
    var accum = 0;
    var rolloff = 0;
    for (var r = 0; r < spectrum.freqs.length; r++) {
      if (spectrum.freqs[r] < 20) continue;
      accum += linearMag[r];
      if (accum >= target) { rolloff = spectrum.freqs[r]; break; }
    }

    var frameSize = PSD.nextPowerOfTwo(options.rmsFrameSize || 2048);
    var hop = options.rmsHopSize || (frameSize >> 1);
    var frameRms = [];
    var frameTimes = [];
    for (var off = 0; off + frameSize <= signal.length; off += hop) {
      frameRms.push(PSD.rms(signal, off, off + frameSize));
      frameTimes.push((off + frameSize / 2) / fs);
    }
    if (!frameRms.length) {
      frameRms.push(PSD.rms(signal));
      frameTimes.push(signal.length / Math.max(1, fs) / 2);
    }

    var overallRms = PSD.rms(signal);
    var peak = PSD.peak(signal);
    var zc = 0;
    for (var z = 1; z < signal.length; z++) {
      if ((signal[z - 1] < 0 && signal[z] >= 0) || (signal[z - 1] >= 0 && signal[z] < 0)) zc++;
    }

    return {
      spectrum: spectrum,
      bands: bands,
      totalBandPower: total,
      rms: overallRms,
      rmsDb: 20 * Math.log10(Math.max(overallRms, 1e-9)),
      peak: peak,
      crestFactor: overallRms > EPS ? peak / overallRms : 0,
      centroid: centroid,
      rolloff: rolloff,
      dominant: PSD.peakFrequency(spectrum.freqs, linearMag, 20, nyquist),
      zeroCrossingRate: zc / Math.max(1, signal.length - 1),
      frameRms: frameRms,
      frameTimes: frameTimes,
      frameSize: frameSize,
      hopSize: hop
    };
  }

  PSD.DEFAULT_BANDS = DEFAULT_BANDS;
  PSD.bandPower = bandPower;
  PSD.analyzeEnergy = analyzeEnergy;
})(typeof globalThis !== 'undefined' ? globalThis : this);
