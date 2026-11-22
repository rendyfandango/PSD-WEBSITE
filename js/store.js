(function (global) {
  'use strict';

  var V2 = global.V2 = global.V2 || {};
  var DB_NAME = 'music-analyzer-v2';
  var DB_VERSION = 1;
  var dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB) {
        reject(new Error('IndexedDB tidak didukung browser ini'));
        return;
      }
      var request = global.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function (event) {
        var db = event.target.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('Gagal membuka IndexedDB')); };
    });
    return dbPromise;
  }

  function listUploads() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('meta', 'readonly');
        var request = tx.objectStore('meta').getAll();
        request.onsuccess = function () {
          var items = (request.result || []).slice();
          items.sort(function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0); });
          resolve(items);
        };
        request.onerror = function () { reject(request.error); };
      });
    });
  }

  function saveUpload(meta, blob) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(['meta', 'files'], 'readwrite');
        tx.objectStore('meta').put(meta);
        tx.objectStore('files').put({ id: meta.id, blob: blob });
        tx.oncomplete = function () { resolve(meta); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }

  function deleteUpload(id) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(['meta', 'files'], 'readwrite');
        tx.objectStore('meta').delete(id);
        tx.objectStore('files').delete(id);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }

  function getUploadBlob(id) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('files', 'readonly');
        var request = tx.objectStore('files').get(id);
        request.onsuccess = function () {
          resolve(request.result ? request.result.blob : null);
        };
        request.onerror = function () { reject(request.error); };
      });
    });
  }

  function loadManifest() {
    return fetch('assets/music/manifest.json').then(function (response) {
      if (!response.ok) throw new Error('Manifest tidak ditemukan (' + response.status + ')');
      return response.json();
    }).then(function (data) {
      return data.tracks || [];
    });
  }

  function readTrack(track) {
    if (track.source === 'demo') {
      return fetch(track.file).then(function (response) {
        if (!response.ok) throw new Error('Audio tidak ditemukan (' + response.status + ')');
        return response.arrayBuffer();
      });
    }
    return getUploadBlob(track.uploadId).then(function (blob) {
      if (!blob) throw new Error('File upload tidak ditemukan');
      return blob.arrayBuffer();
    });
  }

  V2.store = {
    openDB: openDB,
    listUploads: listUploads,
    saveUpload: saveUpload,
    deleteUpload: deleteUpload,
    getUploadBlob: getUploadBlob,
    loadManifest: loadManifest,
    readTrack: readTrack
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
