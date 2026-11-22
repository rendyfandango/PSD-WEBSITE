(function (global) {
  'use strict';

  var V2 = global.V2 = global.V2 || {};

  function Player(audio) {
    this.audio = audio;
    this.current = null;
    this.src = null;
    this.listeners = {};
    var self = this;
    ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'error'].forEach(function (name) {
      self.audio.addEventListener(name, function () { self.emit(name, self); });
    });
  }

  Player.prototype.on = function (name, handler) {
    (this.listeners[name] = this.listeners[name] || []).push(handler);
    return this;
  };

  Player.prototype.emit = function (name, payload) {
    var list = this.listeners[name] || [];
    for (var i = 0; i < list.length; i++) list[i](payload);
  };

  Player.prototype.setTrack = function (track, url) {
    if (!track || !url) return;
    if (this.current && this.current.id === track.id && this.src === url) return;
    this.current = track;
    this.src = url;
    this.audio.src = url;
    this.audio.load();
    this.emit('trackchange', track);
  };

  Player.prototype.play = function () {
    if (this.audio.ended || (this.duration() > 0 && this.audio.currentTime >= this.duration() - 0.05)) {
      try { this.audio.currentTime = 0; } catch (e) {}
    }
    var promise = this.audio.play();
    if (promise && promise.catch) promise.catch(function () {});
  };

  Player.prototype.pause = function () {
    this.audio.pause();
  };

  Player.prototype.toggle = function () {
    if (this.audio.paused) this.play();
    else this.pause();
  };

  Player.prototype.stop = function () {
    this.audio.pause();
    try { this.audio.currentTime = 0; } catch (e) { return; }
  };

  Player.prototype.seek = function (seconds) {
    if (isFinite(seconds)) this.audio.currentTime = Math.max(0, seconds);
  };

  Player.prototype.seekRatio = function (ratio) {
    var duration = this.duration();
    if (duration) this.seek(Math.max(0, Math.min(1, ratio)) * duration);
  };

  Player.prototype.duration = function () {
    if (isFinite(this.audio.duration) && this.audio.duration > 0) return this.audio.duration;
    return this.current && this.current.duration ? this.current.duration : 0;
  };

  Player.prototype.isPlaying = function () {
    return !this.audio.paused;
  };

  Player.prototype.clear = function () {
    this.stop();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.current = null;
    this.src = null;
  };

  V2.Player = Player;
})(typeof globalThis !== 'undefined' ? globalThis : this);
