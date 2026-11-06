# Apex Circuit

Balap top-down untuk videotron. Satu browser menampilkan lintasan Neon Loop. Satu sampai empat pemain masuk lewat QR dan memakai HP sebagai controller. Balapan berlangsung tiga putaran dengan batas 90 detik. Mobil yang belum finis saat waktu habis mendapat DNF.

## Coba latihan sekarang

1. Ekstrak ZIP dan buka terminal di folder yang berisi `index.html`.
2. Jalankan `python -m http.server 8080 --bind 127.0.0.1`. Di Windows, gunakan `py` jika perintah `python` tidak tersedia.
3. Buka [http://127.0.0.1:8080/](http://127.0.0.1:8080/) dan pilih **Coba latihan**. Pakai **WASD** atau **tombol panah** untuk melawan tiga bot. **Spasi** juga bisa dipakai sebagai rem ketika fokus berada di luar tombol atau tautan.

Latihan bekerja tanpa konfigurasi Firebase dan tanpa koneksi internet. Sajikan file lewat HTTP atau HTTPS agar browser bisa memuat modul JavaScript.

## Siapkan Firebase

1. Buat proyek khusus game di [Firebase Console](https://console.firebase.google.com/). Daftarkan aplikasi **Web** dari **Project settings → General → Your apps**.
2. Buka **Authentication → Sign-in method**, aktifkan **Anonymous**, lalu simpan. Bila host GitHub Pages belum tercantum di **Authentication → Settings → Authorized domains**, tambahkan `NAMA-AKUN.github.io` tanpa protokol atau nama repo.
3. Buat **Realtime Database** dalam **Locked mode**. Salin URL dari tab **Data**. Gunakan alamat persis dari konsol karena domain URL berbeda menurut lokasi database.
4. Buka `js/firebase-config.js`. Ganti nilai contoh dengan konfigurasi aplikasi Web dari langkah 1, termasuk `databaseURL` dari langkah 3.
5. Pada **Realtime Database → Rules**, tempel isi `database.rules.json` dan klik **Publish**. File aturan ini mendefinisikan seluruh aturan database, jadi gunakan instance yang dikhususkan untuk game. Simpan perubahan aturan di Firebase dan kode frontend di GitHub.

Konfigurasi Web Firebase boleh dimuat oleh browser. Simpan kredensial admin dan file service account di luar repo. [Dokumentasi setup Web](https://firebase.google.com/docs/web/setup) · [Anonymous Auth](https://firebase.google.com/docs/auth/web/anonymous-auth) · [Realtime Database Rules](https://firebase.google.com/docs/database/security)

## Deploy ke GitHub Pages

1. Buat repo GitHub dengan cabang `main`, lalu unggah **isi** folder proyek ke root repo. Pastikan `index.html`, `controller.html`, `.nojekyll`, dan folder `assets`, `css`, `js`, serta `vendor` berada di tingkat yang benar. Sertakan aturan dan tes bila ingin menjalankan verifikasi dari repo.
2. Buka **Settings → Pages**. Pilih **Deploy from a branch**, lalu pilih **main** dan **/ (root)**. Simpan dan tunggu URL Pages muncul.
3. Buka `https://NAMA-AKUN.github.io/NAMA-REPO/` dan aktifkan **Enforce HTTPS** di pengaturan Pages jika tersedia. Dari alamat ini, QR otomatis memuat URL controller dengan subfolder repo dan kode lobby yang tepat.

Proyek ini memakai HTML, CSS, dan JavaScript sebagai file statis. GitHub Pages dapat menyajikannya langsung. [Panduan sumber publikasi GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## Jalankan acara

1. Buka situs HTTPS di komputer yang tersambung ke videotron. Pilih **Layar penuh**, lalu **Buat lobby**.
2. Peserta scan QR dengan kamera HP, masukkan nama, lalu pilih **Gabung balapan**. Alternatifnya, host bisa menyalin link undangan. Kode dari layar juga bisa dimasukkan di `controller.html`.
3. Di HP, pilih **Tilt** dan izinkan akses sensor bila diminta. Pegang HP pada posisi setir tengah saat sensor mulai terbaca. Jika setir menarik ke satu sisi, ketuk **Kalibrasi posisi tengah**. **Gas** dan **Rem** selalu memakai tombol layar. Jika sensor tidak mengirim data atau izin ditolak, controller kembali ke mode **Sentuh** dengan panah kiri dan kanan.
4. Tunggu indikator **SIAP** di layar host, lalu pilih **Mulai balapan**. Host bisa memulai dengan minimal satu controller yang siap. Slot terkunci sampai ronde selesai.
5. Setelah podium, pilih **Balapan lagi** untuk membuka lobby dengan pemain yang sama. Host bisa melepas slot terputus melalui **×** saat lobby terbuka. Gunakan **Tutup lobby** setelah acara.

Jaga halaman host tetap terlihat dan layar HP tetap aktif. Jika HP terputus, input lama kedaluwarsa setelah sekitar 1,25 detik. Controller yang dibuka kembali dari tab yang sama bisa melanjutkan dengan identitas sesi yang sama. Jika halaman host dimuat ulang saat ronde berjalan, pilih **Buka ulang lobby** untuk mengulang ronde. Lobby kedaluwarsa setelah empat jam.

Untuk tilt, buka URL HTTPS di browser HP. **Sentuh** juga berfungsi tanpa sensor. QR yang dibuat dari `localhost` hanya cocok untuk uji di komputer yang sama. Gunakan URL GitHub Pages untuk scan dari HP. [Spesifikasi Device Orientation](https://www.w3.org/TR/orientation-event/)

## Uji sebelum acara

### Tes otomatis

Dengan Node.js 22 atau yang lebih baru, jalankan dari root proyek. Kedua tes memakai modul bawaan Node.js.

```sh
npm test
```

Untuk menguji aturan secara nyata, siapkan Firebase CLI dan Java 21, lalu jalankan emulator di terminal pertama.

```sh
firebase emulators:start --only auth,database --project demo-apex-circuit
```

Di terminal kedua, jalankan:

```sh
npm run test:rules
```

Tes aturan membuat identitas anonim di emulator dan memeriksa klaim slot serentak, penolakan pemain kelima, perubahan input antarpemain, validasi data, hak host, serta penutupan lobby. Gunakan [panduan Local Emulator Suite](https://firebase.google.com/docs/emulator-suite/install_and_configure) untuk memasang CLI dan Java.

### Uji browser

1. Dengan emulator dan server lokal aktif, buka `http://127.0.0.1:8080/?emulator=1`. Parameter emulator hanya diterima di loopback. Browser tetap memerlukan internet untuk memuat SDK Firebase dari CDN saat uji online.
2. Buat lobby. Buka link undangan di empat sesi browser terpisah, isi nama, lalu cek bahwa layar host menampilkan **4 siap**. Coba pemain kelima.
3. Mulai balapan. Di controller desktop, tombol **WASD** dan **panah** juga dapat dipakai. Coba tahan gas dan belok bersamaan, lepas tombol, muat ulang satu controller, dan cek hasil serta ronde ulang.
4. Di URL Pages, ulangi dengan HP asli. Coba scan QR dari jarak penonton, izin tilt di Safari iOS dan Chrome Android yang akan digunakan, kalibrasi, dan mode sentuh. Saat uji dengan lebih dari satu perangkat, cek juga respons lewat jaringan tempat acara.

## Struktur dan akses

| File atau folder | Isi |
| --- | --- |
| `index.html`, `controller.html` | Layar videotron dan controller HP |
| `css/`, `assets/` | Tampilan responsif dan ikon |
| `js/physics.js`, `js/renderer.js` | Simulasi, checkpoint, peringkat, dan lintasan Canvas |
| `js/host.js`, `js/controller.js` | Lobby, tampilan hasil, tilt, touch, dan pengiriman input |
| `js/firebase.js`, `js/firebase-config.js` | Klien Firebase dan konfigurasi proyek |
| `database.rules.json`, `firebase.json` | Aturan akses RTDB dan pengaturan emulator |
| `tests/` | Tes mesin game dan aturan database |
| `vendor/` | QR generator lokal dan lisensi MIT |

Di database, `races/{kode}/meta` menyimpan status, ronde, waktu, dan hasil. `races/{kode}/seats/s0` sampai `s3` menyimpan identitas pemain dan input terakhir. Rules menolak akses anonim tanpa sesi Auth, penelusuran daftar lobby, perubahan fase oleh pemain, klaim lebih dari satu slot per UID, dan penulisan input milik UID lain. Input tervalidasi berdasarkan rentang, waktu, serta nomor ronde. QR dan kode 10 karakter menjadi akses undangan, jadi tampilkan kode hanya untuk audiens acara. Hindari memakai nama lengkap peserta di layar publik.

Host menjalankan simulasi dan menerbitkan hasil dari browser. Sistem ini mempercayai host acara. Gunakan **Tutup lobby** untuk menghapus data ronde dan slot. Jika host kehilangan sesi sebelum menutupnya, hapus lobby lama dari konsol Firebase setelah acara. Batas waktu empat jam menutup akses pemain dan penulisan input, sementara data lama tetap tersimpan hingga dihapus.

Gambar QR dibuat di browser menggunakan [qrcode-generator 2.0.4](https://github.com/kazuhikoarase/qrcode-generator). Lisensi QR disertakan di `vendor/LICENSE-qrcode.txt`.
