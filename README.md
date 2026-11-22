# ❄️ SnowyChat v2 — Next.js full-stack

Panel kendali bot Minecraft AFK: **Next.js (App Router) + Tailwind v4 + Socket.IO + Mineflayer** dalam satu proses.

## Menjalankan

```bash
node index.js            # production: install + build otomatis bila perlu, lalu start
node index.js --dev      # development (HMR + restart otomatis saat server/ berubah)
node index.js --rebuild  # paksa build ulang
```

`index.js` otomatis: cek Node ≥ 22 → `npm install` bila dependency belum ada → `npm run build` bila build belum ada/usang → start server.
Matikan otomatisasi dengan `--no-auto` atau `SNOWY_AUTO_SETUP=0`. Cara manual: `npm install && npm run build && npm start`.

## Migrasi dari versi lama
Salin ke folder ini: `.env` dan `sessions.db` (sesi tersimpan ikut terbawa). Versi yang tersimpan di sesi dipertahankan. Variabel baru ada di `.env.example`.

## Update dependency (termasuk mineflayer)
```bash
npm run deps:check     # tabel versi terpasang vs terbaru + versi Minecraft yang didukung mineflayer
npm run deps:update    # install @latest semua paket, lalu jalankan verify (lint, typecheck, test, build)
```

## Struktur
```
index.js            entry: auto install/build → server.mjs
server.mjs          HTTP + Next + Socket.IO + BotManager
server/             logika backend (db, botManager, features/, socket, validators, discord, …)
src/app/            Next.js App Router (layout, page, error, manifest, /api/health)
src/components/     UI dipecah per tab/kartu; tab berat di-lazy-load (next/dynamic)
src/lib/            store (selector-based), bridge Socket.IO, tipe, helper
tests/              node:test — server, kontrak klien↔server, regresi bug
scripts/deps.mjs    cek/update dependency
```

## Keamanan
- Set `ACCESS_TOKEN` di `.env` bila port bisa dijangkau dari luar; buka UI sekali dengan `http://host:port/#token=...`.
- WebSocket memeriksa header Origin (mencegah situs lain mengendalikan bot lewat browser Anda).
- Semua payload divalidasi; payload rusak tidak lagi bisa menjatuhkan proses.
- `BIND_HOST=127.0.0.1` untuk akses lokal saja.

## Perintah
`npm run lint` · `npm run typecheck` · `npm test` · `npm run build` · `npm run verify` (semuanya).

## Hosting di panel (Pterodactyl / HidenCloud)
Isi `.env` (atau Startup variables):
```
PORT=24581                       # port allocation dari panel (biasanya sudah di-set otomatis)
BIND_HOST=0.0.0.0                # JANGAN 127.0.0.1, panel tidak akan bisa mengakses
PUBLIC_URL=http://jacob.hidencloud.com:24581
ACCESS_TOKEN=isi_token_rahasia   # sangat disarankan
```
Buka `http://jacob.hidencloud.com:24581/#token=isi_token_rahasia` sekali (token tersimpan di browser).
Command startup: `node index.js`. Pesan "6 moderate vulnerabilities" dari npm tidak perlu ditangani dengan `npm audit fix --force`.

## `PartialReadError` / inventory kosong
Artinya server memakai protokol yang lebih baru dari yang bisa dibaca mineflayer (bot tetap online). Solusi, urut:
1. Isi `DEFAULT_MC_VERSION=1.21.1` di `.env` (atau isi kolom Version lewat Edit Session) — server ViaVersion biasanya menerima ini.
2. `npm run deps:update` untuk mineflayer terbaru, lalu coba kosongkan lagi versinya.
Set `SHOW_PROTOCOL_ERRORS=true` hanya untuk debugging.
