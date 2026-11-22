(function (global) {
  'use strict';

  var PSD = global.PSD = global.PSD || {};
  var EPS = 1e-12;

  function nextPowerOfTwo(n) {
    var p = 1;
    n = Math.max(1, Math.ceil(n));
    while (p < n) p <<= 1;
    return p;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function db(value) {
    return 20 * Math.log10(Math.max(Math.abs(value), 1e-12));
  }

  function dbPower(value) {
    return 10 * Math.log10(Math.max(value, 1e-24));
  }

  function fromDb(value) {
    return Math.pow(10, value / 20);
  }

  function rms(signal, start, end) {
    start = start || 0;
    end = end == null ? signal.length : Math.min(end, signal.length);
    var sum = 0;
    for (var i = start; i < end; i++) sum += signal[i] * signal[i];
    var n = Math.max(1, end - start);
    return Math.sqrt(sum / n);
  }

  function peak(signal) {
    var m = 0;
    for (var i = 0; i < signal.length; i++) {
      var a = Math.abs(signal[i]);
      if (a > m) m = a;
    }
    return m;
  }

  function mean(signal) {
    var s = 0;
    for (var i = 0; i < signal.length; i++) s += signal[i];
    return s / Math.max(1, signal.length);
  }

  function removeMean(signal) {
    var m = mean(signal);
    var out = new Float64Array(signal.length);
    for (var i = 0; i < signal.length; i++) out[i] = signal[i] - m;
    return out;
  }

  function sinc(x) {
    if (Math.abs(x) < 1e-12) return 1;
    var px = Math.PI * x;
    return Math.sin(px) / px;
  }

  function besselI0(x) {
    var sum = 1;
    var term = 1;
    var half = x / 2;
    for (var k = 1; k < 64; k++) {
      term *= (half / k) * (half / k);
      sum += term;
      if (term < 1e-14 * sum) break;
    }
    return sum;
  }

  function windowValues(type, n, beta) {
    type = (type || 'hamming').toLowerCase();
    beta = beta == null ? 8.6 : beta;
    var w = new Float64Array(n);
    if (n <= 1) {
      w[0] = 1;
      return w;
    }
    var den = n - 1;
    for (var i = 0; i < n; i++) {
      var x = i / den;
      if (type === 'rect' || type === 'rectangular' || type === 'none') {
        w[i] = 1;
      } else if (type === 'hann' || type === 'hanning') {
        w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * x);
      } else if (type === 'hamming') {
        w[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * x);
      } else if (type === 'blackman') {
        w[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * x) + 0.08 * Math.cos(4 * Math.PI * x);
      } else if (type === 'blackman-harris') {
        w[i] = 0.35875 - 0.48829 * Math.cos(2 * Math.PI * x)
          + 0.14128 * Math.cos(4 * Math.PI * x) - 0.01168 * Math.cos(6 * Math.PI * x);
      } else if (type === 'kaiser') {
        var r = 2 * x - 1;
        w[i] = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / besselI0(beta);
      } else {
        w[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * x);
      }
    }
    return w;
  }

  function periodicWindow(type, n) {
    type = (type || 'hann').toLowerCase();
    var w = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      var x = i / n;
      if (type === 'hamming') w[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * x);
      else if (type === 'blackman') w[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * x) + 0.08 * Math.cos(4 * Math.PI * x);
      else if (type === 'rect' || type === 'none') w[i] = 1;
      else w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * x);
    }
    return w;
  }

  function convolveFull(x, h) {
    var nx = x.length;
    var nh = h.length;
    var y = new Float64Array(nx + nh - 1);
    for (var i = 0; i < nx; i++) {
      var xi = x[i];
      if (xi === 0) continue;
      for (var k = 0; k < nh; k++) y[i + k] += xi * h[k];
    }
    return y;
  }

  function movingAverage(signal, radius) {
    var n = signal.length;
    var out = new Float64Array(n);
    var prefix = new Float64Array(n + 1);
    for (var i = 0; i < n; i++) prefix[i + 1] = prefix[i] + signal[i];
    for (var j = 0; j < n; j++) {
      var a = Math.max(0, j - radius);
      var b = Math.min(n, j + radius + 1);
      out[j] = (prefix[b] - prefix[a]) / Math.max(1, b - a);
    }
    return out;
  }

  function normalize(signal, target) {
    target = target == null ? 1 : target;
    var m = 0;
    for (var i = 0; i < signal.length; i++) m = Math.max(m, Math.abs(signal[i]));
    if (m < EPS) return signal;
    var g = target / m;
    var out = new Float64Array(signal.length);
    for (var j = 0; j < signal.length; j++) out[j] = signal[j] * g;
    return out;
  }

  function resampleLinear(input, srcRate, dstRate) {
    if (srcRate === dstRate) return input;
    var ratio = dstRate / srcRate;
    var outLen = Math.max(1, Math.round(input.length * ratio));
    var out = new Float64Array(outLen);
    for (var i = 0; i < outLen; i++) {
      var pos = i / ratio;
      var i0 = Math.floor(pos);
      var i1 = Math.min(input.length - 1, i0 + 1);
      var t = pos - i0;
      out[i] = input[i0] * (1 - t) + input[i1] * t;
    }
    return out;
  }

  function formatDuration(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function formatHz(hz) {
    if (!isFinite(hz)) return '—';
    if (hz >= 1000) return (hz / 1000).toFixed(hz >= 10000 ? 1 : 2) + ' kHz';
    return Math.round(hz) + ' Hz';
  }

  function formatDb(value) {
    if (!isFinite(value)) return '—';
    return (value > 0 ? '+' : '') + value.toFixed(1) + ' dB';
  }

  function formatPercent(value) {
    return (value * 100).toFixed(1) + '%';
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  }

  function rafThrottle(fn) {
    var scheduled = false;
    return function () {
      var args = arguments;
      var self = this;
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        fn.apply(self, args);
      });
    };
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var C = {
    add: function (a, b) { return { re: a.re + b.re, im: a.im + b.im }; },
    sub: function (a, b) { return { re: a.re - b.re, im: a.im - b.im }; },
    mul: function (a, b) {
      return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
    },
    div: function (a, b) {
      var d = b.re * b.re + b.im * b.im;
      if (d < 1e-300) d = 1e-300;
      return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
    },
    scale: function (a, s) { return { re: a.re * s, im: a.im * s }; },
    conj: function (a) { return { re: a.re, im: -a.im }; },
    abs: function (a) { return Math.hypot(a.re, a.im); },
    arg: function (a) { return Math.atan2(a.im, a.re); },
    expj: function (theta) { return { re: Math.cos(theta), im: Math.sin(theta) }; },
    sqrt: function (a) {
      var r = Math.hypot(a.re, a.im);
      var re = Math.sqrt(Math.max(0, (r + a.re) / 2));
      var im = Math.sqrt(Math.max(0, (r - a.re) / 2));
      if (a.im < 0) im = -im;
      return { re: re, im: im };
    }
  };

  PSD.EPS = EPS;
  PSD.nextPowerOfTwo = nextPowerOfTwo;
  PSD.clamp = clamp;
  PSD.lerp = lerp;
  PSD.db = db;
  PSD.dbPower = dbPower;
  PSD.fromDb = fromDb;
  PSD.rms = rms;
  PSD.peak = peak;
  PSD.mean = mean;
  PSD.removeMean = removeMean;
  PSD.sinc = sinc;
  PSD.besselI0 = besselI0;
  PSD.windowValues = windowValues;
  PSD.periodicWindow = periodicWindow;
  PSD.convolveFull = convolveFull;
  PSD.movingAverage = movingAverage;
  PSD.normalize = normalize;
  PSD.resampleLinear = resampleLinear;
  PSD.formatDuration = formatDuration;
  PSD.formatHz = formatHz;
  PSD.formatDb = formatDb;
  PSD.formatPercent = formatPercent;
  PSD.debounce = debounce;
  PSD.rafThrottle = rafThrottle;
  PSD.mulberry32 = mulberry32;
  PSD.complex = C;
})(typeof globalThis !== 'undefined' ? globalThis : this);
