(function (global) {
  'use strict';

  var PSD = global.PSD = global.PSD || {};

  function toMono(audioBuffer) {
    var channels = audioBuffer.numberOfChannels;
    var length = audioBuffer.length;
    var out = new Float32Array(length);
    if (channels === 1) {
      out.set(audioBuffer.getChannelData(0));
      return out;
    }
    var data = [];
    for (var c = 0; c < channels; c++) data.push(audioBuffer.getChannelData(c));
    for (var i = 0; i < length; i++) {
      var sum = 0;
      for (var ch = 0; ch < channels; ch++) sum += data[ch][i];
      out[i] = sum / channels;
    }
    return out;
  }

  async function decodeAudioUrl(url, audioContext) {
    var response = await fetch(url);
    if (!response.ok) throw new Error('Gagal memuat audio: ' + response.status + ' ' + url);
    var arrayBuffer = await response.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var promise = audioContext.decodeAudioData(arrayBuffer, resolve, reject);
      if (promise && promise.then) promise.then(resolve).catch(reject);
    });
  }

  function createContext() {
    var Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) throw new Error('Browser ini tidak mendukung Web Audio API');
    try {
      return new Ctx({ sampleRate: 44100 });
    } catch (e) {
      return new Ctx();
    }
  }

  function buildFilter(config) {
    config = config || {};
    var fs = config.fs || 44100;
    if ((config.engine || 'fir').toLowerCase() === 'iir') {
      return PSD.designIIR({
        type: config.type || 'lowpass',
        order: config.order || 4,
        cutoff: config.cutoff,
        cutoff2: config.cutoff2,
        fs: fs
      });
    }
    return PSD.designFIR({
      type: config.type || 'lowpass',
      numTaps: config.numTaps || config.taps || 101,
      window: config.window || 'hamming',
      beta: config.beta,
      cutoff: config.cutoff,
      cutoff2: config.cutoff2,
      fs: fs
    });
  }

  function applyFilter(signal, config, options) {
    options = options || {};
    var design = options.design || buildFilter(config);
    var t0 = (global.performance && global.performance.now) ? global.performance.now() : Date.now();
    var output;
    var delaySamples;
    if (design.engine === 'fir') {
      output = PSD.applyFIR(signal, design.coeffs, { compensateDelay: options.compensate !== false });
      delaySamples = design.groupDelaySamples;
    } else {
      delaySamples = Math.round(design.groupDelaySamples || 0);
      output = PSD.applyIIR(signal, design.sections, {
        compensateDelay: options.compensate !== false,
        delaySamples: delaySamples
      });
    }
    var t1 = (global.performance && global.performance.now) ? global.performance.now() : Date.now();
    var ops = design.engine === 'fir' ? PSD.firEstimateOps(design.coeffs) : PSD.iirEstimateOps(design.sections);
    return {
      signal: output,
      design: design,
      processingMs: t1 - t0,
      ops: ops,
      delaySamples: delaySamples
    };
  }

  function filterResponse(design, nPoints) {
    if (design.engine === 'fir') return PSD.firFrequencyResponse(design.coeffs, design.fs, nPoints || 1024);
    return PSD.iirFrequencyResponse(design.sections, design.fs, nPoints || 1024);
  }

  function analyzeSignal(signal, fs, options) {
    options = options || {};
    var t0 = (global.performance && global.performance.now) ? global.performance.now() : Date.now();
    var spectrum = PSD.welchSpectrum(signal, fs, {
      fftSize: options.fftSize || 4096,
      hopSize: options.hopSize || 2048,
      window: 'hann',
      maxFrames: options.maxFrames || 512
    });
    var energy = PSD.analyzeEnergy(signal, fs, { spectrum: spectrum });
    var tempo = options.tempo === false ? null : PSD.estimateBPM(signal, fs, {
      frameSize: options.bpmFrameSize || 1024,
      hopSize: options.bpmHopSize || 512
    });
    var beats = null;
    if (tempo && tempo.bpm > 0) {
      beats = PSD.detectBeats(signal, fs, tempo.bpm, { envelopeData: tempo.envelopeData });
    }
    var beatInfo = PSD.beatStats(beats, options.refBpm);
    var spec = options.spectrogram === false ? null : PSD.spectrogram(signal, fs, {
      fftSize: options.specFftSize || 2048,
      hopSize: options.specHopSize || 1024,
      maxFrames: options.specMaxFrames || 900
    });
    var t1 = (global.performance && global.performance.now) ? global.performance.now() : Date.now();
    return {
      signal: signal,
      fs: fs,
      duration: signal.length / fs,
      spectrum: spectrum,
      energy: energy,
      tempo: tempo,
      beats: beats,
      beatStats: beatInfo,
      spectrogram: spec,
      elapsedMs: t1 - t0
    };
  }

  function createAudioBuffer(audioContext, signal, sampleRate) {
    var data = signal;
    if (sampleRate && Math.abs(sampleRate - audioContext.sampleRate) > 0.5) {
      data = PSD.resampleLinear(signal, sampleRate, audioContext.sampleRate);
    }
    var buffer = audioContext.createBuffer(1, data.length, audioContext.sampleRate);
    var channel = buffer.getChannelData(0);
    channel.set(data);
    return buffer;
  }

  function signalToWavBlob(signal, sampleRate) {
    var length = signal.length;
    var buffer = new ArrayBuffer(44 + length * 2);
    var view = new DataView(buffer);
    function text(offset, value) {
      for (var i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    }
    text(0, 'RIFF');
    view.setUint32(4, 36 + length * 2, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, length * 2, true);
    var fade = Math.min(Math.round(sampleRate * 0.012), length >> 1);
    for (var i = 0; i < length; i++) {
      var value = signal[i];
      if (value > 1) value = 1;
      else if (value < -1) value = -1;
      if (fade > 0) {
        if (i < fade) value *= i / fade;
        else if (i >= length - fade) value *= (length - 1 - i) / fade;
      }
      view.setInt16(44 + i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  function playSignal(audioContext, signal, sampleRate, options) {
    options = options || {};
    var buffer = createAudioBuffer(audioContext, signal, sampleRate);
    var source = audioContext.createBufferSource();
    source.buffer = buffer;
    var gain = audioContext.createGain();
    gain.gain.value = options.volume == null ? 0.85 : options.volume;
    source.connect(gain).connect(audioContext.destination);
    if (options.onended) source.onended = options.onended;
    var start = function () {
      try { source.start(0); } catch (e) {}
    };
    if (audioContext.state === 'suspended' && audioContext.resume) {
      audioContext.resume().then(start, start);
    } else {
      start();
    }
    return { source: source, gain: gain, buffer: buffer, duration: buffer.duration };
  }

  function generateTestSignal(fs, components, duration) {
    components = components || [
      { freq: 100, amp: 0.6 },
      { freq: 1000, amp: 0.5 },
      { freq: 5000, amp: 0.4 }
    ];
    duration = duration || 2;
    var n = Math.floor(fs * duration);
    var out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var t = i / fs;
      var v = 0;
      for (var c = 0; c < components.length; c++) {
        v += components[c].amp * Math.sin(2 * Math.PI * components[c].freq * t);
      }
      var fade = Math.min(1, i / (0.02 * fs), (n - i) / (0.02 * fs));
      out[i] = PSD.clamp(v * fade, -1, 1) * 0.7;
    }
    return out;
  }

  PSD.toMono = toMono;
  PSD.decodeAudioUrl = decodeAudioUrl;
  PSD.createAudioContext = createContext;
  PSD.buildFilter = buildFilter;
  PSD.applyFilter = applyFilter;
  PSD.filterResponse = filterResponse;
  PSD.analyzeSignal = analyzeSignal;
  PSD.createAudioBuffer = createAudioBuffer;
  PSD.playSignal = playSignal;
  PSD.signalToWavBlob = signalToWavBlob;
  PSD.generateTestSignal = generateTestSignal;
})(typeof globalThis !== 'undefined' ? globalThis : this);
