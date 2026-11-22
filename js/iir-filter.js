(function (global) {
  'use strict';

  var PSD = global.PSD = global.PSD || {};
  var C = PSD.complex;
  var EPS = 1e-12;

  function butterPoles(order) {
    var poles = [];
    for (var k = 0; k < order; k++) {
      var theta = Math.PI * (2 * k + order + 1) / (2 * order);
      poles.push({ re: Math.cos(theta), im: Math.sin(theta) });
    }
    return poles;
  }

  function bilinear(s, fs) {
    var twoFs = 2 * fs;
    var num = { re: twoFs + s.re, im: s.im };
    var den = { re: twoFs - s.re, im: -s.im };
    return C.div(num, den);
  }

  function findConjugate(list, item, tol) {
    tol = tol || 1e-7;
    for (var i = 0; i < list.length; i++) {
      if (Math.abs(list[i].re - item.re) < tol && Math.abs(list[i].im + item.im) < tol) return i;
    }
    return -1;
  }

  function buildSections(poles, zeros, gain) {
    var remP = poles.slice();
    var remZ = zeros.slice();
    var sections = [];
    while (remP.length > 0) {
      var p = remP.shift();
      var den;
      var degree;
      if (Math.abs(p.im) > 1e-7) {
        var ci = findConjugate(remP, p);
        if (ci >= 0) remP.splice(ci, 1);
        den = [1, -2 * p.re, p.re * p.re + p.im * p.im];
        degree = 2;
      } else {
        den = [1, -p.re, 0];
        degree = 1;
      }

      var num;
      if (degree === 2) {
        var zi = -1;
        for (var a = 0; a < remZ.length; a++) {
          if (Math.abs(remZ[a].im) > 1e-7) { zi = a; break; }
        }
        if (zi >= 0) {
          var z1 = remZ.splice(zi, 1)[0];
          var zj = findConjugate(remZ, z1);
          if (zj >= 0) remZ.splice(zj, 1);
          num = [1, -2 * z1.re, z1.re * z1.re + z1.im * z1.im];
        } else {
          var za = remZ.shift() || { re: 0, im: 0 };
          var zb = remZ.shift() || { re: 0, im: 0 };
          num = [1, -(za.re + zb.re), za.re * zb.re];
        }
      } else {
        var ri = -1;
        for (var b = 0; b < remZ.length; b++) {
          if (Math.abs(remZ[b].im) < 1e-7) { ri = b; break; }
        }
        var zr = ri >= 0 ? remZ.splice(ri, 1)[0] : (remZ.shift() || { re: 0, im: 0 });
        num = [1, -zr.re, 0];
      }
      sections.push({ b0: num[0], b1: num[1], b2: num[2], a1: den[1], a2: den[2] });
    }

    if (remZ.length > 0) {
      throw new Error('IIR SOS builder left ' + remZ.length + ' unassigned zero(s)');
    }

    var g = gain;
    sections[0].b0 *= g;
    sections[0].b1 *= g;
    sections[0].b2 *= g;
    return sections;
  }

  function designIIR(options) {
    options = options || {};
    var fs = options.fs || 44100;
    var type = PSD.normalizeFilterType(options.type);
    var order = PSD.clamp(Math.round(options.order || 4), 1, 12);
    var cutoff = options.cutoff == null ? 1000 : options.cutoff;
    var cutoff2 = options.cutoff2 == null ? Math.min(fs / 2 - 1, cutoff * 4) : options.cutoff2;

    if (type === 'bandpass') {
      if (cutoff > cutoff2) { var tmp = cutoff; cutoff = cutoff2; cutoff2 = tmp; }
      cutoff = PSD.clamp(cutoff, 1, fs / 2 - 2);
      cutoff2 = PSD.clamp(cutoff2, cutoff + 1, fs / 2 - 1);
    } else {
      cutoff = PSD.clamp(cutoff, 1, fs / 2 - 1);
    }

    var proto = butterPoles(order);
    var omega1 = 2 * Math.PI * cutoff / fs;
    var om1 = 2 * fs * Math.tan(omega1 / 2);
    var analogPoles = [];
    var zeros = [];
    var refOmega = 0;
    var om0 = 0;
    var bw = 0;

    if (type === 'lowpass') {
      for (var i = 0; i < proto.length; i++) {
        analogPoles.push(C.scale(proto[i], om1));
      }
      for (var zl = 0; zl < order; zl++) zeros.push({ re: -1, im: 0 });
      refOmega = 0;
    } else if (type === 'highpass') {
      for (var j = 0; j < proto.length; j++) {
        analogPoles.push(C.scale(C.conj(proto[j]), om1));
      }
      for (var zh = 0; zh < order; zh++) zeros.push({ re: 1, im: 0 });
      refOmega = Math.PI;
    } else {
      var omega2 = 2 * Math.PI * cutoff2 / fs;
      var om2 = 2 * fs * Math.tan(omega2 / 2);
      om0 = Math.sqrt(om1 * om2);
      bw = om2 - om1;
      for (var k = 0; k < proto.length; k++) {
        var p = proto[k];
        var bcoef = C.scale(p, -bw);
        var b2 = C.mul(bcoef, bcoef);
        var disc = C.sub(b2, { re: 4 * om0 * om0, im: 0 });
        var root = C.sqrt(disc);
        var s1 = C.scale(C.sub(root, bcoef), 0.5);
        var s2 = C.scale(C.sub(C.scale(bcoef, -1), root), 0.5);
        analogPoles.push(s1);
        analogPoles.push(s2);
      }
      for (var zp = 0; zp < order; zp++) {
        zeros.push({ re: 1, im: 0 });
        zeros.push({ re: -1, im: 0 });
      }
      refOmega = 2 * Math.atan(om0 / (2 * fs));
    }

    var digitalPoles = analogPoles.map(function (s) { return bilinear(s, fs); });
    var zRef = C.expj(refOmega);
    var num = { re: 1, im: 0 };
    var den = { re: 1, im: 0 };
    for (var nz = 0; nz < zeros.length; nz++) num = C.mul(num, C.sub(zRef, zeros[nz]));
    for (var np = 0; np < digitalPoles.length; np++) den = C.mul(den, C.sub(zRef, digitalPoles[np]));
    var kRaw = C.div(num, den);
    var gain = 1 / Math.max(EPS, C.abs(kRaw));

    var sections = buildSections(digitalPoles, zeros, gain);
    var effectiveOrder = 0;
    for (var s = 0; s < sections.length; s++) effectiveOrder += Math.abs(sections[s].a2) > 1e-12 ? 2 : 1;

    var resp = frequencyResponse(sections, fs, 512);
    var refFreq = refOmega * fs / (2 * Math.PI);
    var gd = groupDelayAt(sections, fs, refFreq, resp);

    return {
      engine: 'iir',
      type: type,
      fs: fs,
      order: effectiveOrder,
      prototypeOrder: order,
      cutoff: cutoff,
      cutoff2: cutoff2,
      sections: sections,
      poles: digitalPoles,
      zeros: zeros,
      gain: gain,
      refFreq: refFreq,
      groupDelaySamples: gd,
      om0: om0,
      bandwidth: bw
    };
  }

  function sectionResponse(section, omega) {
    var z1 = C.expj(-omega);
    var z2 = C.mul(z1, z1);
    var numerator = C.add(C.add({ re: section.b0, im: 0 }, C.scale(z1, section.b1)), C.scale(z2, section.b2));
    var denominator = C.add(C.add({ re: 1, im: 0 }, C.scale(z1, section.a1)), C.scale(z2, section.a2));
    return C.div(numerator, denominator);
  }

  function responseAt(sections, omega) {
    var h = { re: 1, im: 0 };
    for (var s = 0; s < sections.length; s++) h = C.mul(h, sectionResponse(sections[s], omega));
    return h;
  }

  function frequencyResponse(sections, fs, nPoints) {
    nPoints = nPoints || 1024;
    var freqs = new Float64Array(nPoints + 1);
    var mag = new Float64Array(nPoints + 1);
    var magDb = new Float64Array(nPoints + 1);
    var phase = new Float64Array(nPoints + 1);
    for (var k = 0; k <= nPoints; k++) {
      var omega = Math.PI * k / nPoints;
      var h = responseAt(sections, omega);
      freqs[k] = fs * 0.5 * k / nPoints;
      mag[k] = C.abs(h);
      magDb[k] = 20 * Math.log10(Math.max(mag[k], 1e-12));
      phase[k] = C.arg(h);
    }
    var unwrapped = PSD.unwrapPhase ? PSD.unwrapPhase(phase) : phase;
    var gd = new Float64Array(nPoints + 1);
    var dw = Math.PI / nPoints;
    for (var j = 0; j <= nPoints; j++) {
      var a = Math.max(0, j - 1);
      var b = Math.min(nPoints, j + 1);
      gd[j] = -(unwrapped[b] - unwrapped[a]) / (dw * (b - a));
    }
    return { freqs: freqs, mag: mag, magDb: magDb, phase: phase, unwrappedPhase: unwrapped, groupDelay: gd, fs: fs };
  }

  function groupDelayAt(sections, fs, freqHz, resp) {
    resp = resp || frequencyResponse(sections, fs, 1024);
    var idx = 0;
    var best = Infinity;
    for (var i = 0; i < resp.freqs.length; i++) {
      var d = Math.abs(resp.freqs[i] - freqHz);
      if (d < best) { best = d; idx = i; }
    }
    return resp.groupDelay[idx];
  }

  function applyIIR(signal, sections, options) {
    options = options || {};
    var n = signal.length;
    var current = new Float64Array(n);
    var next = new Float64Array(n);
    for (var i = 0; i < n; i++) current[i] = signal[i];
    for (var s = 0; s < sections.length; s++) {
      var sec = sections[s];
      var b0 = sec.b0, b1 = sec.b1, b2 = sec.b2, a1 = sec.a1, a2 = sec.a2;
      var z1 = 0;
      var z2 = 0;
      for (var j = 0; j < n; j++) {
        var x = current[j];
        var y = b0 * x + z1;
        z1 = b1 * x - a1 * y + z2;
        z2 = b2 * x - a2 * y;
        next[j] = y;
      }
      var tmp = current;
      current = next;
      next = tmp;
    }
    var out = new Float32Array(n);
    var compensate = options.compensateDelay === true;
    var delay = compensate ? Math.max(0, Math.round(options.delaySamples || 0)) : 0;
    for (var k = 0; k < n; k++) {
      var idx = k + delay;
      out[k] = idx < n ? current[idx] : 0;
    }
    return out;
  }

  function polesZeros(sections) {
    var poles = [];
    var zeros = [];
    function roots(a, b, c) {
      if (Math.abs(a) < EPS) {
        if (Math.abs(b) < EPS) return [];
        return [{ re: -c / b, im: 0 }];
      }
      var disc = b * b - 4 * a * c;
      if (disc >= 0) {
        var sq = Math.sqrt(disc);
        return [{ re: (-b + sq) / (2 * a), im: 0 }, { re: (-b - sq) / (2 * a), im: 0 }];
      }
      var re = -b / (2 * a);
      var im = Math.sqrt(-disc) / (2 * a);
      return [{ re: re, im: im }, { re: re, im: -im }];
    }
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      poles = poles.concat(roots(1, s.a1, s.a2));
      zeros = zeros.concat(roots(s.b0, s.b1, s.b2));
    }
    return { poles: poles, zeros: zeros };
  }

  function stability(sections) {
    var pz = polesZeros(sections);
    var maxR = 0;
    for (var i = 0; i < pz.poles.length; i++) {
      var r = Math.hypot(pz.poles[i].re, pz.poles[i].im);
      if (r > maxR) maxR = r;
    }
    return { stable: maxR < 1, maxPoleRadius: maxR };
  }

  function estimateOps(sections) {
    var mults = 0;
    var adds = 0;
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      if (Math.abs(s.b0) > 1e-14) mults++;
      if (Math.abs(s.b1) > 1e-14) mults++;
      if (Math.abs(s.b2) > 1e-14) mults++;
      if (Math.abs(s.a1) > 1e-14) mults++;
      if (Math.abs(s.a2) > 1e-14) mults++;
      adds += 3;
    }
    return { sections: sections.length, multiplications: mults, additions: adds, total: mults + adds };
  }

  PSD.designIIR = designIIR;
  PSD.applyIIR = applyIIR;
  PSD.iirFrequencyResponse = frequencyResponse;
  PSD.iirResponseAt = responseAt;
  PSD.iirGroupDelayAt = groupDelayAt;
  PSD.iirPolesZeros = polesZeros;
  PSD.iirStability = stability;
  PSD.iirEstimateOps = estimateOps;
  PSD.butterPoles = butterPoles;
  PSD.bilinear = bilinear;
})(typeof globalThis !== 'undefined' ? globalThis : this);
