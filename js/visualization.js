(function (global) {
  'use strict';

  var PSD = global.PSD = global.PSD || {};

  var COLORS = {
    bg: '#0b1222',
    panel: '#0f172a',
    grid: 'rgba(148, 163, 184, 0.13)',
    gridStrong: 'rgba(148, 163, 184, 0.24)',
    axis: '#64748b',
    text: '#94a3b8',
    textBright: '#e2e8f0',
    cyan: '#38bdf8',
    teal: '#2dd4bf',
    violet: '#a78bfa',
    amber: '#fbbf24',
    pink: '#f472b6',
    red: '#fb7185',
    green: '#4ade80',
    blue: '#60a5fa',
    orange: '#fb923c'
  };

  function setup(canvas, fallbackHeight) {
    if (!canvas) return null;
    var dpr = global.devicePixelRatio || 1;
    var w = Math.max(280, Math.floor(canvas.clientWidth || canvas.parentElement && canvas.parentElement.clientWidth || 800));
    var h = Math.max(150, Math.floor(canvas.clientHeight || parseFloat(canvas.dataset.height || '') || fallbackHeight || 260));
    var pw = Math.round(w * dpr);
    var ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h, dpr: dpr };
  }

  function niceTicks(min, max, count) {
    if (!isFinite(min) || !isFinite(max) || max <= min) return [min];
    var range = max - min;
    var rough = range / Math.max(2, count);
    var pow = Math.pow(10, Math.floor(Math.log10(rough)));
    var frac = rough / pow;
    var nice = frac <= 1 ? 1 : (frac <= 2 ? 2 : (frac <= 5 ? 5 : 10));
    var step = nice * pow;
    var start = Math.ceil(min / step) * step;
    var ticks = [];
    for (var v = start; v <= max + step * 1e-6; v += step) {
      ticks.push(Math.abs(v) < step * 1e-6 ? 0 : v);
      if (ticks.length > 40) break;
    }
    return ticks;
  }

  function defaultNumber(value, decimals) {
    if (!isFinite(value)) return '';
    var d = decimals == null ? (Math.abs(value) >= 100 ? 0 : (Math.abs(value) >= 10 ? 1 : 2)) : decimals;
    return value.toFixed(d);
  }

  function drawLegend(ctx, entries, x, y, w) {
    var row = 0;
    var col = 0;
    var colWidth = Math.max(100, Math.floor(w / Math.max(1, entries.length)));
    ctx.font = '11px "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var px = x + col * colWidth;
      var py = y + row * 17;
      ctx.strokeStyle = e.color;
      ctx.lineWidth = e.width || 2;
      ctx.setLineDash(e.dash || []);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + 16, py);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COLORS.text;
      ctx.fillText(e.label, px + 21, py);
      col++;
      if (col >= Math.max(1, Math.floor(w / colWidth))) { col = 0; row++; }
    }
  }

  function chartFrame(canvas, options) {
    options = options || {};
    var s = setup(canvas, options.height || 280);
    if (!s) return null;
    var pad = options.padding || { left: 58, right: 18, top: 38, bottom: 42 };
    return { s: s, pad: pad, plotW: s.w - pad.left - pad.right, plotH: s.h - pad.top - pad.bottom };
  }

  function drawGrid(ctx, pad, plotW, plotH, xTicks, yTicks, xMin, xMax, yMin, yMax, opts) {
    opts = opts || {};
    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    for (var i = 0; i < yTicks.length; i++) {
      var v = yTicks[i];
      var y = pad.top + plotH - (v - yMin) / (yMax - yMin) * plotH;
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = 'right';
      ctx.fillText((opts.yFormat || defaultNumber)(v), pad.left - 8, y);
    }
    for (var j = 0; j < xTicks.length; j++) {
      var xv = xTicks[j];
      var x = pad.left + (xv - xMin) / (xMax - xMin) * plotW;
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + plotH);
      ctx.stroke();
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText((opts.xFormat || defaultNumber)(xv), x, pad.top + plotH + 9);
    }
    ctx.strokeStyle = COLORS.gridStrong;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, pad.top + plotH);
    ctx.lineTo(pad.left + plotW, pad.top + plotH);
    ctx.stroke();
  }

  function drawLabels(ctx, s, pad, plotW, plotH, options) {
    ctx.font = '11px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = COLORS.text;
    ctx.textBaseline = 'alphabetic';
    if (options.xLabel) {
      ctx.textAlign = 'right';
      ctx.fillText(options.xLabel, pad.left + plotW, s.h - 6);
    }
    if (options.yLabel) {
      ctx.save();
      ctx.translate(13, pad.top + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText(options.yLabel, 0, 0);
      ctx.restore();
    }
    if (options.title) {
      ctx.fillStyle = COLORS.textBright;
      ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(options.title, pad.left, 13);
    }
  }

  function seriesBounds(series, options) {
    var xMin = options.xMin;
    var xMax = options.xMax;
    var yMin = options.yMin;
    var yMax = options.yMax;
    var trackXMin = xMin == null;
    var trackXMax = xMax == null;
    var trackYMin = yMin == null;
    var trackYMax = yMax == null;
    for (var i = 0; i < series.length; i++) {
      var sr = series[i];
      var xs = sr.x;
      var ys = sr.y;
      for (var j = 0; j < ys.length; j++) {
        var yy = ys[j];
        if (!isFinite(yy)) continue;
        var xx = xs ? xs[j] : j;
        if (trackYMin && (yMin == null || yy < yMin)) yMin = yy;
        if (trackYMax && (yMax == null || yy > yMax)) yMax = yy;
        if (trackXMin && (xMin == null || xx < xMin)) xMin = xx;
        if (trackXMax && (xMax == null || xx > xMax)) xMax = xx;
      }
    }
    if (xMin == null) xMin = 0;
    if (xMax == null) xMax = 1;
    if (yMin == null) yMin = -1;
    if (yMax == null) yMax = 1;
    if (xMax <= xMin) { xMax = xMin + 1; }
    if (yMax <= yMin) { yMax = yMin + 1; }
    return { xMin: xMin, xMax: xMax, yMin: yMin, yMax: yMax };
  }

  function drawSeries(ctx, sr, bounds, pad, plotW, plotH, mode) {
    var xs = sr.x;
    var ys = sr.y;
    var n = ys.length;
    if (!n) return;
    var xMin = bounds.xMin;
    var xMax = bounds.xMax;
    var yMin = bounds.yMin;
    var yMax = bounds.yMax;
    var color = sr.color || COLORS.cyan;
    var lineWidth = sr.width || 2;
    var xAt = function (x) { return pad.left + (x - xMin) / (xMax - xMin) * plotW; };
    var yAt = function (y) { return pad.top + plotH - (y - yMin) / (yMax - yMin) * plotH; };

    if (mode === 'envelope') {
      var bins = Math.max(1, Math.floor(plotW));
      var minArr = new Float64Array(bins).fill(Infinity);
      var maxArr = new Float64Array(bins).fill(-Infinity);
      for (var i = 0; i < n; i++) {
        var xv = xs ? xs[i] : i;
        var px = Math.floor((xv - xMin) / (xMax - xMin) * bins);
        if (px < 0 || px >= bins) continue;
        var yv = ys[i];
        if (yv < minArr[px]) minArr[px] = yv;
        if (yv > maxArr[px]) maxArr[px] = yv;
      }
      ctx.strokeStyle = color;
      ctx.globalAlpha = sr.alpha == null ? 0.85 : sr.alpha;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      for (var b = 0; b < bins; b++) {
        if (minArr[b] === Infinity) continue;
        var x1 = pad.left + b + 0.5;
        ctx.moveTo(x1, yAt(maxArr[b]));
        ctx.lineTo(x1, yAt(minArr[b]));
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(sr.dash || []);
    ctx.beginPath();
    var maxPoints = Math.max(400, plotW * 2);
    if (n <= maxPoints || !xs) {
      for (var p = 0; p < n; p++) {
        var yy = ys[p];
        if (!isFinite(yy)) continue;
        var xx = xs ? xs[p] : p;
        var xp = xAt(xx);
        var yp = yAt(yy);
        if (p === 0) ctx.moveTo(xp, yp); else ctx.lineTo(xp, yp);
      }
    } else {
      var bins2 = Math.max(1, Math.floor(plotW));
      var sums = new Float64Array(bins2);
      var counts = new Int32Array(bins2);
      for (var q = 0; q < n; q++) {
        var xq = xs ? xs[q] : q;
        var bq = Math.floor((xq - xMin) / (xMax - xMin) * bins2);
        if (bq < 0 || bq >= bins2) continue;
        sums[bq] += ys[q];
        counts[bq]++;
      }
      var first = true;
      for (var c = 0; c < bins2; c++) {
        if (!counts[c]) continue;
        var xp2 = pad.left + c + 0.5;
        var yp2 = yAt(sums[c] / counts[c]);
        if (first) { ctx.moveTo(xp2, yp2); first = false; }
        else ctx.lineTo(xp2, yp2);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);

    if (sr.fill) {
      ctx.fillStyle = sr.fill;
      ctx.beginPath();
      var baseY = yAt(PSD.clamp(0, yMin, yMax));
      var started = false;
      for (var f = 0; f < n; f++) {
        var fy = ys[f];
        if (!isFinite(fy)) continue;
        var fx = xAt(xs ? xs[f] : f);
        if (!started) { ctx.moveTo(fx, baseY); started = true; }
        ctx.lineTo(fx, yAt(fy));
      }
      if (started) {
        ctx.lineTo(xAt(xs ? xs[n - 1] : n - 1), baseY);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  function drawLineChart(canvas, series, options) {
    options = options || {};
    series = series || [];
    if (!series.length) { drawEmpty(canvas, options); return; }
    var frame = chartFrame(canvas, options);
    if (!frame) return;
    var ctx = frame.s.ctx;
    var pad = frame.pad;
    var plotW = frame.plotW;
    var plotH = frame.plotH;
    var bounds = seriesBounds(series, options);
    if (options.yPad !== false) {
      var yRange = bounds.yMax - bounds.yMin;
      if (options.yMin == null) bounds.yMin -= yRange * 0.06;
      if (options.yMax == null) bounds.yMax += yRange * 0.08;
    }
    if (options.xPad) {
      var xRange = bounds.xMax - bounds.xMin;
      bounds.xMin -= xRange * options.xPad;
      bounds.xMax += xRange * options.xPad;
    }
    var xTicks = options.xTicks || niceTicks(bounds.xMin, bounds.xMax, options.xTickCount || 6);
    var yTicks = options.yTicks || niceTicks(bounds.yMin, bounds.yMax, options.yTickCount || 5);
    if (Array.isArray(yTicks)) {
      var clipped = [];
      for (var i = 0; i < yTicks.length; i++) if (yTicks[i] >= bounds.yMin && yTicks[i] <= bounds.yMax) clipped.push(yTicks[i]);
      if (clipped.length) yTicks = clipped;
    }
    drawGrid(ctx, pad, plotW, plotH, xTicks, yTicks, bounds.xMin, bounds.xMax, bounds.yMin, bounds.yMax, options);

    if (options.hLines) {
      ctx.setLineDash([4, 4]);
      for (var h = 0; h < options.hLines.length; h++) {
        var hl = options.hLines[h];
        if (hl.y < bounds.yMin || hl.y > bounds.yMax) continue;
        var yy = pad.top + plotH - (hl.y - bounds.yMin) / (bounds.yMax - bounds.yMin) * plotH;
        ctx.strokeStyle = hl.color || COLORS.axis;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(pad.left + plotW, yy); ctx.stroke();
        if (hl.label) {
          ctx.fillStyle = hl.color || COLORS.text;
          ctx.font = '10px "Segoe UI", system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          ctx.fillText(hl.label, pad.left + 4, yy - 2);
        }
      }
      ctx.setLineDash([]);
    }

    for (var k = 0; k < series.length; k++) {
      drawSeries(ctx, series[k], bounds, pad, plotW, plotH, series[k].mode || options.mode || 'line');
    }

    if (options.markers) {
      ctx.setLineDash([4, 4]);
      for (var m = 0; m < options.markers.length; m++) {
        var marker = options.markers[m];
        if (marker.x < bounds.xMin || marker.x > bounds.xMax) continue;
        var mx = pad.left + (marker.x - bounds.xMin) / (bounds.xMax - bounds.xMin) * plotW;
        ctx.strokeStyle = marker.color || COLORS.orange;
        ctx.lineWidth = marker.width || 1;
        ctx.beginPath(); ctx.moveTo(mx, pad.top); ctx.lineTo(mx, pad.top + plotH); ctx.stroke();
        if (marker.label) {
          ctx.fillStyle = marker.color || COLORS.orange;
          ctx.font = '10px "Segoe UI", system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(marker.label, mx + 3, pad.top + 3);
        }
      }
      ctx.setLineDash([]);
    }

    drawLabels(ctx, frame.s, pad, plotW, plotH, options);
    if (options.legend !== false) {
      var entries = series.filter(function (sr) { return sr.label; }).map(function (sr) {
        return { label: sr.label, color: sr.color || COLORS.cyan, dash: sr.dash, width: sr.width };
      });
      if (entries.length) drawLegend(ctx, entries, pad.left, 27, plotW);
    }
    return { ctx: ctx, bounds: bounds, pad: pad, plotW: plotW, plotH: plotH, w: frame.s.w, h: frame.s.h };
  }

  function drawEmpty(canvas, options) {
    var s = setup(canvas, (options && options.height) || 260);
    if (!s) return;
    s.ctx.fillStyle = COLORS.text;
    s.ctx.font = '13px "Segoe UI", system-ui, sans-serif';
    s.ctx.textAlign = 'center';
    s.ctx.textBaseline = 'middle';
    s.ctx.fillText((options && options.emptyText) || 'Belum ada data', s.w / 2, s.h / 2);
  }

  function drawWaveform(canvas, signal, fs, options) {
    options = options || {};
    if (!signal || !signal.length) { drawEmpty(canvas, options); return; }
    var startSec = options.start || 0;
    var endSec = options.end == null ? signal.length / fs : Math.min(options.end, signal.length / fs);
    var start = Math.max(0, Math.floor(startSec * fs));
    var end = Math.min(signal.length, Math.ceil(endSec * fs));
    var frame = chartFrame(canvas, options);
    if (!frame) return;
    var ctx = frame.s.ctx;
    var pad = frame.pad;
    var plotW = frame.plotW;
    var plotH = frame.plotH;
    var maxAbs = 0;
    for (var i = start; i < end; i++) {
      var a = Math.abs(signal[i]);
      if (a > maxAbs) maxAbs = a;
    }
    maxAbs = Math.max(maxAbs, 0.001) * 1.12;
    var xMin = startSec;
    var xMax = endSec;
    var xAt = function (t) { return pad.left + (t - xMin) / Math.max(1e-9, xMax - xMin) * plotW; };
    var yAt = function (v) { return pad.top + plotH / 2 - v / maxAbs * (plotH / 2); };
    var xTicks = niceTicks(xMin, xMax, options.xTickCount || 6);
    var yTicks = [ -maxAbs, -maxAbs / 2, 0, maxAbs / 2, maxAbs ];
    drawGrid(ctx, pad, plotW, plotH, xTicks, yTicks, xMin, xMax, -maxAbs, maxAbs, {
      xFormat: options.xFormat || function (v) { return v.toFixed(v < 10 ? 2 : 1) + 's'; },
      yFormat: options.yFormat || function (v) { return v.toFixed(2); }
    });
    var color = options.color || COLORS.cyan;
    var bins = Math.max(1, Math.floor(plotW));
    var mn = new Float64Array(bins).fill(Infinity);
    var mx = new Float64Array(bins).fill(-Infinity);
    var count = end - start;
    for (var j = 0; j < count; j++) {
      var t = (start + j) / fs;
      var bin = Math.floor((t - xMin) / Math.max(1e-9, xMax - xMin) * bins);
      if (bin < 0 || bin >= bins) continue;
      var v = signal[start + j];
      if (v < mn[bin]) mn[bin] = v;
      if (v > mx[bin]) mx[bin] = v;
    }
    ctx.strokeStyle = color;
    ctx.globalAlpha = options.alpha == null ? 0.9 : options.alpha;
    ctx.lineWidth = options.width || 1.4;
    ctx.beginPath();
    for (var b = 0; b < bins; b++) {
      if (mn[b] === Infinity) continue;
      var x = pad.left + b + 0.5;
      ctx.moveTo(x, yAt(mx[b]));
      ctx.lineTo(x, yAt(mn[b]));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (options.markers && options.markers.length) {
      ctx.setLineDash([3, 4]);
      for (var m = 0; m < options.markers.length; m++) {
        var mt = options.markers[m];
        if (mt < xMin || mt > xMax) continue;
        var mxp = xAt(mt);
        ctx.strokeStyle = options.markerColor || COLORS.amber;
        ctx.globalAlpha = 0.55;
        ctx.beginPath(); ctx.moveTo(mxp, pad.top); ctx.lineTo(mxp, pad.top + plotH); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    }

    drawLabels(ctx, frame.s, pad, plotW, plotH, options);
  }

  function drawMultiWaveform(canvas, series, options) {
    options = options || {};
    if (!series || !series.length) { drawEmpty(canvas, options); return; }
    var frame = chartFrame(canvas, options);
    if (!frame) return;
    var ctx = frame.s.ctx;
    var pad = frame.pad;
    var plotW = frame.plotW;
    var plotH = frame.plotH;
    var startSec = options.start || 0;
    var endSec = options.end == null ? Infinity : options.end;
    var maxAbs = 0.001;
    for (var i = 0; i < series.length; i++) {
      var sig = series[i].signal;
      var fs = series[i].fs;
      var start = Math.max(0, Math.floor(startSec * fs));
      var end = Math.min(sig.length, Math.ceil(Math.min(endSec, sig.length / fs) * fs));
      for (var j = start; j < end; j++) maxAbs = Math.max(maxAbs, Math.abs(sig[j]));
    }
    maxAbs *= 1.12;
    var xMax = endSec === Infinity ? series[0].signal.length / series[0].fs : endSec;
    var xAt = function (t) { return pad.left + (t - startSec) / Math.max(1e-9, xMax - startSec) * plotW; };
    var yAt = function (v) { return pad.top + plotH / 2 - v / maxAbs * (plotH / 2); };
    var xTicks = niceTicks(startSec, xMax, options.xTickCount || 6);
    var yTicks = [-maxAbs, -maxAbs / 2, 0, maxAbs / 2, maxAbs];
    drawGrid(ctx, pad, plotW, plotH, xTicks, yTicks, startSec, xMax, -maxAbs, maxAbs, {
      xFormat: options.xFormat || function (v) { return v.toFixed(v < 10 ? 2 : 1) + 's'; },
      yFormat: options.yFormat || function (v) { return v.toFixed(2); }
    });
    var bins = Math.max(1, Math.floor(plotW));
    for (var s = 0; s < series.length; s++) {
      var item = series[s];
      var signal = item.signal;
      var rate = item.fs;
      var a0 = Math.max(0, Math.floor(startSec * rate));
      var a1 = Math.min(signal.length, Math.ceil(Math.min(xMax, signal.length / rate) * rate));
      var mn = new Float64Array(bins).fill(Infinity);
      var mx = new Float64Array(bins).fill(-Infinity);
      for (var k = a0; k < a1; k++) {
        var t = k / rate;
        var bin = Math.floor((t - startSec) / Math.max(1e-9, xMax - startSec) * bins);
        if (bin < 0 || bin >= bins) continue;
        var val = signal[k];
        if (val < mn[bin]) mn[bin] = val;
        if (val > mx[bin]) mx[bin] = val;
      }
      ctx.strokeStyle = item.color || COLORS.cyan;
      ctx.globalAlpha = item.alpha == null ? 0.8 : item.alpha;
      ctx.lineWidth = item.width || 1.2;
      ctx.beginPath();
      for (var b = 0; b < bins; b++) {
        if (mn[b] === Infinity) continue;
        var x = pad.left + b + 0.5;
        ctx.moveTo(x, yAt(mx[b]));
        ctx.lineTo(x, yAt(mn[b]));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    drawLabels(ctx, frame.s, pad, plotW, plotH, options);
    var entries = series.filter(function (it) { return it.label; }).map(function (it) {
      return { label: it.label, color: it.color, width: it.width };
    });
    if (entries.length) drawLegend(ctx, entries, pad.left, 27, plotW);
  }

  function spectrumSeries(spectrum, color, label, maxHz) {
    var freqs = spectrum.freqs;
    var db = spectrum.magDb;
    var n = freqs.length;
    var outX = [];
    var outY = [];
    for (var i = 0; i < n; i++) {
      if (maxHz != null && freqs[i] > maxHz) break;
      outX.push(freqs[i]);
      outY.push(db[i]);
    }
    return { x: outX, y: outY, color: color, label: label, fill: null, width: 1.6 };
  }

  function drawSpectrum(canvas, spectra, options) {
    options = options || {};
    var list = Array.isArray(spectra) ? spectra : [spectra];
    var maxHz = options.maxHz || Math.min(20000, (list[0] && list[0].freqs[list[0].freqs.length - 1]) || 20000);
    var series = list.map(function (sp, i) {
      var color = (options.colors && options.colors[i]) || [COLORS.cyan, COLORS.teal, COLORS.violet][i % 3];
      var label = (options.labels && options.labels[i]) || null;
      var sr = spectrumSeries(sp, color, label, maxHz);
      if (i === 0 && options.fill !== false) sr.fill = 'rgba(56, 189, 248, 0.10)';
      return sr;
    });
    if (series[0] && options.fill === false) series[0].fill = null;
    return drawLineChart(canvas, series, {
      height: options.height,
      title: options.title == null ? 'Spektrum frekuensi' : options.title,
      xLabel: options.xLabel || 'frekuensi',
      yLabel: options.yLabel || 'magnitudo (dB)',
      yMin: options.yMin == null ? -100 : options.yMin,
      yMax: options.yMax == null ? 5 : options.yMax,
      xMin: 0,
      xMax: maxHz,
      xFormat: options.xFormat || function (v) { return PSD.formatHz(v); },
      yFormat: options.yFormat || function (v) { return v.toFixed(0) + ' dB'; },
      xTickCount: options.xTickCount || 6,
      yTickCount: options.yTickCount || 5,
      markers: options.markers,
      hLines: options.hLines,
      legend: options.labels != null
    });
  }

  function colorFor(t, stops) {
    t = PSD.clamp(t, 0, 1);
    stops = stops || [
      { t: 0.0, c: [8, 11, 26] },
      { t: 0.18, c: [30, 58, 138] },
      { t: 0.38, c: [8, 145, 178] },
      { t: 0.62, c: [45, 212, 191] },
      { t: 0.82, c: [250, 204, 21] },
      { t: 1.0, c: [254, 240, 138] }
    ];
    for (var i = 1; i < stops.length; i++) {
      if (t <= stops[i].t) {
        var a = stops[i - 1];
        var b = stops[i];
        var f = (t - a.t) / Math.max(1e-9, b.t - a.t);
        return [
          Math.round(PSD.lerp(a.c[0], b.c[0], f)),
          Math.round(PSD.lerp(a.c[1], b.c[1], f)),
          Math.round(PSD.lerp(a.c[2], b.c[2], f))
        ];
      }
    }
    return stops[stops.length - 1].c;
  }

  function drawSpectrogram(canvas, spec, options) {
    options = options || {};
    if (!spec || !spec.frames || !spec.frames.length) { drawEmpty(canvas, options); return; }
    var s = setup(canvas, options.height || 300);
    if (!s) return;
    var ctx = s.ctx;
    var pad = options.padding || { left: 58, right: 54, top: 38, bottom: 40 };
    var plotW = s.w - pad.left - pad.right;
    var plotH = s.h - pad.top - pad.bottom;
    var maxHz = options.maxHz || Math.min(16000, spec.freqs[spec.freqs.length - 1]);
    var maxBin = 0;
    for (var f = 0; f < spec.freqs.length; f++) if (spec.freqs[f] <= maxHz) maxBin = f;
    maxBin = Math.max(1, maxBin);
    var frames = spec.frames.length;
    var off = document.createElement('canvas');
    off.width = frames;
    off.height = maxBin + 1;
    var octx = off.getContext('2d');
    var img = octx.createImageData(frames, maxBin + 1);
    var minDb = Math.max(options.minDb == null ? -95 : options.minDb, spec.minDb);
    var maxDb = options.maxDb == null ? spec.maxDb : options.maxDb;
    var range = Math.max(1e-6, maxDb - minDb);
    for (var x = 0; x < frames; x++) {
      var row = spec.frames[x];
      for (var y = 0; y <= maxBin; y++) {
        var t = (row[y] - minDb) / range;
        var c = colorFor(t, options.colors);
        var idx = ((maxBin - y) * frames + x) * 4;
        img.data[idx] = c[0];
        img.data[idx + 1] = c[1];
        img.data[idx + 2] = c[2];
        img.data[idx + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, pad.left, pad.top, plotW, plotH);

    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = COLORS.text;
    var totalTime = spec.times[spec.times.length - 1] || 1;
    var xTicks = niceTicks(0, totalTime, 6);
    for (var i = 0; i < xTicks.length; i++) {
      var tx = xTicks[i];
      var px = pad.left + tx / Math.max(1e-9, totalTime) * plotW;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(tx.toFixed(1) + 's', px, pad.top + plotH + 8);
    }
    var yTicks = niceTicks(0, maxHz, 5);
    for (var j = 0; j < yTicks.length; j++) {
      var fy = yTicks[j];
      var py = pad.top + plotH - fy / maxHz * plotH;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(PSD.formatHz(fy), pad.left - 8, py);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(pad.left + plotW, py); ctx.stroke();
    }
    ctx.strokeStyle = COLORS.gridStrong;
    ctx.strokeRect(pad.left, pad.top, plotW, plotH);

    var barW = 12;
    var barX = s.w - pad.right + 16;
    var gradient = ctx.createLinearGradient(0, pad.top + plotH, 0, pad.top);
    for (var g = 0; g <= 10; g++) {
      var tc = colorFor(g / 10, options.colors);
      gradient.addColorStop(g / 10, 'rgb(' + tc[0] + ',' + tc[1] + ',' + tc[2] + ')');
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(barX, pad.top, barW, plotH);
    ctx.strokeStyle = COLORS.gridStrong;
    ctx.strokeRect(barX, pad.top, barW, plotH);
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(maxDb) + ' dB', barX + barW + 4, pad.top);
    ctx.fillText(Math.round(minDb) + ' dB', barX + barW + 4, pad.top + plotH);
    if (options.title) {
      ctx.fillStyle = COLORS.textBright;
      ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(options.title, pad.left, 13);
    }
  }

  function drawBarChart(canvas, categories, series, options) {
    options = options || {};
    var s = setup(canvas, options.height || 280);
    if (!s) return;
    var ctx = s.ctx;
    var pad = options.padding || { left: 58, right: 18, top: 40, bottom: 46 };
    var plotW = s.w - pad.left - pad.right;
    var plotH = s.h - pad.top - pad.bottom;
    var maxVal = options.yMax;
    if (maxVal == null) {
      maxVal = 0;
      for (var i = 0; i < series.length; i++) {
        for (var j = 0; j < series[i].values.length; j++) {
          maxVal = Math.max(maxVal, series[i].values[j]);
        }
      }
    }
    maxVal = Math.max(1e-9, maxVal * 1.15);
    var yTicks = niceTicks(0, maxVal, 5);
    var yAt = function (v) { return pad.top + plotH - v / maxVal * plotH; };
    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    for (var y = 0; y < yTicks.length; y++) {
      var py = yAt(yTicks[y]);
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(pad.left + plotW, py); ctx.stroke();
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText((options.yFormat || defaultNumber)(yTicks[y]), pad.left - 8, py);
    }
    var groupW = plotW / Math.max(1, categories.length);
    var barW = Math.min(options.barWidth || 28, groupW / (series.length + 1));
    for (var c = 0; c < categories.length; c++) {
      var cx = pad.left + groupW * (c + 0.5);
      for (var k = 0; k < series.length; k++) {
        var val = series[k].values[c] || 0;
        var x = cx - (series.length * barW) / 2 + k * barW + barW * 0.08;
        var w = barW * 0.84;
        var top = yAt(val);
        ctx.fillStyle = series[k].color || COLORS.cyan;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(x, top, w, pad.top + plotH - top);
        ctx.globalAlpha = 1;
        if (options.showValues && series.length <= 2) {
          ctx.fillStyle = COLORS.textBright;
          ctx.font = '10px "Segoe UI", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText((options.valueFormat || defaultNumber)(val), x + w / 2, top - 3);
        }
      }
      ctx.fillStyle = COLORS.text;
      ctx.font = '11px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(categories[c], cx, pad.top + plotH + 10);
    }
    ctx.strokeStyle = COLORS.gridStrong;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, pad.top + plotH);
    ctx.lineTo(pad.left + plotW, pad.top + plotH);
    ctx.stroke();
    if (options.title) {
      ctx.fillStyle = COLORS.textBright;
      ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(options.title, pad.left, 13);
    }
    if (options.yLabel) {
      ctx.save();
      ctx.translate(13, pad.top + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = COLORS.text;
      ctx.font = '11px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(options.yLabel, 0, 0);
      ctx.restore();
    }
    if (series.length > 1) {
      drawLegend(ctx, series.map(function (it) { return { label: it.label, color: it.color }; }), pad.left, 27, plotW);
    }
  }

  function drawPoleZero(canvas, poles, zeros, options) {
    options = options || {};
    var s = setup(canvas, options.height || 280);
    if (!s) return;
    var ctx = s.ctx;
    var size = Math.min(s.w, s.h) - 56;
    var cx = s.w / 2;
    var cy = s.h / 2 + 8;
    var R = Math.max(40, size / 2);
    ctx.strokeStyle = COLORS.gridStrong;
    ctx.fillStyle = 'rgba(56,189,248,0.035)';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath();
    ctx.moveTo(cx - R - 10, cy); ctx.lineTo(cx + R + 10, cy);
    ctx.moveTo(cx, cy - R - 10); ctx.lineTo(cx, cy + R + 10);
    ctx.stroke();
    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.fillText('Re', cx + R + 4, cy + 14);
    ctx.fillText('Im', cx + 12, cy - R - 8);
    var scale = R / 1.18;
    for (var i = 0; i < zeros.length; i++) {
      var z = zeros[i];
      var zx = cx + z.re * scale;
      var zy = cy - z.im * scale;
      ctx.strokeStyle = COLORS.teal;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(zx, zy, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (var j = 0; j < poles.length; j++) {
      var p = poles[j];
      var px = cx + p.re * scale;
      var py = cy - p.im * scale;
      ctx.strokeStyle = COLORS.pink;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(px - 5, py - 5); ctx.lineTo(px + 5, py + 5);
      ctx.moveTo(px + 5, py - 5); ctx.lineTo(px - 5, py + 5);
      ctx.stroke();
    }
    if (options.title) {
      ctx.fillStyle = COLORS.textBright;
      ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(options.title, 16, 13);
    }
    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.text;
    ctx.fillText('× pole   ○ zero   lingkaran satuan', 16, s.h - 12);
  }

  function drawMagnitudeResponse(canvas, resp, options) {
    options = options || {};
    var maxHz = options.maxHz || resp.fs / 2;
    var x = [];
    var y = [];
    for (var i = 0; i < resp.freqs.length; i++) {
      if (resp.freqs[i] > maxHz) break;
      x.push(resp.freqs[i]);
      y.push(Math.max(options.dbFloor == null ? -120 : options.dbFloor, resp.magDb[i]));
    }
    var markers = options.markers || [];
    return drawLineChart(canvas, [{ x: x, y: y, color: options.color || COLORS.cyan, label: options.label, width: 2, fill: options.fill }], {
      height: options.height,
      title: options.title == null ? 'Respons magnitudo' : options.title,
      xLabel: 'frekuensi',
      yLabel: 'gain (dB)',
      xMin: 0,
      xMax: maxHz,
      yMin: options.yMin == null ? -100 : options.yMin,
      yMax: options.yMax == null ? 5 : options.yMax,
      xFormat: function (v) { return PSD.formatHz(v); },
      yFormat: function (v) { return v.toFixed(0) + ' dB'; },
      markers: markers,
      hLines: options.hLines
    });
  }

  PSD.viz = {
    COLORS: COLORS,
    setup: setup,
    niceTicks: niceTicks,
    drawLineChart: drawLineChart,
    drawEmpty: drawEmpty,
    drawWaveform: drawWaveform,
    drawMultiWaveform: drawMultiWaveform,
    drawSpectrum: drawSpectrum,
    drawSpectrogram: drawSpectrogram,
    drawBarChart: drawBarChart,
    drawPoleZero: drawPoleZero,
    drawMagnitudeResponse: drawMagnitudeResponse,
    spectrumSeries: spectrumSeries,
    drawLegend: drawLegend,
    colorFor: colorFor
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
