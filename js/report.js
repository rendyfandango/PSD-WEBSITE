(function (global) {
  'use strict';

  var V2 = global.V2 = global.V2 || {};
  var PSD = global.PSD;

  function features(analysis) {
    var e = analysis.energy;
    return {
      rms: e.rms,
      rmsDb: e.rmsDb,
      peak: e.peak,
      crestFactor: e.crestFactor,
      bpm: analysis.tempo ? analysis.tempo.bpmRounded : 0,
      bpmConfidence: analysis.tempo ? analysis.tempo.confidence : 0,
      beats: analysis.beatStats ? analysis.beatStats.count : 0,
      centroid: e.centroid,
      dominant: e.dominant,
      bands: e.bands.map(function (b) { return { name: b.name, low: b.low, high: b.high, percent: b.percent, db: b.db }; })
    };
  }

  function build(state) {
    if (!state.compare) return null;
    var c = state.compare;
    return {
      generatedAt: new Date().toISOString(),
      track: {
        id: c.track.id,
        title: c.track.title,
        source: c.track.source,
        duration: c.track.duration,
        sampleRate: c.fs
      },
      config: c.cfg,
      original: features(c.original),
      fir: {
        design: {
          numTaps: c.fir.design.numTaps,
          order: c.fir.design.order,
          window: c.fir.design.window,
          cutoff: c.fir.design.cutoff,
          cutoff2: c.fir.design.cutoff2,
          groupDelaySamples: c.fir.design.groupDelaySamples,
          coefficients: Array.prototype.slice.call(c.fir.design.coeffs)
        },
        metrics: c.fir.metrics,
        features: features(c.fir.analysis)
      },
      iir: {
        design: {
          prototypeOrder: c.iir.design.prototypeOrder,
          effectiveOrder: c.iir.design.order,
          sections: c.iir.design.sections,
          cutoff: c.iir.design.cutoff,
          cutoff2: c.iir.design.cutoff2,
          groupDelaySamples: c.iir.design.groupDelaySamples
        },
        metrics: c.iir.metrics,
        features: features(c.iir.analysis)
      },
      rows: c.rows
    };
  }

  function csvEscape(value) {
    var text = String(value == null ? '' : value);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportJson(state) {
    var report = build(state);
    if (!report) return false;
    var name = 'music-analyzer-v2-' + report.track.id.replace(/[^a-z0-9_-]/gi, '-') + '-' + new Date().toISOString().slice(0, 10) + '.json';
    download(name, JSON.stringify(report, null, 2), 'application/json');
    return true;
  }

  function exportCsv(state) {
    if (!state.compare) return false;
    var lines = ['Parameter,Original,FIR,IIR'];
    for (var i = 0; i < state.compare.rows.length; i++) {
      var row = state.compare.rows[i];
      lines.push([row.label, row.original, row.fir, row.iir].map(csvEscape).join(','));
    }
    var name = 'music-analyzer-v2-' + state.compare.track.id.replace(/[^a-z0-9_-]/gi, '-') + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    download(name, lines.join('\r\n'), 'text/csv;charset=utf-8');
    return true;
  }

  function print() {
    global.print();
  }

  V2.report = {
    build: build,
    exportJson: exportJson,
    exportCsv: exportCsv,
    print: print,
    features: features
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
