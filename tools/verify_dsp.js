'use strict';

const path = require('path');
const base = path.join(__dirname, '..', 'js');
require(path.join(base, 'dsp-utils.js'));
require(path.join(base, 'fft.js'));
require(path.join(base, 'fir-filter.js'));
require(path.join(base, 'iir-filter.js'));
require(path.join(base, 'bpm-detection.js'));
require(path.join(base, 'beat-detection.js'));
require(path.join(base, 'energy-analysis.js'));

const P = globalThis.PSD;
const FS = 44100;
let failures = 0;

function check(name, condition, detail) {
  const ok = !!condition;
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  [' + detail + ']' : ''));
}

function gainAt(resp, freq) {
  let idx = 0;
  let best = Infinity;
  for (let i = 0; i < resp.freqs.length; i++) {
    const d = Math.abs(resp.freqs[i] - freq);
    if (d < best) { best = d; idx = i; }
  }
  return resp.magDb[idx];
}

console.log('Music Analyzer — DSP verification\n');

const N = 64;
const re = new Float64Array(N);
const im = new Float64Array(N);
const x = new Float64Array(N);
for (let i = 0; i < N; i++) x[i] = Math.sin(i * 0.3) + 0.4 * Math.cos(i * 0.11) + 0.1 * (i % 3);
re.set(x);
P.fft(re, im, false);
let maxErr = 0;
for (let k = 0; k < N; k++) {
  let nr = 0;
  let ni = 0;
  for (let n = 0; n < N; n++) {
    const a = -2 * Math.PI * k * n / N;
    nr += x[n] * Math.cos(a);
    ni += x[n] * Math.sin(a);
  }
  maxErr = Math.max(maxErr, Math.abs(re[k] - nr), Math.abs(im[k] - ni));
}
check('FFT radix-2 matches naive DFT', maxErr < 1e-9, 'max error ' + maxErr.toExponential(2));

const fir = P.designFIR({ type: 'lowpass', cutoff: 1000, numTaps: 101, window: 'hamming', fs: FS });
const firResp = P.firFrequencyResponse(fir.coeffs, FS, 4096);
check('FIR low-pass passband 100 Hz', Math.abs(gainAt(firResp, 100)) < 0.5, gainAt(firResp, 100).toFixed(2) + ' dB');
check('FIR low-pass stopband 5 kHz', gainAt(firResp, 5000) < -40, gainAt(firResp, 5000).toFixed(2) + ' dB');
check('FIR coefficients are odd length', fir.numTaps % 2 === 1, fir.numTaps + ' tap');

const iir4 = P.designIIR({ type: 'lowpass', order: 4, cutoff: 1000, fs: FS });
const iir4Resp = P.iirFrequencyResponse(iir4.sections, FS, 4096);
check('IIR Butterworth order 4 is stable', P.iirStability(iir4.sections).stable);
check('IIR -3 dB at cutoff', Math.abs(gainAt(iir4Resp, 1000) + 3.01) < 0.6, gainAt(iir4Resp, 1000).toFixed(2) + ' dB');

const iir8 = P.designIIR({ type: 'lowpass', order: 8, cutoff: 1000, fs: FS });
const iir8Resp = P.iirFrequencyResponse(iir8.sections, FS, 4096);
check('IIR order 8 is stable (SOS)', P.iirStability(iir8.sections).stable);
check('IIR order 8 passband is normalized', Math.abs(gainAt(iir8Resp, 100)) < 0.5, gainAt(iir8Resp, 100).toFixed(2) + ' dB');

const dur = 20;
const clicks = new Float32Array(FS * dur);
for (let b = 0; b < dur * 2; b++) {
  const start = Math.round(b * 0.5 * FS);
  for (let i = 0; i < Math.round(0.06 * FS) && start + i < clicks.length; i++) {
    clicks[start + i] += Math.exp(-i / (0.015 * FS)) * Math.sin(2 * Math.PI * 1000 * i / FS) * 0.7;
  }
}
const tempo = P.estimateBPM(clicks, FS);
const beats = P.detectBeats(clicks, FS, tempo.bpm, { envelopeData: tempo.envelopeData });
check('BPM of a 120 BPM click track', Math.abs(tempo.bpmRounded - 120) <= 1, tempo.bpmRounded.toFixed(1) + ' BPM');
check('Beat grid detects the click count', Math.abs(beats.count - 40) <= 2, beats.count + ' beat');

const tone = new Float32Array(FS * 2);
for (let i = 0; i < tone.length; i++) tone[i] = 0.5 * Math.sin(2 * Math.PI * 100 * i / FS);
const toneRms = P.rms(tone);
check('RMS of a 0.5-amplitude sine', Math.abs(toneRms - 0.5 / Math.SQRT2) < 0.01, toneRms.toFixed(4));
const energy = P.analyzeEnergy(tone, FS);
check('100 Hz tone maps to the bass band', energy.bands[0].percent > 0.9, (energy.bands[0].percent * 100).toFixed(1) + '% bass');
const high = new Float32Array(FS * 2);
for (let i = 0; i < high.length; i++) high[i] = 0.4 * Math.sin(2 * Math.PI * 10000 * i / FS);
const highEnergy = P.analyzeEnergy(high, FS);
check('10 kHz tone maps to the treble band', highEnergy.bands[2].percent > 0.8, (highEnergy.bands[2].percent * 100).toFixed(1) + '% treble');

console.log('\n' + (failures ? failures + ' check(s) failed.' : 'All checks passed.'));
process.exit(failures ? 1 : 0);
