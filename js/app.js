(function () {
  'use strict';

  var PSD = window.PSD;
  var V2 = window.V2;
  var store = V2.store;

  var KEY_SELECTED = 'psd.v2.selectedTrack';
  var KEY_FILTER = 'psd.v2.filter';
  var KEY_COMPARE = 'psd.v2.compare';
  var SEGMENT_SECONDS = 60;
  var MAX_UPLOAD_MB = 80;

  var DEFAULT_FILTER = {
    engine: 'fir',
    type: 'lowpass',
    cutoff: 1000,
    cutoff2: 4000,
    numTaps: 101,
    order: 4,
    window: 'hamming'
  };
  var DEFAULT_COMPARE = {
    type: 'lowpass',
    cutoff: 1000,
    cutoff2: 4000,
    firTaps: 101,
    iirOrder: 4,
    window: 'hamming'
  };

  var state = {
    demos: [],
    uploads: [],
    tracks: [],
    current: null,
    player: null,
    audioCtx: null,
    decoded: {},
    uploadUrls: {},
    analysis: null,
    analysisTrackId: null,
    filtered: null,
    compare: null,
    filterConfig: merge(DEFAULT_FILTER, loadJSON(KEY_FILTER, {})),
    compareConfig: merge(DEFAULT_COMPARE, loadJSON(KEY_COMPARE, {})),
    activeView: 'library',
    advanced: false,
    filterDetailOpen: false,
    filterDesign: null,
    filterResp: null,
    filterPlayer: null,
    filteredUrl: null,
    abTimer: null,
    abToken: 0,
    loadingCount: 0,
    analysisToken: 0
  };

  var playIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  var pauseIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';

  function id(name) {
    return document.getElementById(name);
  }

  function all(selector) {
    return Array.prototype.slice.call(document.querySelectorAll(selector));
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function pct(value) {
    return isFinite(value) ? (value * 100).toFixed(1) + '%' : '—';
  }

  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      return;
    }
  }

  function merge(base, extra) {
    var out = {};
    for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    if (extra) for (var j in extra) if (Object.prototype.hasOwnProperty.call(extra, j)) out[j] = extra[j];
    return out;
  }

  function showLoading(text) {
    state.loadingCount++;
    id('loading-text').textContent = text || 'Memproses…';
    id('loading').classList.remove('hidden');
  }

  function hideLoading() {
    state.loadingCount = Math.max(0, state.loadingCount - 1);
    if (state.loadingCount === 0) id('loading').classList.add('hidden');
  }

  function toast(message, type) {
    var stack = id('toast-stack');
    var item = document.createElement('div');
    item.className = 'toast ' + (type || '');
    item.textContent = message;
    stack.appendChild(item);
    setTimeout(function () {
      item.style.opacity = '0';
      item.style.transform = 'translateY(6px)';
      setTimeout(function () { item.remove(); }, 220);
    }, 2800);
  }

  function ensureAudio() {
    if (!state.audioCtx) state.audioCtx = PSD.createAudioContext();
    if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
    return state.audioCtx;
  }

  function decodeArrayBuffer(arrayBuffer) {
    return new Promise(function (resolve, reject) {
      var ctx = ensureAudio();
      var promise = ctx.decodeAudioData(arrayBuffer, resolve, reject);
      if (promise && promise.then) promise.then(resolve).catch(reject);
    });
  }

  function yieldUI() {
    return new Promise(function (resolve) { setTimeout(resolve, 20); });
  }

  function findTrack(trackId) {
    for (var i = 0; i < state.tracks.length; i++) if (state.tracks[i].id === trackId) return state.tracks[i];
    return null;
  }

  function mapDemo(track) {
    return {
      id: 'demo:' + track.id,
      demoId: track.id,
      source: 'demo',
      title: track.title,
      artist: track.artist,
      genre: track.genre,
      file: track.file,
      cover: 'assets/images/' + track.cover,
      duration: track.duration,
      refBpm: track.bpm
    };
  }

  function mapUpload(meta) {
    return {
      id: 'upload:' + meta.id,
      uploadId: meta.id,
      source: 'upload',
      title: meta.title,
      genre: 'Upload',
      duration: meta.duration,
      size: meta.size,
      sampleRate: meta.sampleRate,
      addedAt: meta.addedAt
    };
  }

  function rebuildTracks() {
    state.tracks = state.demos.concat(state.uploads);
  }

  function formatFilterLabel(design) {
    if (!design) return '';
    var text = design.engine.toUpperCase() + ' ' + design.type + ' ' + PSD.formatHz(design.cutoff);
    if (design.type === 'bandpass') text += ' – ' + PSD.formatHz(design.cutoff2);
    return text;
  }

  function filterFs() {
    if (state.analysis && state.analysisTrackId === (state.current && state.current.id)) return state.analysis.fs;
    if (state.current && state.decoded[state.current.id]) return state.decoded[state.current.id].fs;
    return 44100;
  }

  function designFilter(fs) {
    var config = merge(state.filterConfig, { fs: fs || 44100 });
    return PSD.buildFilter(config);
  }

  function analysisSegment(data) {
    var maxLength = Math.round(data.fs * SEGMENT_SECONDS);
    if (data.signal.length <= maxLength) {
      return { signal: data.signal, truncated: false };
    }
    return { signal: data.signal.subarray(0, maxLength), truncated: true };
  }

  async function resolveDecoded(track) {
    if (state.decoded[track.id]) return state.decoded[track.id];
    showLoading('Memuat audio…');
    try {
      var arrayBuffer = await store.readTrack(track);
      var audioBuffer = await decodeArrayBuffer(arrayBuffer);
      var data = {
        signal: PSD.toMono(audioBuffer),
        fs: audioBuffer.sampleRate,
        duration: audioBuffer.duration
      };
      state.decoded[track.id] = data;
      return data;
    } finally {
      hideLoading();
    }
  }

  async function ensureAnalysis() {
    if (!state.current) throw new Error('Pilih lagu dulu');
    if (state.analysis && state.analysisTrackId === state.current.id) return state.analysis;
    var track = state.current;
    var data = await resolveDecoded(track);
    if (!state.current || state.current.id !== track.id) throw new Error('Analisis dibatalkan');
    var segment = analysisSegment(data);
    var analysis = PSD.analyzeSignal(segment.signal, data.fs, {
      refBpm: track.refBpm,
      spectrogram: false
    });
    analysis.fs = data.fs;
    analysis.track = track;
    analysis.segment = segment.signal;
    analysis.truncated = segment.truncated;
    analysis.fullDuration = data.duration;
    state.analysis = analysis;
    state.analysisTrackId = track.id;
    return analysis;
  }

  async function loadPlayerSource(track) {
    var url = track.source === 'demo' ? track.file : state.uploadUrls[track.id];
    if (!url && track.source === 'upload') {
      var blob = await store.getUploadBlob(track.uploadId);
      if (!blob) throw new Error('File upload tidak ditemukan');
      url = URL.createObjectURL(blob);
      state.uploadUrls[track.id] = url;
    }
    state.player.setTrack(track, url);
  }

  function renderTopCover(track) {
    var node = id('top-cover');
    if (!track) {
      node.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>';
      return;
    }
    if (track.source === 'demo') {
      node.innerHTML = '<img src="' + esc(track.cover) + '" alt="">';
    } else {
      node.innerHTML = '<span class="cover-letter">' + esc(track.title.charAt(0).toUpperCase()) + '</span>';
    }
  }

  function renderTopBar() {
    var track = state.current;
    if (!track) {
      id('top-title').textContent = 'Belum ada lagu';
      id('top-sub').textContent = 'Pilih dari Library';
      renderTopCover(null);
      id('top-play').disabled = true;
      id('top-time').textContent = '0:00 / 0:00';
      id('top-bar').style.width = '0%';
      updatePlayButton();
      return;
    }
    id('top-title').textContent = track.title;
    var sub = track.source === 'upload' ? 'Upload' : track.genre;
    sub += ' · ' + PSD.formatDuration(track.duration);
    if (track.source === 'demo' && track.refBpm) sub += ' · ' + track.refBpm + ' BPM';
    id('top-sub').textContent = sub;
    renderTopCover(track);
    id('top-play').disabled = false;
    updateProgress();
    updatePlayButton();
  }

  function updatePlayButton() {
    var playing = state.player && state.player.isPlaying() && state.current;
    id('top-play').innerHTML = playing ? pauseIcon : playIcon;
    id('top-play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    var analyzePlay = id('analyze-play');
    analyzePlay.textContent = playing ? 'Pause' : 'Play';
    analyzePlay.disabled = !state.current;
  }

  function updateLibraryPlayIcons() {
    var playing = state.player && state.player.isPlaying();
    all('[data-play]').forEach(function (button) {
      var card = button.closest('[data-track]');
      var isCurrent = card && state.current && card.dataset.track === state.current.id;
      button.innerHTML = isCurrent && playing ? pauseIcon : playIcon;
    });
  }

  function updateProgress() {
    var duration = state.player ? state.player.duration() : 0;
    var current = state.player ? (state.player.audio.currentTime || 0) : 0;
    var ratio = duration > 0 ? Math.min(1, current / duration) : 0;
    id('top-bar').style.width = (ratio * 100).toFixed(2) + '%';
    id('top-time').textContent = PSD.formatDuration(current) + ' / ' + PSD.formatDuration(duration);
  }

  function updateLibrarySelection() {
    all('[data-track]').forEach(function (card) {
      card.classList.toggle('selected', !!state.current && card.dataset.track === state.current.id);
    });
  }

  function renderLibrary() {
    var demoList = id('demo-list');
    if (!state.demos.length) {
      demoList.innerHTML = '<div class="empty" style="grid-column:1/-1">Demo track tidak tersedia.</div>';
    } else {
      demoList.innerHTML = state.demos.map(function (track) {
        var selected = state.current && state.current.id === track.id;
        return '<article class="demo-card' + (selected ? ' selected' : '') + '" data-track="' + esc(track.id) + '">' +
          '<div class="demo-cover"><img src="' + esc(track.cover) + '" alt="' + esc(track.title) + '"></div>' +
          '<div class="demo-info"><strong>' + esc(track.title) + '</strong><span>' + esc(track.genre) + ' · ' + PSD.formatDuration(track.duration) + '</span></div>' +
          '<div class="demo-actions">' +
            '<button class="icon-btn" type="button" data-play aria-label="Play ' + esc(track.title) + '">' + playIcon + '</button>' +
            '<button class="btn btn-small btn-ghost" type="button" data-open>Analisis</button>' +
          '</div>' +
        '</article>';
      }).join('');
    }

    var uploadList = id('upload-list');
    if (!state.uploads.length) {
      uploadList.innerHTML = '<div class="empty">Belum ada file upload.</div>';
    } else {
      uploadList.innerHTML = state.uploads.map(function (track) {
        var selected = state.current && state.current.id === track.id;
        var sizeText = track.size ? (track.size / 1024 / 1024).toFixed(1) + ' MB' : '';
        return '<div class="upload-item' + (selected ? ' selected' : '') + '" data-track="' + esc(track.id) + '">' +
          '<div class="upload-avatar">' + esc(track.title.charAt(0).toUpperCase()) + '</div>' +
          '<div class="upload-info"><strong>' + esc(track.title) + '</strong><span>' + PSD.formatDuration(track.duration) + (sizeText ? ' · ' + sizeText : '') + '</span></div>' +
          '<div class="upload-actions">' +
            '<button class="icon-btn" type="button" data-play aria-label="Play ' + esc(track.title) + '">' + playIcon + '</button>' +
            '<button class="icon-btn danger" type="button" data-delete aria-label="Hapus ' + esc(track.title) + '">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>' +
            '</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    id('upload-count').textContent = state.uploads.length;
    id('demo-count').textContent = state.demos.length + ' track';
    updateLibraryPlayIcons();
  }

  async function setCurrentTrack(track, options) {
    options = options || {};
    if (!track) {
      clearCurrentTrack();
      return;
    }
    var changed = !state.current || state.current.id !== track.id;
    state.current = track;
    if (changed) {
      state.analysis = null;
      state.analysisTrackId = null;
      state.filtered = null;
      clearFilteredAudio();
      state.compare = null;
      state.advanced = false;
      id('analyze-advanced-panel').classList.add('hidden');
      id('analyze-advanced').textContent = 'Advanced';
    }
    try { localStorage.setItem(KEY_SELECTED, track.id); } catch (e) {}
    renderTopBar();
    renderLibrary();
    updateLibrarySelection();
    updateAnalyzeHeader();
    updateAnalyzeVisibility();
    updateCompareEmpty();
    updateFilterStatus();
    try {
      await loadPlayerSource(track);
    } catch (error) {
      toast('Gagal memuat audio: ' + error.message, 'error');
    }
    if (state.activeView === 'analyze' && !options.silent) await runAnalysis();
    if (state.activeView === 'compare' && state.compare) renderCompare();
  }

  function clearCurrentTrack() {
    state.current = null;
    state.analysis = null;
    state.analysisTrackId = null;
    state.filtered = null;
    clearFilteredAudio();
    state.compare = null;
    try { localStorage.removeItem(KEY_SELECTED); } catch (e) { return; }
    if (state.player) state.player.clear();
    renderTopBar();
    renderLibrary();
    updateAnalyzeHeader();
    updateAnalyzeVisibility();
    updateCompareEmpty();
    updateFilterStatus();
  }

  async function selectAndAnalyze(track) {
    await setCurrentTrack(track, { silent: true });
    switchView('analyze', { silent: true });
    await runAnalysis();
  }

  async function toggleTrack(track) {
    pauseFilteredPlayback();
    if (!state.current || state.current.id !== track.id) {
      await setCurrentTrack(track, { silent: true });
      state.player.play();
    } else {
      state.player.toggle();
    }
  }

  async function deleteUpload(track) {
    if (!window.confirm('Hapus "' + track.title + '" dari library?')) return;
    showLoading('Menghapus lagu…');
    try {
      await store.deleteUpload(track.uploadId);
      if (state.uploadUrls[track.id]) {
        URL.revokeObjectURL(state.uploadUrls[track.id]);
        delete state.uploadUrls[track.id];
      }
      delete state.decoded[track.id];
      state.uploads = state.uploads.filter(function (item) { return item.id !== track.id; });
      rebuildTracks();
      if (state.current && state.current.id === track.id) {
        var next = state.demos[0] || state.uploads[0] || null;
        if (next) await setCurrentTrack(next, { silent: true });
        else clearCurrentTrack();
      } else {
        renderLibrary();
      }
      toast('Lagu dihapus.', 'success');
    } catch (error) {
      toast('Gagal menghapus: ' + error.message, 'error');
    } finally {
      hideLoading();
    }
  }

  function updateAnalyzeHeader() {
    if (!state.current) {
      id('analyze-title').textContent = 'Belum ada lagu';
      id('analyze-sub').textContent = 'Pilih lagu dari Library.';
      return;
    }
    id('analyze-title').textContent = state.current.title;
    var sub = (state.current.source === 'upload' ? 'Upload' : 'Demo') + ' · ' + PSD.formatDuration(state.current.duration);
    if (state.analysis && state.analysisTrackId === state.current.id) {
      sub += ' · ' + state.analysis.fs.toLocaleString('id-ID') + ' Hz';
      if (state.analysis.truncated) sub += ' · analisis 60 detik';
    }
    id('analyze-sub').textContent = sub;
  }

  function updateAnalyzeVisibility() {
    var has = !!(state.current && state.analysis && state.analysisTrackId === state.current.id);
    id('analyze-empty').classList.toggle('hidden', has);
    id('analyze-content').classList.toggle('hidden', !has);
    id('analyze-play').disabled = !state.current;
    if (!has) {
      id('analyze-empty').textContent = state.current ? 'Buka tab Analyze untuk menghitung fitur lagu ini.' : 'Pilih lagu untuk mulai analisis.';
    }
  }

  async function runAnalysis() {
    if (!state.current) {
      switchView('library');
      toast('Pilih lagu dulu.', 'warn');
      return;
    }
    if (state.analysis && state.analysisTrackId === state.current.id) {
      renderAnalyze();
      updateAnalyzeVisibility();
      return;
    }
    var token = ++state.analysisToken;
    showLoading('Menganalisis ' + state.current.title + '…');
    await yieldUI();
    try {
      await ensureAnalysis();
      if (token !== state.analysisToken) return;
      renderAnalyze();
      updateAnalyzeHeader();
      updateAnalyzeVisibility();
    } catch (error) {
      toast('Gagal analisis: ' + error.message, 'error');
      updateAnalyzeVisibility();
    } finally {
      hideLoading();
    }
  }

  function renderAnalyze() {
    var analysis = state.analysis;
    var track = state.current;
    if (!analysis || !track || state.analysisTrackId !== track.id) {
      updateAnalyzeVisibility();
      return;
    }
    var tempo = analysis.tempo || {};
    var beats = analysis.beatStats || {};
    var energy = analysis.energy;
    var filtered = state.filtered && state.filtered.trackId === track.id ? state.filtered : null;

    id('analyze-empty').classList.add('hidden');
    id('analyze-content').classList.remove('hidden');

    id('m-bpm').textContent = (tempo.bpmRounded || 0).toFixed(1);
    id('m-bpm-sub').textContent = PSD.tempoCategory(tempo.bpm) + ' · ' + Math.round((tempo.confidence || 0) * 100) + '%';
    id('m-beats').textContent = String(beats.count || 0);
    id('m-beats-sub').textContent = beats.meanInterval ? beats.meanInterval.toFixed(2) + ' s' : '—';
    id('m-rms').textContent = energy.rmsDb.toFixed(1) + ' dB';
    id('m-rms-sub').textContent = 'crest ' + energy.crestFactor.toFixed(2);
    id('m-peak').textContent = energy.peak.toFixed(3);
    id('m-peak-sub').textContent = 'ZCR ' + (energy.zeroCrossingRate * 100).toFixed(1) + '%';
    id('m-bass').textContent = pct(energy.bands[0] && energy.bands[0].percent);
    id('m-mid').textContent = pct(energy.bands[1] && energy.bands[1].percent);
    id('m-treble').textContent = pct(energy.bands[2] && energy.bands[2].percent);
    id('m-centroid').textContent = PSD.formatHz(energy.centroid);
    id('m-centroid-sub').textContent = 'dominan ' + PSD.formatHz(energy.dominant);

    var badges = ['<span class="chip">Original</span>'];
    if (analysis.truncated) badges.push('<span class="chip muted">60 detik pertama</span>');
    if (filtered) badges.push('<span class="chip accent">' + esc(formatFilterLabel(filtered.design)) + '</span>');
    id('analyze-badges').innerHTML = badges.join('');
    id('analyze-reset-filter').classList.toggle('hidden', !filtered);
    id('analyze-play-filtered').classList.toggle('hidden', !filtered);

    var canvasWave = id('an-wave');
    if (filtered) {
      id('analyze-wave-title').textContent = 'Waveform original vs filter';
      PSD.viz.drawMultiWaveform(canvasWave, [
        { signal: analysis.signal, fs: analysis.fs, color: PSD.viz.COLORS.cyan, label: 'Original', alpha: 0.5, width: 1 },
        { signal: filtered.signal, fs: analysis.fs, color: PSD.viz.COLORS.teal, label: 'Filter', alpha: 0.88, width: 1.2 }
      ], {
        start: 0,
        end: analysis.duration,
        title: '',
        xLabel: 'waktu',
        yLabel: 'amplitudo'
      });
    } else {
      id('analyze-wave-title').textContent = 'Waveform';
      PSD.viz.drawWaveform(canvasWave, analysis.signal, analysis.fs, {
        title: '',
        color: PSD.viz.COLORS.cyan,
        markers: analysis.beats ? analysis.beats.times : [],
        markerColor: 'rgba(251,191,36,0.5)',
        xLabel: 'waktu',
        yLabel: 'amplitudo',
        width: 1.1
      });
    }
    id('analyze-wave-hint').textContent = analysis.duration.toFixed(1) + ' s · ' + (beats.count || 0) + ' beat';

    if (filtered) {
      PSD.viz.drawSpectrum(id('an-spectrum'), [analysis.spectrum, filtered.analysis.spectrum], {
        maxHz: Math.min(20000, analysis.fs / 2),
        labels: ['Original', 'Filter'],
        colors: [PSD.viz.COLORS.cyan, PSD.viz.COLORS.teal],
        fill: false,
        yMin: -115,
        yMax: 5,
        title: ''
      });
    } else {
      PSD.viz.drawSpectrum(id('an-spectrum'), analysis.spectrum, {
        maxHz: Math.min(20000, analysis.fs / 2),
        yMin: -115,
        yMax: 5,
        title: ''
      });
    }

    id('analyze-advanced').textContent = state.advanced ? 'Tutup detail' : 'Advanced';
    if (state.advanced) renderAnalyzeAdvanced();
    updatePlayButton();
    updateAnalyzeHeader();
    updateFilteredUI();
  }

  function renderAnalyzeAdvanced() {
    var analysis = state.analysis;
    if (!analysis || !state.advanced) return;
    id('analyze-advanced-panel').classList.remove('hidden');
    if (!analysis.spectrogram) {
      analysis.spectrogram = PSD.spectrogram(analysis.segment, analysis.fs, {
        fftSize: 2048,
        hopSize: 1024,
        maxFrames: 600
      });
    }
    PSD.viz.drawSpectrogram(id('an-spectrogram'), analysis.spectrogram, {
      maxHz: Math.min(12000, analysis.fs / 2),
      title: ''
    });

    var filtered = state.filtered && state.filtered.trackId === analysis.track.id ? state.filtered : null;
    var rmsSeries = [
      { x: analysis.energy.frameTimes, y: analysis.energy.frameRms, color: PSD.viz.COLORS.cyan, label: 'Original', width: 1.4, fill: 'rgba(56,189,248,0.09)' }
    ];
    if (filtered) rmsSeries.push({ x: filtered.analysis.energy.frameTimes, y: filtered.analysis.energy.frameRms, color: PSD.viz.COLORS.teal, label: 'Filter', width: 1.4 });
    PSD.viz.drawLineChart(id('an-rms'), rmsSeries, {
      title: '',
      xLabel: 'waktu',
      yLabel: 'RMS',
      yMin: 0,
      xFormat: function (v) { return v.toFixed(0) + 's'; },
      yFormat: function (v) { return v.toFixed(2); }
    });

    var bandSeries = [
      { label: 'Original', color: PSD.viz.COLORS.cyan, values: analysis.energy.bands.map(function (b) { return b.percent; }) }
    ];
    if (filtered) bandSeries.push({ label: 'Filter', color: PSD.viz.COLORS.teal, values: filtered.analysis.energy.bands.map(function (b) { return b.percent; }) });
    PSD.viz.drawBarChart(id('an-bands'), ['Bass', 'Mid', 'Treble'], bandSeries, {
      title: '',
      yLabel: 'share',
      yMax: 1,
      valueFormat: function (v) { return (v * 100).toFixed(0) + '%'; },
      yFormat: function (v) { return (v * 100).toFixed(0) + '%'; }
    });

    if (analysis.tempo && analysis.tempo.envelopeData) {
      var env = analysis.tempo.envelopeData;
      PSD.viz.drawLineChart(id('an-onset'), [
        { x: env.times, y: env.envelope, color: PSD.viz.COLORS.amber, label: 'onset', width: 1.3, fill: 'rgba(251,191,36,0.08)' }
      ], {
        title: '',
        xLabel: 'waktu',
        yLabel: 'strength',
        yMin: 0,
        xFormat: function (v) { return v.toFixed(0) + 's'; },
        yFormat: function (v) { return v.toFixed(2); },
        legend: false
      });
    }

    if (analysis.tempo && analysis.tempo.candidates && analysis.tempo.candidates.length) {
      var x = [];
      var y = [];
      for (var i = 0; i < analysis.tempo.candidates.length; i++) {
        x.push(analysis.tempo.candidates[i].bpm);
        y.push(analysis.tempo.candidates[i].score);
      }
      PSD.viz.drawLineChart(id('an-acf'), [
        { x: x, y: y, color: PSD.viz.COLORS.violet, label: 'score', width: 1.5 }
      ], {
        title: '',
        xLabel: 'BPM',
        yLabel: 'score',
        yMin: 0,
        xFormat: function (v) { return v.toFixed(0); },
        yFormat: function (v) { return v.toFixed(2); },
        markers: [{ x: analysis.tempo.bpm, label: 'puncak', color: PSD.viz.COLORS.amber }],
        legend: false
      });
    }

    var rows = [];
    function addRow(label, a, b) {
      rows.push('<tr><td>' + label + '</td><td class="num">' + a + '</td><td class="num">' + b + '</td></tr>');
    }
    addRow('RMS', analysis.energy.rmsDb.toFixed(2) + ' dB', filtered ? filtered.analysis.energy.rmsDb.toFixed(2) + ' dB' : '—');
    addRow('BPM', (analysis.tempo.bpmRounded || 0).toFixed(1), filtered ? (filtered.analysis.tempo.bpmRounded || 0).toFixed(1) : '—');
    addRow('Beat', String(analysis.beatStats.count || 0), filtered ? String(filtered.analysis.beatStats.count || 0) : '—');
    addRow('Centroid', PSD.formatHz(analysis.energy.centroid), filtered ? PSD.formatHz(filtered.analysis.energy.centroid) : '—');
    addRow('Bass', pct(analysis.energy.bands[0].percent), filtered ? pct(filtered.analysis.energy.bands[0].percent) : '—');
    addRow('Mid', pct(analysis.energy.bands[1].percent), filtered ? pct(filtered.analysis.energy.bands[1].percent) : '—');
    addRow('Treble', pct(analysis.energy.bands[2].percent), filtered ? pct(filtered.analysis.energy.bands[2].percent) : '—');
    id('analyze-detail-body').innerHTML = rows.join('');
  }

  function toggleAdvanced() {
    state.advanced = !state.advanced;
    var panel = id('analyze-advanced-panel');
    id('analyze-advanced').textContent = state.advanced ? 'Tutup detail' : 'Advanced';
    if (!state.advanced) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');
    if (!state.analysis) return;
    if (!state.analysis.spectrogram) {
      showLoading('Menyiapkan detail…');
      setTimeout(function () {
        try {
          if (state.analysis) renderAnalyzeAdvanced();
        } catch (error) {
          toast('Gagal menyiapkan detail: ' + error.message, 'error');
        } finally {
          hideLoading();
        }
      }, 30);
    } else {
      renderAnalyzeAdvanced();
    }
  }

  function filteredReady() {
    return !!(state.filtered && state.current && state.filtered.trackId === state.current.id);
  }

  function filteredDuration() {
    if (state.filterPlayer) {
      var duration = state.filterPlayer.duration();
      if (duration) return duration;
    }
    return state.filtered ? state.filtered.analysis.duration : 0;
  }

  function cancelAB() {
    state.abToken += 1;
    state.abTimer = null;
  }

  function seekFiltered(seconds) {
    if (!state.filterPlayer) return;
    var duration = filteredDuration();
    var target = duration ? Math.max(0, Math.min(seconds, duration - 0.02)) : Math.max(0, seconds);
    try { state.filterPlayer.seek(target); } catch (e) {}
  }

  function abLimit() {
    var filterDuration = filteredDuration();
    var originalDuration = state.player ? state.player.duration() : 0;
    if (filterDuration && originalDuration) return Math.min(filterDuration, originalDuration);
    return filterDuration || originalDuration || 0;
  }

  function updateABUI() {
    var card = id('ab-card');
    if (!card) return;
    var ready = filteredReady();
    card.classList.toggle('hidden', !ready);
    if (!ready) return;
    var note = 'Original dan hasil filter, posisi sama.';
    if (state.filtered.levelDeltaDb < -15) {
      note = 'Level asli turun ' + Math.abs(state.filtered.levelDeltaDb).toFixed(0) + ' dB.';
    }
    if (state.filtered.playbackGainDb > 1) {
      note += ' Playback dinaikkan ' + state.filtered.playbackGainDb.toFixed(0) + ' dB.';
    }
    id('ab-note').textContent = note;
    var original = state.player ? state.player.audio : null;
    var filtered = state.filterPlayer ? state.filterPlayer.audio : null;
    var originalDuration = state.player ? state.player.duration() : 0;
    var filterDuration = filteredDuration();
    var originalTime = original ? (original.currentTime || 0) : 0;
    var filterTime = filtered ? (filtered.currentTime || 0) : 0;
    id('ab-original-time').textContent = PSD.formatDuration(originalTime) + ' / ' + PSD.formatDuration(originalDuration);
    id('ab-filtered-time').textContent = PSD.formatDuration(filterTime) + ' / ' + PSD.formatDuration(filterDuration);
    id('ab-original-fill').style.width = (originalDuration ? Math.min(100, originalTime / originalDuration * 100) : 0) + '%';
    id('ab-filtered-fill').style.width = (filterDuration ? Math.min(100, filterTime / filterDuration * 100) : 0) + '%';
    var originalPlaying = state.player && state.player.isPlaying();
    var filterPlaying = state.filterPlayer && state.filterPlayer.isPlaying();
    id('ab-original-play').innerHTML = originalPlaying ? pauseIcon : playIcon;
    id('ab-filtered-play').innerHTML = filterPlaying ? pauseIcon : playIcon;
    id('ab-original-play').setAttribute('aria-label', originalPlaying ? 'Pause original' : 'Putar original');
    id('ab-filtered-play').setAttribute('aria-label', filterPlaying ? 'Pause hasil filter' : 'Putar hasil filter');
    id('ab-original-row').classList.toggle('playing', !!originalPlaying);
    id('ab-filtered-row').classList.toggle('playing', !!filterPlaying);
    id('ab-toggle').textContent = state.abTimer ? 'Stop A/B' : 'A/B 4 detik';
  }

  function updateFilteredUI() {
    var ready = filteredReady();
    var label = state.filterPlayer && state.filterPlayer.isPlaying() ? 'Stop filter' : 'Putar hasil filter';
    [id('analyze-play-filtered'), id('filter-play')].forEach(function (button) {
      if (!button) return;
      button.classList.toggle('hidden', !ready);
      button.disabled = !ready;
      button.textContent = label;
    });
    updateABUI();
  }

  function stopFilteredPlayback(silent) {
    cancelAB();
    if (state.filterPlayer) state.filterPlayer.stop();
    updateFilteredUI();
    if (!silent) toast('Pemutaran filter dihentikan.', 'success');
  }

  function pauseFilteredPlayback() {
    cancelAB();
    if (state.filterPlayer) state.filterPlayer.pause();
    updateFilteredUI();
  }

  function clearFilteredAudio() {
    var wasAB = !!state.abTimer;
    cancelAB();
    if (wasAB) {
      if (state.player) state.player.pause();
      if (state.filterPlayer) state.filterPlayer.pause();
    }
    if (state.filterPlayer) state.filterPlayer.clear();
    if (state.filteredUrl) {
      URL.revokeObjectURL(state.filteredUrl);
      state.filteredUrl = null;
    }
    updateFilteredUI();
  }

  function playFiltered(quiet) {
    if (!filteredReady()) {
      toast('Terapkan filter dulu.', 'warn');
      return;
    }
    cancelAB();
    if (state.filterPlayer.isPlaying()) {
      pauseFilteredPlayback();
      toast('Pemutaran filter dihentikan.', 'success');
      return;
    }
    state.player.pause();
    var start = state.player.audio.currentTime || 0;
    var duration = filteredDuration();
    if (state.filterPlayer.audio.readyState === 0 || (duration && start >= duration - 0.05)) start = 0;
    seekFiltered(start);
    state.filterPlayer.play();
    updateFilteredUI();
    if (!quiet) toast('Memutar hasil filter.');
  }

  function toggleABPlayer(kind) {
    cancelAB();
    if (kind === 'original') {
      if (state.player.isPlaying()) {
        state.player.pause();
      } else {
        state.filterPlayer.pause();
        var start = state.filterPlayer.audio.currentTime || 0;
        var duration = state.player.duration();
        if (duration && start >= duration - 0.05) start = 0;
        state.player.seek(start);
        state.player.play();
      }
    } else if (filteredReady()) {
      if (state.filterPlayer.isPlaying()) {
        state.filterPlayer.pause();
      } else {
        state.player.pause();
        var filterStart = state.player.audio.currentTime || 0;
        var filterDuration = filteredDuration();
        if (state.filterPlayer.audio.readyState === 0 || (filterDuration && filterStart >= filterDuration - 0.05)) filterStart = 0;
        seekFiltered(filterStart);
        state.filterPlayer.play();
      }
    }
    updateFilteredUI();
  }

  function seekABTo(position) {
    cancelAB();
    state.player.pause();
    state.filterPlayer.pause();
    var limit = abLimit();
    var target = Math.max(0, Math.min(position, limit));
    state.player.seek(target);
    seekFiltered(target);
    updateFilteredUI();
  }

  function seekAB(event) {
    var bar = event.currentTarget;
    var rect = bar.getBoundingClientRect();
    var ratio = (event.clientX - rect.left) / Math.max(1, rect.width);
    seekABTo(Math.max(0, Math.min(1, ratio)) * abLimit());
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function toggleAB() {
    if (state.abTimer) {
      cancelAB();
      state.player.pause();
      state.filterPlayer.pause();
      updateFilteredUI();
      return;
    }
    if (!filteredReady()) {
      toast('Terapkan filter dulu.', 'warn');
      return;
    }
    runAB();
  }

  async function runAB() {
    state.player.pause();
    state.filterPlayer.pause();
    state.abToken += 1;
    var token = state.abToken;
    state.abTimer = true;
    var limit = abLimit();
    var start = state.player.audio.currentTime || 0;
    if (start >= limit - 4) start = 0;
    state.player.seek(start);
    seekFiltered(start);
    state.player.play();
    updateFilteredUI();
    await wait(4000);
    if (token !== state.abToken) return;
    state.player.pause();
    seekFiltered(start);
    state.filterPlayer.play();
    updateFilteredUI();
    await wait(4000);
    if (token !== state.abToken) return;
    state.filterPlayer.pause();
    state.abTimer = null;
    updateFilteredUI();
  }

  function resetFilter() {
    state.filtered = null;
    clearFilteredAudio();
    state.filterConfig = merge(DEFAULT_FILTER, {});
    saveJSON(KEY_FILTER, state.filterConfig);
    writeFilterControls();
    renderFilterResponse();
    if (state.filterDetailOpen) renderFilterDetail();
    renderAnalyze();
    toast('Filter dan pengaturan direset.', 'success');
  }

  function writeFilterControls() {
    var config = state.filterConfig;
    all('#filter-engine-seg button').forEach(function (button) {
      button.classList.toggle('active', button.dataset.engine === config.engine);
    });
    all('#filter-type-seg button').forEach(function (button) {
      button.classList.toggle('active', button.dataset.ftype === config.type);
    });
    id('filter-cutoff').value = config.cutoff;
    id('filter-cutoff2').value = config.cutoff2;
    id('filter-window').value = config.window;
    id('filter-cutoff2-field').classList.toggle('hidden', config.type !== 'bandpass');
    id('filter-window-field').classList.toggle('hidden', config.engine !== 'fir');
    var order = id('filter-order');
    if (config.engine === 'fir') {
      order.min = 11;
      order.max = 401;
      order.step = 2;
      order.value = config.numTaps;
      id('filter-order-label').textContent = 'Jumlah tap';
    } else {
      order.min = 1;
      order.max = 8;
      order.step = 1;
      order.value = config.order;
      id('filter-order-label').textContent = 'Orde IIR';
    }
    writeFilterLabels();
    updateFilterStatus();
  }

  function writeFilterLabels() {
    var config = state.filterConfig;
    id('filter-cutoff').value = config.cutoff;
    id('filter-cutoff2').value = config.cutoff2;
    id('filter-cutoff-value').textContent = PSD.formatHz(config.cutoff);
    id('filter-cutoff2-value').textContent = PSD.formatHz(config.cutoff2);
    id('filter-order-value').textContent = config.engine === 'fir' ? config.numTaps : config.order;
    id('filter-cutoff2-field').classList.toggle('hidden', config.type !== 'bandpass');
  }

  function updateFilterStatus() {
    var filtered = filteredReady();
    var text = filtered ? 'Diterapkan: ' + formatFilterLabel(state.filtered.design) : 'Belum diterapkan ke lagu ini.';
    if (filtered) {
      text += ' · level ' + state.filtered.analysis.energy.rmsDb.toFixed(1) + ' dB';
      if (state.filtered.levelDeltaDb < -15) text += ' · sangat pelan';
    }
    id('filter-status').textContent = text;
    updateFilteredUI();
  }

  function invalidateFiltered() {
    if (!state.filtered) return;
    state.filtered = null;
    clearFilteredAudio();
    updateFilterStatus();
    if (state.analysis) renderAnalyze();
  }

  function normalizeFilterConfig() {
    var config = state.filterConfig;
    config.cutoff = PSD.clamp(Number(config.cutoff) || DEFAULT_FILTER.cutoff, 20, 19900);
    config.cutoff2 = PSD.clamp(Number(config.cutoff2) || DEFAULT_FILTER.cutoff2, 20, 20000);
    if (config.type === 'bandpass') {
      config.cutoff = Math.min(config.cutoff, 19900);
      config.cutoff2 = Math.max(config.cutoff + 50, Math.min(config.cutoff2, 20000));
    }
    if (config.engine === 'fir') {
      var taps = Math.max(11, Math.min(401, Math.round(Number(config.numTaps) || DEFAULT_FILTER.numTaps)));
      config.numTaps = taps % 2 === 0 ? (taps < 401 ? taps + 1 : taps - 1) : taps;
    } else {
      config.order = Math.max(1, Math.min(8, Math.round(Number(config.order) || DEFAULT_FILTER.order)));
    }
  }

  function updateFilterConfig(patch) {
    state.filterConfig = merge(state.filterConfig, patch);
    normalizeFilterConfig();
    saveJSON(KEY_FILTER, state.filterConfig);
    invalidateFiltered();
    writeFilterLabels();
    filterRenderDebounced();
  }

  var filterRenderDebounced = PSD.debounce(function () {
    renderFilterResponse();
    if (state.filterDetailOpen) renderFilterDetail();
  }, 60);

  function renderFilterResponse() {
    var design = designFilter(filterFs());
    var response = PSD.filterResponse(design, 2048);
    state.filterDesign = design;
    state.filterResp = response;
    var markers = [{ x: design.cutoff, label: 'fc', color: '#fb923c' }];
    if (design.type === 'bandpass') markers.push({ x: design.cutoff2, label: 'fc2', color: '#fb923c' });
    PSD.viz.drawMagnitudeResponse(id('filter-response'), response, {
      title: '',
      maxHz: Math.min(20000, design.fs / 2),
      yMin: -100,
      yMax: 5,
      dbFloor: -110,
      color: design.engine === 'fir' ? PSD.viz.COLORS.cyan : PSD.viz.COLORS.violet,
      fill: design.engine === 'fir' ? 'rgba(56,189,248,0.09)' : 'rgba(167,139,250,0.09)',
      markers: markers,
      hLines: [{ y: -3, label: '-3 dB', color: 'rgba(251,191,36,0.68)' }]
    });
    id('filter-resp-hint').textContent = design.engine.toUpperCase() + ' · ' + design.type;
  }

  function renderFilterDetail() {
    if (!state.filterDetailOpen) return;
    var design = designFilter(filterFs());
    var response = PSD.filterResponse(design, 2048);
    var xPhase = [];
    var yPhase = [];
    var xDelay = [];
    var yDelay = [];
    var linearDelay = ((design.numTaps || 1) - 1) / 2;
    for (var i = 0; i < response.freqs.length; i++) {
      if (response.freqs[i] > 20000) break;
      xPhase.push(response.freqs[i]);
      xDelay.push(response.freqs[i]);
      if (design.engine === 'fir') {
        yPhase.push(-360 * response.freqs[i] / design.fs * linearDelay);
        yDelay.push(linearDelay / design.fs * 1000);
      } else {
        yPhase.push(response.unwrappedPhase[i] * 180 / Math.PI);
        yDelay.push(PSD.clamp(response.groupDelay[i] / design.fs * 1000, 0, 60));
      }
    }
    PSD.viz.drawLineChart(id('filter-phase'), [
      { x: xPhase, y: yPhase, color: PSD.viz.COLORS.amber, label: 'fase', width: 1.5 }
    ], {
      title: '',
      xLabel: 'frekuensi',
      yLabel: 'derajat',
      xMin: 0,
      xMax: 20000,
      xFormat: function (v) { return PSD.formatHz(v); },
      yFormat: function (v) { return v.toFixed(0) + '°'; },
      legend: false
    });
    PSD.viz.drawLineChart(id('filter-delay'), [
      { x: xDelay, y: yDelay, color: PSD.viz.COLORS.teal, label: 'delay', width: 1.5, fill: 'rgba(45,212,191,0.08)' }
    ], {
      title: '',
      xLabel: 'frekuensi',
      yLabel: 'ms',
      xMin: 0,
      xMax: 20000,
      yMin: 0,
      xFormat: function (v) { return PSD.formatHz(v); },
      yFormat: function (v) { return v.toFixed(1); },
      legend: false
    });
    if (design.engine === 'fir') {
      id('filter-impulse-title').textContent = 'Respons impuls';
      var center = (design.numTaps - 1) / 2;
      var x = [];
      var y = [];
      for (var n = 0; n < design.numTaps; n++) {
        x.push(n - center);
        y.push(design.coeffs[n]);
      }
      PSD.viz.drawLineChart(id('filter-impulse'), [
        { x: x, y: y, color: PSD.viz.COLORS.cyan, label: 'h[n]', width: 1.3 }
      ], {
        title: '',
        xLabel: 'sampel',
        yLabel: 'h[n]',
        xMin: -center - 1,
        xMax: center + 1,
        xFormat: function (v) { return Math.round(v); },
        yFormat: function (v) { return v.toFixed(3); },
        legend: false
      });
    } else {
      id('filter-impulse-title').textContent = 'Pole–zero';
      var pz = PSD.iirPolesZeros(design.sections);
      PSD.viz.drawPoleZero(id('filter-impulse'), pz.poles, pz.zeros, { title: '' });
    }
  }

  async function applyFilter(options) {
    options = options || {};
    if (!state.current) {
      switchView('library');
      toast('Pilih lagu dulu.', 'warn');
      return;
    }
    stopFilteredPlayback(true);
    showLoading('Menerapkan filter…');
    await yieldUI();
    try {
      var track = state.current;
      var analysis = await ensureAnalysis();
      if (!state.current || state.current.id !== track.id) throw new Error('Filter dibatalkan');
      var config = merge(state.filterConfig, { fs: analysis.fs });
      var design = PSD.buildFilter(config);
      var result = PSD.applyFilter(analysis.segment, config, { design: design, compensate: true });
      var filteredAnalysis = PSD.analyzeSignal(result.signal, analysis.fs, {
        refBpm: state.current.refBpm,
        spectrogram: false
      });
      var playbackSignal = result.signal;
      var playbackGainDb = 0;
      if (filteredAnalysis.energy.rms > 1e-7 && analysis.energy.rms > 0) {
        var peakCap = filteredAnalysis.energy.peak > 0 ? 0.98 / filteredAnalysis.energy.peak : 8;
        var gain = Math.min(analysis.energy.rms / filteredAnalysis.energy.rms, peakCap, 8);
        if (gain > 1.05) {
          playbackSignal = new Float32Array(result.signal.length);
          for (var i = 0; i < result.signal.length; i++) playbackSignal[i] = result.signal[i] * gain;
          playbackGainDb = 20 * Math.log10(gain);
        }
      }
      state.filtered = {
        trackId: state.current.id,
        design: design,
        result: result,
        signal: result.signal,
        analysis: filteredAnalysis,
        levelDeltaDb: filteredAnalysis.energy.rmsDb - analysis.energy.rmsDb,
        playbackGainDb: playbackGainDb
      };
      if (state.filteredUrl) URL.revokeObjectURL(state.filteredUrl);
      state.filteredUrl = URL.createObjectURL(PSD.signalToWavBlob(playbackSignal, analysis.fs));
      state.filterPlayer.setTrack({
        id: track.id + ':filter',
        title: track.title + ' (filter)',
        duration: filteredAnalysis.duration
      }, state.filteredUrl);
      updateFilterStatus();
      switchView('analyze', { silent: true });
      renderAnalyze();
      toast(options.listen ? 'Filter diterapkan. Memutar hasil filter.' : 'Filter diterapkan.', 'success');
      if (options.listen) playFiltered(true);
    } catch (error) {
      toast('Gagal filter: ' + error.message, 'error');
    } finally {
      hideLoading();
    }
  }

  function writeCompareControls() {
    var config = state.compareConfig;
    id('compare-type').value = config.type;
    id('compare-cutoff').value = config.cutoff;
    id('compare-cutoff2').value = config.cutoff2;
    id('compare-taps').value = config.firTaps;
    id('compare-order').value = config.iirOrder;
    writeCompareLabels();
  }

  function writeCompareLabels() {
    var config = state.compareConfig;
    id('compare-cutoff-value').textContent = PSD.formatHz(config.cutoff);
    id('compare-cutoff2-value').textContent = PSD.formatHz(config.cutoff2);
    id('compare-taps-value').textContent = config.firTaps;
    id('compare-order-value').textContent = config.iirOrder;
    id('compare-cutoff2-field').classList.toggle('hidden', config.type !== 'bandpass');
  }

  function normalizeCompareConfig() {
    var config = state.compareConfig;
    if (config.type === 'bandpass') {
      config.cutoff = Math.min(config.cutoff, 19900);
      config.cutoff2 = Math.max(config.cutoff + 50, Math.min(config.cutoff2, 20000));
    }
  }

  function updateCompareConfig(patch) {
    state.compareConfig = merge(state.compareConfig, patch);
    normalizeCompareConfig();
    saveJSON(KEY_COMPARE, state.compareConfig);
    state.compare = null;
    writeCompareLabels();
    renderCompareEmpty();
  }

  function responseSpecs(type, cutoff, cutoff2, nyquist) {
    if (type === 'lowpass') {
      return {
        passband: [0, Math.max(10, Math.min(nyquist, cutoff * 0.85))],
        stopbands: [[Math.min(nyquist, cutoff * 2), nyquist]]
      };
    }
    if (type === 'highpass') {
      return {
        passband: [Math.min(nyquist, cutoff * 1.15), nyquist],
        stopbands: [[0, Math.max(0, cutoff * 0.5)]]
      };
    }
    return {
      passband: [Math.min(nyquist, cutoff * 1.05), Math.min(nyquist, cutoff2 * 0.95)],
      stopbands: [[0, cutoff * 0.5], [Math.min(nyquist, cutoff2 * 2), nyquist]]
    };
  }

  function nearestIndex(freqs, hz) {
    var best = 0;
    var distance = Infinity;
    for (var i = 0; i < freqs.length; i++) {
      var d = Math.abs(freqs[i] - hz);
      if (d < distance) { distance = d; best = i; }
    }
    return best;
  }

  function firstCrossing(response, targetDb, startHz, direction) {
    var start = nearestIndex(response.freqs, startHz);
    if (direction === 'up') {
      for (var i = start; i < response.freqs.length; i++) {
        if (response.magDb[i] <= targetDb) return response.freqs[i];
      }
      return response.freqs[response.freqs.length - 1];
    }
    for (var j = start; j >= 0; j--) {
      if (response.magDb[j] <= targetDb) return response.freqs[j];
    }
    return response.freqs[0];
  }

  function transitionWidth(type, response, cutoff, cutoff2) {
    if (type === 'lowpass') {
      return Math.max(0, firstCrossing(response, -40, cutoff, 'up') - cutoff);
    }
    if (type === 'highpass') {
      return Math.max(0, cutoff - firstCrossing(response, -40, cutoff, 'down'));
    }
    var upper = Math.max(0, firstCrossing(response, -40, cutoff2, 'up') - cutoff2);
    var lower = Math.max(0, cutoff - firstCrossing(response, -40, cutoff, 'down'));
    return Math.max(upper, lower);
  }

  function filterMetrics(type, cutoff, cutoff2, nyquist, design, applyResult, response, analysis) {
    var metrics = PSD.analyzeFilterResponse(response, responseSpecs(type, cutoff, cutoff2, nyquist));
    var ops = design.engine === 'fir' ? PSD.firEstimateOps(design.coeffs) : PSD.iirEstimateOps(design.sections);
    return {
      engine: design.engine,
      orderText: design.engine === 'fir'
        ? design.numTaps + ' tap'
        : 'orde ' + design.prototypeOrder + ' / efektif ' + design.order,
      passbandRippleDb: metrics.passbandRippleDb,
      stopbandAttenuationDb: metrics.stopbandAttenuationDb,
      transitionWidthHz: transitionWidth(type, response, cutoff, cutoff2),
      groupDelayMs: design.groupDelaySamples / design.fs * 1000,
      ops: ops,
      processingMs: applyResult.processingMs,
      features: compactFeatures(analysis)
    };
  }

  function buildCompareRows(original, fir, iir) {
    var rows = [];
    function add(label, a, b, c) {
      rows.push({ label: label, original: a, fir: b, iir: c });
    }
    add('Tipe filter', '—', 'FIR', 'IIR');
    add('Orde / tap', '—', fir.orderText, iir.orderText);
    add('Passband ripple', '—', fir.passbandRippleDb.toFixed(2) + ' dB', iir.passbandRippleDb.toFixed(2) + ' dB');
    add('Stopband', '—', fir.stopbandAttenuationDb.toFixed(1) + ' dB', iir.stopbandAttenuationDb.toFixed(1) + ' dB');
    add('Transition', '—', fir.transitionWidthHz.toFixed(0) + ' Hz', iir.transitionWidthHz.toFixed(0) + ' Hz');
    add('Group delay', '—', fir.groupDelayMs.toFixed(2) + ' ms', iir.groupDelayMs.toFixed(2) + ' ms');
    add('Operasi / sampel', '—', fir.ops.multiplications + '× / ' + fir.ops.additions + '+', iir.ops.multiplications + '× / ' + iir.ops.additions + '+');
    add('Waktu proses', '—', fir.processingMs.toFixed(1) + ' ms', iir.processingMs.toFixed(1) + ' ms');
    add('RMS', original.rmsDb.toFixed(1) + ' dB', fir.features.rmsDb.toFixed(1) + ' dB', iir.features.rmsDb.toFixed(1) + ' dB');
    add('BPM', original.bpm.toFixed(1), fir.features.bpm.toFixed(1), iir.features.bpm.toFixed(1));
    add('Beat', String(original.beats), String(fir.features.beats), String(iir.features.beats));
    add('Bass', pct(original.bands[0].percent), pct(fir.features.bands[0].percent), pct(iir.features.bands[0].percent));
    add('Mid', pct(original.bands[1].percent), pct(fir.features.bands[1].percent), pct(iir.features.bands[1].percent));
    add('Treble', pct(original.bands[2].percent), pct(fir.features.bands[2].percent), pct(iir.features.bands[2].percent));
    return rows;
  }

  function compactFeatures(analysis) {
    var e = analysis.energy;
    return {
      rmsDb: e.rmsDb,
      bpm: analysis.tempo ? analysis.tempo.bpmRounded : 0,
      beats: analysis.beatStats ? analysis.beatStats.count : 0,
      centroid: e.centroid,
      bands: e.bands.map(function (b) { return { percent: b.percent, name: b.name }; })
    };
  }

  function bestSegment(analysis) {
    var duration = analysis.duration;
    var length = Math.min(4, duration);
    if (duration <= length) return { start: 0, end: duration };
    var frameTimes = analysis.energy.frameTimes;
    var frameRms = analysis.energy.frameRms;
    var best = 0;
    for (var i = 0; i < frameRms.length; i++) if (frameRms[i] > frameRms[best]) best = i;
    var center = frameTimes[best] || duration / 2;
    var start = Math.max(0, Math.min(duration - length, center - length / 2));
    return { start: start, end: start + length };
  }

  async function runCompare() {
    if (!state.current) {
      switchView('library');
      toast('Pilih lagu dulu.', 'warn');
      return;
    }
    showLoading('Menjalankan perbandingan…');
    await yieldUI();
    try {
      var track = state.current;
      var analysis = await ensureAnalysis();
      if (!state.current || state.current.id !== track.id) throw new Error('Perbandingan dibatalkan');
      var config = state.compareConfig;
      var fs = analysis.fs;
      var nyquist = fs / 2;
      var firConfig = { engine: 'fir', type: config.type, cutoff: config.cutoff, cutoff2: config.cutoff2, numTaps: config.firTaps, window: config.window, fs: fs };
      var iirConfig = { engine: 'iir', type: config.type, cutoff: config.cutoff, cutoff2: config.cutoff2, order: config.iirOrder, fs: fs };
      var firDesign = PSD.buildFilter(firConfig);
      var iirDesign = PSD.buildFilter(iirConfig);
      var firApply = PSD.applyFilter(analysis.segment, firConfig, { design: firDesign, compensate: true });
      var iirApply = PSD.applyFilter(analysis.segment, iirConfig, { design: iirDesign, compensate: true });
      var firAnalysis = PSD.analyzeSignal(firApply.signal, fs, { refBpm: state.current.refBpm, spectrogram: false });
      var iirAnalysis = PSD.analyzeSignal(iirApply.signal, fs, { refBpm: state.current.refBpm, spectrogram: false });
      var firResponse = PSD.filterResponse(firDesign, 4096);
      var iirResponse = PSD.filterResponse(iirDesign, 4096);
      var firMetrics = filterMetrics(config.type, config.cutoff, config.cutoff2, nyquist, firDesign, firApply, firResponse, firAnalysis);
      var iirMetrics = filterMetrics(config.type, config.cutoff, config.cutoff2, nyquist, iirDesign, iirApply, iirResponse, iirAnalysis);
      var originalFeatures = compactFeatures(analysis);
      var firFeatures = compactFeatures(firAnalysis);
      var iirFeatures = compactFeatures(iirAnalysis);
      var rows = buildCompareRows(originalFeatures, firMetrics, iirMetrics);
      state.compare = {
        track: state.current,
        fs: fs,
        cfg: config,
        original: analysis,
        fir: { design: firDesign, apply: firApply, analysis: firAnalysis, response: firResponse, metrics: firMetrics },
        iir: { design: iirDesign, apply: iirApply, analysis: iirAnalysis, response: iirResponse, metrics: iirMetrics },
        rows: rows,
        originalFeatures: originalFeatures,
        firFeatures: firFeatures,
        iirFeatures: iirFeatures
      };
      renderCompare();
      toast('Perbandingan selesai.', 'success');
    } catch (error) {
      toast('Gagal perbandingan: ' + error.message, 'error');
    } finally {
      hideLoading();
    }
  }

  function updateCompareEmpty() {
    var empty = id('compare-empty');
    var content = id('compare-content');
    if (state.compare && state.compare.track.id === (state.current && state.current.id)) {
      empty.classList.add('hidden');
      content.classList.remove('hidden');
      return;
    }
    content.classList.add('hidden');
    empty.classList.remove('hidden');
    if (!state.current) empty.textContent = 'Pilih lagu di Library dulu.';
    else empty.textContent = 'Atur spesifikasi lalu klik Jalankan.';
  }

  function renderCompare() {
    if (!state.compare || !state.current || state.compare.track.id !== state.current.id) {
      updateCompareEmpty();
      return;
    }
    var compare = state.compare;
    id('compare-empty').classList.add('hidden');
    id('compare-content').classList.remove('hidden');
    id('compare-body').innerHTML = compare.rows.map(function (row) {
      return '<tr><td>' + esc(row.label) + '</td><td class="num">' + esc(row.original) + '</td><td class="num">' + esc(row.fir) + '</td><td class="num">' + esc(row.iir) + '</td></tr>';
    }).join('');
    id('compare-note').textContent = (compare.original.truncated ? 'Analisis 60 detik pertama. ' : '') + 'Waktu proses diukur di browser.';

    var maxHz = Math.min(20000, compare.fs / 2);
    var x = [];
    var yFir = [];
    var yIir = [];
    for (var i = 0; i < compare.fir.response.freqs.length; i++) {
      if (compare.fir.response.freqs[i] > maxHz) break;
      x.push(compare.fir.response.freqs[i]);
      yFir.push(Math.max(-115, compare.fir.response.magDb[i]));
      yIir.push(Math.max(-115, compare.iir.response.magDb[i]));
    }
    PSD.viz.drawLineChart(id('compare-response'), [
      { x: x, y: yFir, color: PSD.viz.COLORS.teal, label: 'FIR', width: 2, fill: 'rgba(45,212,191,0.06)' },
      { x: x, y: yIir, color: PSD.viz.COLORS.violet, label: 'IIR', width: 2 }
    ], {
      title: '',
      xLabel: 'frekuensi',
      yLabel: 'dB',
      xMin: 0,
      xMax: maxHz,
      yMin: -100,
      yMax: 5,
      xFormat: function (v) { return PSD.formatHz(v); },
      yFormat: function (v) { return v.toFixed(0); },
      markers: [
        { x: compare.cfg.cutoff, label: 'fc1', color: PSD.viz.COLORS.orange },
        compare.cfg.type === 'bandpass' ? { x: compare.cfg.cutoff2, label: 'fc2', color: PSD.viz.COLORS.orange } : null
      ].filter(Boolean),
      hLines: [{ y: -3, label: '-3 dB', color: 'rgba(251,191,36,0.65)' }]
    });

    var segment = bestSegment(compare.original);
    PSD.viz.drawMultiWaveform(id('compare-wave'), [
      { signal: compare.original.signal, fs: compare.fs, color: PSD.viz.COLORS.cyan, label: 'Original', alpha: 0.45, width: 1 },
      { signal: compare.fir.apply.signal, fs: compare.fs, color: PSD.viz.COLORS.teal, label: 'FIR', alpha: 0.74, width: 1.1 },
      { signal: compare.iir.apply.signal, fs: compare.fs, color: PSD.viz.COLORS.violet, label: 'IIR', alpha: 0.74, width: 1.1 }
    ], {
      start: segment.start,
      end: segment.end,
      title: '',
      xLabel: 'waktu',
      yLabel: 'amplitudo'
    });

    PSD.viz.drawSpectrum(id('compare-spectrum'), [
      compare.original.spectrum,
      compare.fir.analysis.spectrum,
      compare.iir.analysis.spectrum
    ], {
      maxHz: maxHz,
      labels: ['Original', 'FIR', 'IIR'],
      colors: [PSD.viz.COLORS.cyan, PSD.viz.COLORS.teal, PSD.viz.COLORS.violet],
      fill: false,
      yMin: -115,
      yMax: 5,
      title: ''
    });

    PSD.viz.drawBarChart(id('compare-bands'), ['Bass', 'Mid', 'Treble'], [
      { label: 'Original', color: PSD.viz.COLORS.cyan, values: compare.originalFeatures.bands.map(function (b) { return b.percent; }) },
      { label: 'FIR', color: PSD.viz.COLORS.teal, values: compare.firFeatures.bands.map(function (b) { return b.percent; }) },
      { label: 'IIR', color: PSD.viz.COLORS.violet, values: compare.iirFeatures.bands.map(function (b) { return b.percent; }) }
    ], {
      title: '',
      yLabel: 'share',
      yMax: 1,
      valueFormat: function (v) { return (v * 100).toFixed(0) + '%'; },
      yFormat: function (v) { return (v * 100).toFixed(0) + '%'; }
    });
  }

  function toggleExportMenu(show) {
    var menu = id('export-menu');
    var visible = show == null ? menu.classList.contains('hidden') : show;
    menu.classList.toggle('hidden', !visible);
  }

  function handleExport(kind) {
    if (!state.compare) {
      toast('Jalankan perbandingan dulu.', 'warn');
      toggleExportMenu(false);
      return;
    }
    if (kind === 'csv') {
      if (V2.report.exportCsv(state)) toast('CSV diunduh.', 'success');
    } else if (kind === 'json') {
      if (V2.report.exportJson(state)) toast('JSON diunduh.', 'success');
    } else if (kind === 'print') {
      V2.report.print();
    }
    toggleExportMenu(false);
  }

  function switchView(view, options) {
    options = options || {};
    state.activeView = view;
    all('.view').forEach(function (section) {
      section.classList.toggle('active', section.id === 'view-' + view);
    });
    all('.nav-item').forEach(function (button) {
      button.classList.toggle('active', button.dataset.view === view);
    });
    if (options.silent) return;
    if (view === 'library') {
      renderLibrary();
    } else if (view === 'analyze') {
      if (state.current) runAnalysis();
      else updateAnalyzeVisibility();
    } else if (view === 'filter') {
      renderFilterResponse();
      if (state.filterDetailOpen) renderFilterDetail();
    } else if (view === 'compare') {
      updateCompareEmpty();
      if (state.compare) renderCompare();
    }
  }

  function handleFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    uploadFiles(files);
  }

  async function uploadFiles(files) {
    var lastTrack = null;
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var validType = (file.type && file.type.indexOf('audio/') === 0) || /\.(mp3|wav|m4a|aac|ogg|oga|flac|webm)$/i.test(file.name);
      if (!validType) {
        toast('File bukan audio: ' + file.name, 'error');
        continue;
      }
      if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
        toast('File terlalu besar (maks ' + MAX_UPLOAD_MB + ' MB).', 'error');
        continue;
      }
      showLoading('Menyiapkan ' + file.name + '…');
      try {
        var arrayBuffer = await file.arrayBuffer();
        var audioBuffer = await decodeArrayBuffer(arrayBuffer);
        var uploadId = 'u' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        var rawTitle = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
        var title = rawTitle ? rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1) : 'Tanpa judul';
        var meta = {
          id: uploadId,
          title: title,
          fileName: file.name,
          type: file.type || '',
          size: file.size,
          duration: audioBuffer.duration,
          sampleRate: audioBuffer.sampleRate,
          addedAt: Date.now()
        };
        await store.saveUpload(meta, file);
        var track = mapUpload(meta);
        state.decoded[track.id] = {
          signal: PSD.toMono(audioBuffer),
          fs: audioBuffer.sampleRate,
          duration: audioBuffer.duration
        };
        state.uploadUrls[track.id] = URL.createObjectURL(file);
        state.uploads.unshift(track);
        rebuildTracks();
        renderLibrary();
        lastTrack = track;
        toast('Lagu ditambahkan: ' + track.title, 'success');
      } catch (error) {
        toast('Gagal upload ' + file.name + ': ' + error.message, 'error');
      } finally {
        hideLoading();
      }
    }
    if (lastTrack) {
      await setCurrentTrack(lastTrack, { silent: true });
      switchView('analyze', { silent: true });
      await runAnalysis();
    }
  }

  function bindPlayer() {
    state.player.on('play', function () { updatePlayButton(); updateLibraryPlayIcons(); updateABUI(); });
    state.player.on('pause', function () { updatePlayButton(); updateLibraryPlayIcons(); updateABUI(); });
    state.player.on('ended', function () { updatePlayButton(); updateLibraryPlayIcons(); updateProgress(); updateABUI(); });
    state.player.on('timeupdate', function () { updateProgress(); updateABUI(); });
    state.player.on('loadedmetadata', function () { updateProgress(); updateABUI(); });
    state.player.on('trackchange', function () { updateProgress(); updatePlayButton(); updateABUI(); });
    state.player.on('error', function () { toast('Gagal memutar audio.', 'error'); });
    state.filterPlayer.on('play', updateFilteredUI);
    state.filterPlayer.on('pause', updateFilteredUI);
    state.filterPlayer.on('timeupdate', updateABUI);
    state.filterPlayer.on('loadedmetadata', updateFilteredUI);
    state.filterPlayer.on('ended', updateFilteredUI);
    state.filterPlayer.on('error', function () { toast('Gagal memutar hasil filter.', 'error'); });

    id('top-play').addEventListener('click', function () {
      if (!state.current) return;
      pauseFilteredPlayback();
      state.player.toggle();
    });
    id('analyze-play').addEventListener('click', function () {
      if (!state.current) return;
      pauseFilteredPlayback();
      state.player.toggle();
    });
    id('analyze-play-filtered').addEventListener('click', function () { playFiltered(); });
    id('analyze-reset-filter').addEventListener('click', resetFilter);
    id('top-progress').addEventListener('click', function (event) {
      var rect = id('top-progress').getBoundingClientRect();
      state.player.seekRatio((event.clientX - rect.left) / Math.max(1, rect.width));
    });
    id('top-progress').addEventListener('keydown', function (event) {
      if (event.key === 'ArrowRight') state.player.seek((state.player.audio.currentTime || 0) + 5);
      if (event.key === 'ArrowLeft') state.player.seek((state.player.audio.currentTime || 0) - 5);
    });
  }

  function bindAB() {
    id('ab-original-play').addEventListener('click', function () { toggleABPlayer('original'); });
    id('ab-filtered-play').addEventListener('click', function () { toggleABPlayer('filtered'); });
    id('ab-toggle').addEventListener('click', toggleAB);
    all('[data-ab-seek]').forEach(function (bar) {
      bar.addEventListener('click', seekAB);
      bar.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        var current = state.player.audio.currentTime || 0;
        seekABTo(current + (event.key === 'ArrowRight' ? 5 : -5));
      });
    });
  }

  function bindNav() {
    all('.nav-item').forEach(function (button) {
      button.addEventListener('click', function () { switchView(button.dataset.view); });
    });
    id('brand-link').addEventListener('click', function (event) {
      event.preventDefault();
      switchView('library');
    });
  }

  function bindLibrary() {
    id('demo-list').addEventListener('click', function (event) {
      var card = event.target.closest('[data-track]');
      if (!card) return;
      var track = findTrack(card.dataset.track);
      if (!track) return;
      if (event.target.closest('[data-play]')) {
        event.stopPropagation();
        toggleTrack(track);
      } else {
        selectAndAnalyze(track);
      }
    });
    id('upload-list').addEventListener('click', function (event) {
      var card = event.target.closest('[data-track]');
      if (!card) return;
      var track = findTrack(card.dataset.track);
      if (!track) return;
      if (event.target.closest('[data-delete]')) {
        event.stopPropagation();
        deleteUpload(track);
      } else if (event.target.closest('[data-play]')) {
        event.stopPropagation();
        toggleTrack(track);
      } else {
        selectAndAnalyze(track);
      }
    });
  }

  function bindUpload() {
    var input = id('file-input');
    ['sidebar-upload', 'top-upload', 'library-upload', 'dropzone-pick'].forEach(function (buttonId) {
      id(buttonId).addEventListener('click', function () { input.click(); });
    });
    input.addEventListener('change', function () {
      handleFiles(input.files);
      input.value = '';
    });
    var dropzone = id('dropzone');
    dropzone.addEventListener('click', function (event) {
      if (event.target.closest('button')) return;
      input.click();
    });
    ['dragenter', 'dragover'].forEach(function (name) {
      dropzone.addEventListener(name, function (event) {
        event.preventDefault();
        dropzone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (name) {
      dropzone.addEventListener(name, function (event) {
        event.preventDefault();
        dropzone.classList.remove('dragover');
      });
    });
    dropzone.addEventListener('drop', function (event) {
      if (event.dataTransfer && event.dataTransfer.files) handleFiles(event.dataTransfer.files);
    });
  }

  function bindAnalyze() {
    id('analyze-advanced').addEventListener('click', toggleAdvanced);
  }

  function bindFilter() {
    id('filter-engine-seg').addEventListener('click', function (event) {
      var button = event.target.closest('[data-engine]');
      if (!button) return;
      state.filterConfig.engine = button.dataset.engine;
      invalidateFiltered();
      writeFilterControls();
      saveJSON(KEY_FILTER, state.filterConfig);
      filterRenderDebounced();
    });
    id('filter-type-seg').addEventListener('click', function (event) {
      var button = event.target.closest('[data-ftype]');
      if (!button) return;
      state.filterConfig.type = button.dataset.ftype;
      normalizeFilterConfig();
      invalidateFiltered();
      writeFilterControls();
      saveJSON(KEY_FILTER, state.filterConfig);
      filterRenderDebounced();
    });
    id('filter-cutoff').addEventListener('input', function () {
      updateFilterConfig({ cutoff: parseInt(this.value, 10) || 1000 });
    });
    id('filter-cutoff2').addEventListener('input', function () {
      updateFilterConfig({ cutoff2: parseInt(this.value, 10) || 4000 });
    });
    id('filter-order').addEventListener('input', function () {
      var value = parseInt(this.value, 10) || 1;
      if (state.filterConfig.engine === 'fir') updateFilterConfig({ numTaps: value });
      else updateFilterConfig({ order: value });
    });
    id('filter-window').addEventListener('change', function () {
      updateFilterConfig({ window: this.value });
    });
    id('filter-reset').addEventListener('click', resetFilter);
    id('filter-apply').addEventListener('click', function () { applyFilter(); });
    id('filter-apply-listen').addEventListener('click', function () { applyFilter({ listen: true }); });
    id('filter-play').addEventListener('click', function () { playFiltered(); });
    id('filter-detail-toggle').addEventListener('click', function () {
      state.filterDetailOpen = !state.filterDetailOpen;
      id('filter-detail').classList.toggle('hidden', !state.filterDetailOpen);
      this.innerHTML = 'Detail teknis <span>' + (state.filterDetailOpen ? '−' : '+') + '</span>';
      if (state.filterDetailOpen) renderFilterDetail();
    });
  }

  function bindCompare() {
    id('compare-type').addEventListener('change', function () {
      updateCompareConfig({ type: this.value });
      writeCompareControls();
    });
    id('compare-cutoff').addEventListener('input', function () {
      updateCompareConfig({ cutoff: parseInt(this.value, 10) || 1000 });
      id('compare-cutoff').value = state.compareConfig.cutoff;
      id('compare-cutoff2').value = state.compareConfig.cutoff2;
      writeCompareLabels();
    });
    id('compare-cutoff2').addEventListener('input', function () {
      updateCompareConfig({ cutoff2: parseInt(this.value, 10) || 4000 });
      id('compare-cutoff').value = state.compareConfig.cutoff;
      id('compare-cutoff2').value = state.compareConfig.cutoff2;
      writeCompareLabels();
    });
    id('compare-taps').addEventListener('input', function () {
      updateCompareConfig({ firTaps: parseInt(this.value, 10) || 101 });
    });
    id('compare-order').addEventListener('input', function () {
      updateCompareConfig({ iirOrder: parseInt(this.value, 10) || 4 });
    });
    id('compare-run').addEventListener('click', runCompare);
    id('compare-export').addEventListener('click', function (event) {
      event.stopPropagation();
      toggleExportMenu();
    });
    id('export-menu').addEventListener('click', function (event) {
      var button = event.target.closest('[data-export]');
      if (button) handleExport(button.dataset.export);
    });
  }

  var redrawDebounced = PSD.debounce(function () {
    if (state.activeView === 'analyze' && state.analysis) renderAnalyze();
    else if (state.activeView === 'filter') {
      renderFilterResponse();
      if (state.filterDetailOpen) renderFilterDetail();
    } else if (state.activeView === 'compare' && state.compare) renderCompare();
  }, 120);

  function bindGlobal() {
    window.addEventListener('resize', redrawDebounced);
    document.addEventListener('click', function (event) {
      if (!event.target.closest('.menu-wrap')) toggleExportMenu(false);
    });
    window.addEventListener('beforeunload', function () {
      if (state.player) state.player.pause();
      if (state.filterPlayer) state.filterPlayer.pause();
      if (state.filteredUrl) URL.revokeObjectURL(state.filteredUrl);
    });
  }

  async function boot() {
    showLoading('Memuat library…');
    try {
      var results = await Promise.all([
        store.loadManifest(),
        store.listUploads().catch(function () { return []; })
      ]);
      state.demos = results[0].map(mapDemo);
      state.uploads = results[1].map(mapUpload);
      rebuildTracks();
      var saved = null;
      try { saved = localStorage.getItem(KEY_SELECTED); } catch (e) {}
      var track = findTrack(saved) || state.demos[0] || state.uploads[0] || null;
      if (track) await setCurrentTrack(track, { silent: true });
      renderLibrary();
      switchView('library', { silent: true });
      updateAnalyzeHeader();
      updateAnalyzeVisibility();
    } catch (error) {
      toast('Gagal memuat library: ' + error.message, 'error');
    } finally {
      hideLoading();
    }
  }

  function init() {
    state.player = new V2.Player(id('audio-el'));
    state.filterPlayer = new V2.Player(id('filter-audio-el'));
    bindPlayer();
    bindAB();
    bindNav();
    bindLibrary();
    bindUpload();
    bindAnalyze();
    bindFilter();
    bindCompare();
    bindGlobal();
    normalizeFilterConfig();
    writeFilterControls();
    writeCompareControls();
    renderFilterResponse();
    renderTopBar();
    updateAnalyzeHeader();
    updateAnalyzeVisibility();
    updateCompareEmpty();
    boot();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
