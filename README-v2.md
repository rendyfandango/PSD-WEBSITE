# Music Analyzer v2

Versi aplikasi yang lebih sederhana dan siap pakai. Fokusnya: upload musik sendiri,
analisis cepat, lalu coba filter FIR/IIR dan bandingkan hasilnya.

v1 tetap ada di folder `psd-project`.

## Menjalankan

```bat
cd psd-project-v2
start-v2.bat
```

Atau manual:

```bash
python -m http.server 8001
```

Buka `http://localhost:8001/`.

> Jangan buka `index.html` langsung lewat `file://`. Upload dan decode audio
> membutuhkan local server.

## Fitur

- Upload musik sendiri lewat tombol atau drag-and-drop.
- Format mengikuti browser: MP3, WAV, M4A/AAC, OGG, FLAC.
- File upload disimpan di IndexedDB browser, tetap ada setelah reload.
- File tidak dikirim ke server mana pun.
- Library berisi lagu upload dan 6 track demo bawaan.
- Analyze: BPM, beat, RMS, peak, centroid, bass/mid/treble, waveform, dan spektrum.
- Advanced: spectrogram, RMS envelope, onset, kandidat tempo, dan detail fitur.
- Filter: FIR windowed-sinc atau IIR Butterworth, low/high/band-pass, cutoff, tap/orde.
- Player A/B: original dan hasil filter punya player sendiri, plus tombol A/B 4 detik.
- Tombol **Terapkan & dengar** langsung menerapkan filter lalu memutar hasil filter.
- Tombol **Reset** mengembalikan pengaturan filter ke default sekaligus menghapus hasil filter.
- Level playback hasil filter otomatis dinaikkan bila filter membuat suara jauh lebih pelan.
- Compare: original vs FIR vs IIR, tabel ringkas, respons magnitudo, waveform, spektrum, energi pita.
- Unduh laporan CSV/JSON atau cetak ke PDF.

## Catatan

- Analisis dan audio hasil filter memakai 60 detik pertama; player original tetap memutar lagu penuh.
- Audio stereo di-downmix ke mono untuk analisis dan filtering.
- Data upload disimpan lokal di browser. Menghapus data browser juga menghapus file upload.
- Batas upload 80 MB per file.
- Panel teknis (fase, group delay, respons impuls/pole-zero) ada di bagian **Detail teknis**
  pada halaman Filter.
