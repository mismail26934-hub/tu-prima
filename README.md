# TU-PRIMA — Progress Report & Inspection for Mechanic Allocation

Aplikasi monitoring job workshop / recondition mekanik dengan **Excel sebagai database** (`data/workshop.xlsx`).

Stack: **Next.js 16 · React 19 · NextAuth · TanStack Query · ExcelJS · Zustand · TypeScript · PWA / IndexedDB (offline)**

---

## Daftar isi

1. [Fitur utama](#fitur-utama)
2. [Alur proses bisnis](#alur-proses-bisnis)
3. [Template time frame (Engine / Non Engine)](#template-time-frame-engine--non-engine)
4. [Mode step: Berurutan vs Parallel](#mode-step-berurutan-vs-parallel)
5. [Timer & sisa estimasi](#timer--sisa-estimasi)
6. [Archive Excel (complete / cancel / hapus)](#archive-excel-complete--cancel--hapus)
7. [Catatan handover](#catatan-handover-job-aktif)
8. [Catatan peminjaman part](#catatan-peminjaman-part-job-aktif)
9. [Audit trail (siapa melakukan apa)](#audit-trail-siapa-melakukan-apa)
10. [Struktur data Excel](#struktur-data-excel)
11. [Template JSON](#template-json)
12. [Autentikasi & hak akses](#autentikasi--hak-akses)
13. [Struktur folder](#struktur-folder)
14. [API ringkas](#api-ringkas)
15. [Menjalankan project](#menjalankan-project)
16. [Mode offline (CRUD tanpa server)](#mode-offline-crud-tanpa-server)
17. [Catatan operasional](#catatan-operasional)

---

## Fitur utama

### Board & progress

- Board teknisi: **available / busy / offline**
- Board job aktif + antrian, progress %, status job
- Timer live per **job** dan per **step**
- Kartu **sisa estimasi** (estimasi − waktu berjalan) dengan warna status
- Toggle **Light / Dark** mode (tersimpan di browser)
- Toggle bahasa **ID / EN** (tersimpan di browser)
- Panel teknisi / job bisa disembunyikan (preferensi lokal)
- **Mode offline**: CRUD tetap jalan jika server/jaringan mati (salinan lokal + antrian sync)

### Job

- **CRUD job**: buat, edit, hapus (backup ke `deleted-jobs.xlsx`), cancel (pindah ke `cancelled-jobs.xlsx`)
- Buat job dari **template time frame** (Component Engine / Non Engine) atau **custom**
- Assign **satu atau lebih teknisi** per job (lead = assignee pertama)
- Start, pause, resume, complete step
- **Complete job** → pindah penuh ke `completed-jobs.xlsx` (keluar dari `workshop.xlsx`)
- **Buka kembali** (hanya **superuser**):
  - dari **Job completed** → restore → `paused`
  - dari **Job cancelled** → restore → `paused` / `assigned` / `queued`
- Filter board: All / Job aktif / Antrian / **Job completed** / **Job cancelled**
- Mode pengerjaan step: **Berurutan** atau **Parallel** (checkbox + start massal)
- Setiap step menampilkan **STP/Std Hours** (`std_minutes` dari template)
- Estimasi di kartu: `Est. N mnt / H jam M mnt · Progress P%` (di bawah deskripsi job)
- **Catatan handover** + loading tambah/ubah/hapus (foreman write)
- **Catatan peminjaman part** + loading tambah/ubah/hapus (foreman write)
- **Print PDF** per job (modal loading/success/error)
- **Export to excel** (menu Kelola): satu menu → popup pilih Job Aktif / Job Antrian + filter tanggal (create / start / end), kolom **stp_std_hours** + STP per step
- **Backup / Undo** (menu Kelola, **superuser** saja): snapshot perubahan ke `backup-jobs.xlsx`

### Master data (via menu Kelola)

- **Unit** — CRUD + import Excel + unduh template
- **Teknisi** — CRUD + import Excel + unduh template
- **Template** — CRUD time frame Engine / Non Engine + unduh template Excel + mass upload
- **Users** — CRUD akun login (level, aktif)
- **Daftar hadir** — CRUD + import Excel

### Akun

- Login NextAuth (Credentials)
- Edit password sendiri (verifikasi password lama)
- Session menampilkan nama + level

### State UI

- **Server state** (dashboard, master data, mutasi): **TanStack Query** (`src/hooks/`, cache + poll 8s hanya saat tab aktif)
- **Offline**: cache dashboard/template di IndexedDB + outbox mutasi (`src/lib/offline/`)
- Form Assign, Job, board filter: **Zustand** (`src/store/`) — UI only
- Bahasa UI: **Zustand** `localeStore` + kamus `src/i18n/messages.ts` (default `id`)

### Bahasa (ID / EN)

- Toggle bahasa via tombol ikon (satu klik ID ↔ EN), sama pola dengan Light/Dark
- Preferensi disimpan di `localStorage` key `tu-prima-locale`
- Menerjemahkan chrome UI (nav, filter, summary, export, login, timer labels, jam/mnt)
- **Tidak** auto-translate data bisnis (judul job, nama unit, nama step template, status mentah Excel)

---

## Alur proses bisnis

```text
1. Login (opsional untuk lihat; wajib untuk aksi tulis/progress)
2. Pastikan master Unit & Teknisi tersedia
3. Buat Job baru
      ├─ Mode template → pilih Engine / Non Engine → pilih komponen
      │                 (steps + estimasi terisi dari time frame)
      └─ Mode custom  → isi judul, unit, deskripsi, steps manual
4. Assign teknisi (Foreman / Superuser)
5. Start job
6. Kerjakan step (berurutan ATAU parallel)
7. Pause / Resume bila perlu
8. Complete job → arsip `completed-jobs.xlsx` (atau Cancel → `cancelled-jobs.xlsx` / Hapus → `deleted-jobs.xlsx`)
9. Superuser dapat **Buka kembali** job completed/cancelled dari archive
```

### Status job

| Status        | Arti                                       | Penyimpanan runtime                          |
| ------------- | ------------------------------------------ | -------------------------------------------- |
| `queued`      | Baru dibuat, belum di-assign / belum start | `workshop.xlsx`                              |
| `assigned`    | Sudah punya teknisi, siap di-start         | `workshop.xlsx`                              |
| `in_progress` | Sedang dikerjakan                          | `workshop.xlsx`                              |
| `paused`      | Di-pause (timer job & step di-freeze)      | `workshop.xlsx`                              |
| `done`        | Selesai                                    | **`completed-jobs.xlsx`** (setelah Complete) |
| `cancelled`   | Dibatalkan                                 | **`cancelled-jobs.xlsx`** (setelah Cancel)   |

### Status step

| Status        | Arti                                               |
| ------------- | -------------------------------------------------- |
| `pending`     | Belum dimulai                                      |
| `in_progress` | Sedang aktif (boleh lebih dari satu jika parallel) |
| `done`        | Selesai; `duration_sec` tersimpan                  |

---

## Template time frame (Engine / Non Engine)

Sumber Excel asli disalin ke `data/templates/`, lalu dikonversi ke katalog ternormalisasi:

- `data/job-templates.json` — **sumber runtime** (dibaca app)
- `data/templates/*.xlsx` — arsip sumber time frame

### Cara buat job dari template

1. **+ Job baru** → Mode: _Dari time frame_
2. Pilih **Component Engine**, **Component Non Engine (Transmisi)**, atau **GOH**
3. Pilih komponen (contoh: Engine 3306, Transmission 16H,G, GOH OHT 785)
4. Judul, deskripsi, estimasi menit, dan daftar tahapan terisi otomatis
5. Pilih **Unit** → Simpan

Estimasi = jumlah `std_minutes` semua step di template (dari Std Hours / STP × 60).  
Setiap step job menyimpan `std_minutes` dan ditampilkan di kartu sebagai **STP …** (jam/mnt).

### Komponen yang tersedia (saat ini)

**Engine:** 3306, 3406, 3412, C9, C13, C27, 3412 E

**Non Engine (Transmisi):** 24H/M, 16M, 740, 777, 16H/G, 785/789, D10T/R

**GOH:** 16M/16G/16H, 24H/24M, OHT 785, OHT 789, D10T/D10R, ADT 740  
(sumber: `data/templates/Time Frame GOH.xlsx`)

API: `GET /api/job-templates?category=engine|non_engine|goh` · `GET /api/job-templates?id=...` · `GET /api/job-templates?include_inactive=1` (master) · `POST /api/job-templates` · `PATCH|DELETE /api/job-templates/[id]` · `GET /api/job-templates/template` (blank upload) · `POST /api/job-templates/import` · `GET /api/job-templates/download` (export xlsx)

---

## Mode step: Berurutan vs Parallel

Toggle di kartu job (`assigned` / `in_progress`):

### Berurutan (default)

- Tanpa checkbox
- **Start job** → step pertama otomatis aktif
- **Selesai** step → step berikutnya otomatis start
- Jika tidak ada step aktif: tombol **Lanjut step berikutnya** (+ modal)

### Parallel

- Centang beberapa step pending
- **Start terpilih** → satu request; semua step dapat `started_at` **sama** (tanpa jeda)
- **Selesai** per step; **tidak** auto-start next
- Boleh aktif di fase mana pun (Dismantle, Assemble, Test, …)

Semua aksi progress memakai **modal konfirmasi**.

---

## Timer & sisa estimasi

| Elemen           | Rumus                                                |
| ---------------- | ---------------------------------------------------- |
| Timer job        | Wall-clock sejak `started_at`, dikurangi total pause |
| Timer step       | Independen per step (`duration_sec` + segmen aktif)  |
| Sisa estimasi    | `estimated_minutes × 60 − elapsed` + **% tersisa**   |
| STP/Std Hours    | `std_minutes` per step (dari template); format `H jam` atau `H jam M mnt` |

### Warna kartu sisa estimasi (teks putih)

| Sisa dari estimasi  | Latar kartu |
| ------------------- | ----------- |
| **≥ 50%**           | Hijau       |
| **> 20% dan < 50%** | Oranye      |
| **≤ 20% / overtime**| Merah       |

### Warna timer per step (vs STP)

| Sisa dari STP step  | Warna timer |
| ------------------- | ----------- |
| **≥ 50%**           | Putih       |
| **> 20% dan < 50%** | Oranye      |
| **≤ 20% / overtime**| Merah       |

Pause job: waktu pause **tidak** menambah durasi step (segmen di-freeze ke `duration_sec`).  
Reopen/complete **tidak mereset** `started_at` — timer akumulatif tetap dari start awal.

---

## Archive Excel (complete / cancel / hapus)

Job aktif & antrian tetap di **`workshop.xlsx`**. Complete / cancel / hapus memakai file archive terpisah (append):

| Aksi       | File                    | Efek pada workshop              | Lihat di UI              | Restore (superuser)                          |
| ---------- | ----------------------- | ------------------------------- | ------------------------ | -------------------------------------------- |
| Complete   | `completed-jobs.xlsx`   | Dihapus dari workshop           | Filter **Job completed** | → `paused`                                   |
| Cancel     | `cancelled-jobs.xlsx`   | Dihapus dari workshop           | Filter **Job cancelled** | → `paused` / `assigned` / `queued`           |
| Hapus      | `deleted-jobs.xlsx`     | Dihapus; audit tetap            | — (arsip manual)         | Tidak (hanya backup)                         |

Setiap baris archive menyimpan meta `archived_at` / `deleted_at` + user pelaku, plus sheet turunan (steps, events, assignees, handovers, part loans).

Modul: `src/lib/job-completed-archive.ts`, `job-cancelled-archive.ts`, `job-delete-archive.ts`.

---

## Catatan handover (job aktif)

Untuk job `in_progress` / `paused` / `done`, tersedia blok **Catatan handover** (serah terima shift):

| NO  | Job Handover      | Done   | Note     |
| --- | ----------------- | ------ | -------- |
| 1   | Cleaning camshaft | Yes/No | Opsional |

- Pilih aksi **Tambah / Ubah / Hapus** (select) agar UI lebih aman:
  - **Tambah** — field + tombol `+ Tambah` (langsung simpan)
  - **Ubah** — tabel editable + tombol **Save**
  - **Hapus** — tombol Hapus per baris
- Saat proses: **overlay loading** + spinner di tombol (Menambah… / Menyimpan… / Menghapus…)
- **Add / update / delete hanya foreman**; level lain hanya lihat read-only
- Pada job dari archive (`from_archive`), catatan **read-only**
- Tersimpan di sheet **JobHandovers**; aksi tercatat di **AuditLog**

API: `POST /api/jobs/[id]/handovers` · `PATCH|DELETE /api/jobs/[id]/handovers/[handoverId]`

---

## Catatan peminjaman part (job aktif)

Untuk job `in_progress` / `paused` / `done`, tersedia blok **Catatan peminjaman part**:

| NO  | Part yang dipinjam | Status        | Note     |
| --- | ------------------ | ------------- | -------- |
| 1   | Seal kit           | open / closed | Opsional |

- Pola UI sama handover: aksi **Tambah / Ubah / Hapus** + loading overlay
- Status default **open** saat tambah; ubah ke **closed** lewat mode Ubah
- Judul menampilkan jumlah, mis. `Catatan peminjaman part (2)`
- Write hanya **foreman**; archive completed/cancelled = read-only
- Tersimpan di sheet **JobPartLoans** + **AuditLog**

API: `POST /api/jobs/[id]/part-loans` · `PATCH|DELETE /api/jobs/[id]/part-loans/[loanId]`

---

## Audit trail (siapa melakukan apa)

Setiap aksi job / assign / progress mencatat **user login** (dari session).

### Sheet `JobEvents` (timeline job)

Kolom: `id`, `job_id`, `type`, `note`, `created_at`, **`user_id`**, **`user_name`**, **`user_level`**

Jenis event: `created`, `updated`, `assigned`, `started`, `paused`, `resumed`, `step_started`, `step_completed`, `completed`, `cancelled`, `reopened`, …

### Sheet `AuditLog` (append-only)

Tetap ada **meski job dihapus**.

| Kolom                                  | Isi                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `at`                                   | timestamp                                                                                             |
| `user_id` / `user_name` / `user_level` | pelaku                                                                                                |
| `action`                               | create, update, delete, assign, start, pause, resume, start_steps, complete_step, complete, cancel, reopen, … |
| `entity` / `entity_id`                 | biasanya `job` + id job                                                                               |
| `detail`                               | ringkasan (judul, unit, status, catatan)                                                              |

Tercakup: create/update/delete job, assign/ubah teknisi, start/pause/resume/step/complete/cancel/reopen.

### File `backup-jobs.xlsx` (ChangeLog — untuk undo)

Setiap create / update / delete job, assign, start/pause/resume/step/complete/cancel, handover, dan part loan menyimpan **snapshot JSON sebelum & sesudah** di sheet `ChangeLog` file terpisah `data/backup-jobs.xlsx`.

| Kolom | Isi |
|-------|-----|
| `before_json` / `after_json` | Snapshot data (job bundle / handover / part loan) |
| `user_*` | Pelaku |
| `undone` | `1` jika sudah di-undo |

- UI: menu **Kelola → Backup / Undo** (**superuser** saja)
- API: `GET/POST /api/backups/jobs` (**superuser** saja)
- Undo mengembalikan state `before_json` ke `workshop.xlsx` (dan membersihkan arsip complete/cancel bila relevan)

---

## Struktur data Excel

File: **`data/workshop.xlsx`**

| Sheet        | Isi utama                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| Technicians  | id, name, **sn** (SN), status, current_job_id, phone                                                            |
| Units        | id, code, name, active                                                                                              |
| Jobs         | id, title, unit, unit_id, description, status, technician_id, **template_id**, timestamps, pause, estimated_minutes |
| JobAssignees | job_id, technician_id, is_lead, assigned_at                                                                         |
| JobSteps     | job_id, name, order, status, started_at, completed_at, duration_sec, **std_minutes** (STP/Std Hours)                |
| JobEvents    | timeline + **user_id / user_name / user_level**                                                                     |
| JobHandovers | catatan serah terima job aktif (order, title, done, note, user)                                                     |
| JobPartLoans | catatan peminjaman part (order, part_name, status open/closed, note, user)                                          |
| Attendance   | date, technician_id, pernr, status, dws, check_in/out, …                                                            |
| Users        | username, password, name, level, active                                                                             |
| **AuditLog** | jejak aksi user (tahan delete)                                                                                      |

---

## Template JSON

```text
data/
  workshop.xlsx          ← database runtime (aktif, antrian, master, audit)
  completed-jobs.xlsx    ← job setelah Complete (pindah penuh)
  cancelled-jobs.xlsx    ← job setelah Cancel (pindah penuh)
  deleted-jobs.xlsx      ← backup saat Hapus
  backup-jobs.xlsx       ← ChangeLog snapshot before/after (untuk undo)
  job-templates.json     ← katalog template Engine / Non Engine
  templates/             ← file Excel time frame sumber
    TIME FRAME ENGINE RECONDITION.xlsx
    TIME FRAME NON ENGINE RECONDITION (TRANSMISI).xlsx
    Time Frame GOH.xlsx
```

Detail perilaku archive: lihat [Archive Excel](#archive-excel-complete--cancel--hapus).

Struktur ringkas template:

```json
{
  "id": "eng-engine-3306",
  "category": "engine",
  "name": "Engine 3306",
  "std_minutes": 9840,
  "steps": [
    {
      "phase": "Receive",
      "name": "Unpacking",
      "order": 1,
      "std_minutes": 60,
      "man_power": 1
    }
  ]
}
```

---

## Autentikasi & hak akses

Login: **NextAuth (Credentials)** · akun di sheet **Users**.  
Seed admin awal dari `.env.local` (`APP_USERNAME` / `APP_PASSWORD`) sebagai `superuser` jika sheet Users kosong.

Level: `superuser`, `inputer`, `teknisi`, `foreman`, `hrd`, `spv` · belum login = `guest`.

### Matriks hak akses

**CRUD** = Create/Read/Update/Delete · **R** = Read · **—** = tidak ada

| Level     | Job  | User | Teknisi | Unit | Template | Daftar Hadir | Assign | Start/Pause/Resume/Step/Complete | Handover write | Reopen |
| --------- | ---- | ---- | ------- | ---- | -------- | ------------ | ------ | -------------------------------- | -------------- | ------ |
| superuser | CRUD | CRUD | CRUD    | CRUD | CRUD     | CRUD         | Ya     | Ya                               | —              | Ya     |
| inputer   | CRUD | R    | R       | CRUD | CRUD     | R            | —      | —                                | —              | —      |
| teknisi   | R    | R    | R       | —    | R        | R            | —      | —                                | —              | —      |
| foreman   | CRUD | R    | R       | CRUD | CRUD     | R            | Ya     | Ya                               | Ya             | —      |
| spv       | CRUD | R    | R       | CRUD | CRUD     | R            | —      | —                                | —              | —      |
| hrd       | R    | R    | R       | R    | R        | CRUD         | —      | —                                | —              | —      |
| guest     | R    | R    | R       | —    | —        | R            | —      | —                                | —              | —      |

Catatan:

- Enforce di **UI** dan **API** (`401` / `403`).
- `guest` & `teknisi` tidak mendapat data Unit di dashboard.
- Minimal satu `superuser` aktif harus tersisa.
- **Handover write** (add/update/delete) hanya `foreman`; level lain tetap bisa melihat tabel read-only.
- **Reopen** (completed/cancelled dari archive) hanya `superuser`.

---

## Struktur folder

```text
src/
  app/
    page.tsx              ← dashboard utama (board, modal, job UI)
    login/page.tsx
    api/                  ← REST routes (jobs, units, technicians, reports, …)
    globals.css
  auth.ts / auth.config.ts
  lib/
    excel.ts              ← baca/tulis Excel + jobAction + audit
    job-completed-archive.ts
    job-cancelled-archive.ts
    job-delete-archive.ts
    job-change-backup.ts  ← backup-jobs.xlsx ChangeLog + helpers
    job-excel-report.ts   ← export Job Aktif / Antrian
    job-pdf.ts
    job-templates.ts      ← katalog time frame (CRUD + cache)
    job-template-excel.ts ← export Excel Master Template
    access.ts / permissions.ts
    duration.ts           ← timer & progress
    types.ts
    api.ts                ← fetch helper + error JSON
    query-keys.ts         ← factory key TanStack Query
    offline/              ← outbox IndexedDB, optimistic cache, sync saat online
  hooks/                  ← useDashboard, master queries, job action + invalidate, useOfflineStatus
  store/                  ← Zustand (job form, assign, board, locale)
  i18n/                   ← kamus ID/EN + useT()
  components/             ← LanguageToggle, OfflineSyncChip, ServiceWorkerRegister
middleware.ts             ← proteksi route + guest boleh /
public/
  sw.js                   ← service worker (app shell + session GET; API data tidak di-cache)
  manifest.webmanifest
data/
  workshop.xlsx
  completed-jobs.xlsx
  cancelled-jobs.xlsx
  deleted-jobs.xlsx
  job-templates.json
  templates/
```

---

## API ringkas

| Method       | Path                                                              | Keterangan                                                                                               |
| ------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| GET          | `/api/dashboard`                                                  | Snapshot board                                                                                           |
| GET          | `/api/job-templates`                                              | List / detail template (`include_inactive=1` untuk master)                                               |
| POST         | `/api/job-templates`                                              | Buat template time frame                                                                                 |
| PATCH/DELETE | `/api/job-templates/[id]`                                         | Update / soft-delete (nonaktif) template                                                                 |
| GET          | `/api/job-templates/template`                                     | Unduh blank Excel untuk mass upload                                                                      |
| POST         | `/api/job-templates/import`                                       | Mass upload template (sheet Templates + Steps)                                                           |
| GET          | `/api/job-templates/download`                                     | Export katalog Excel (opsional `id` / `category`)                                                        |
| POST         | `/api/jobs`                                                       | Buat job (+ `template_id`, actor audit)                                                                  |
| PATCH/DELETE | `/api/jobs/[id]`                                                  | Update / hapus job                                                                                       |
| POST         | `/api/jobs/[id]/action`                                           | `assign`, `start`, `pause`, `resume`, `start_step`, `start_steps`, `complete_step`, `complete`, `cancel`, `reopen` |
| POST         | `/api/jobs/[id]/handovers`                                        | Tambah catatan handover                                                                                  |
| PATCH/DELETE | `/api/jobs/[id]/handovers/[handoverId]`                           | Update / hapus catatan handover                                                                          |
| POST         | `/api/jobs/[id]/part-loans`                                       | Tambah catatan peminjaman part                                                                           |
| PATCH/DELETE | `/api/jobs/[id]/part-loans/[loanId]`                              | Update / hapus catatan peminjaman part                                                                   |
| GET          | `/api/reports/jobs?scope=active\|queue&dateField=&from=&to=`      | Export Excel (+ filter tanggal create/start/end, login)                                                  |
| GET          | `/api/backups/jobs`                                               | List ChangeLog `backup-jobs.xlsx` (**superuser**)                                                       |
| POST         | `/api/backups/jobs`                                               | Undo satu entri (`{ id }`, **superuser**)                                                               |
| \*           | `/api/units`, `/api/technicians`, `/api/users`, `/api/attendance` | CRUD + import/template di subpath masing-masing                                                          |
| POST         | `/api/account/password`                                           | Ganti password sendiri                                                                                   |

Payload progress penting:

- `step_mode`: `sequential` | `parallel`
- `auto_start_first` / `auto_next` untuk mode berurutan
- `step_ids[]` untuk start parallel massal

---

## Menjalankan project

### 1. Install

```bash
npm install
```

### 2. Environment

Salin `.env.example` → `.env.local`:

```env
AUTH_SECRET=ganti-dengan-string-panjang-acak
APP_USERNAME=admin
APP_PASSWORD=admin123
```

### 3. Dev server

```bash
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000) (atau port lain jika 3000 terpakai).

### 4. Seed Excel (opsional)

```bash
npm run seed
```

File Excel dibuat otomatis di `data/workshop.xlsx` saat pertama diakses jika belum ada.

### 5. Production

```bash
npm run build
npm start
```

---

## Mode offline (CRUD tanpa server)

App tetap bisa **create / update / delete** (dan aksi progress) meski server atau jaringan mati. Excel di server **tidak berubah** sampai perangkat online lagi dan antrian terkirim.

### Syarat

1. User **sudah buka app + login** saat server masih hidup (sekali cukup).
2. Browser menyimpan: UI (service worker `public/sw.js`), session (10 jam), snapshot dashboard/template (IndexedDB).
3. Buka kembali app dari URL yang sama (LAN / localhost). Kalau belum pernah dibuka, shell & data belum ada → tidak bisa.

### Alur

```text
Online  → UI ↔ /api/* ↔ workshop.xlsx
Offline → UI → cache IndexedDB + outbox (antrian mutasi)
Online kembali → flush outbox berurutan → Excel + audit/backup → refresh board
```

- Chip di topbar: **Offline · N** / **N** pending / error (klik → popover **Coba sync** + Refresh).
- Poll 8 detik **berhenti** saat `navigator.onLine === false`. Item sync gagal (4xx) ditandai di chip merah; item berikutnya menunggu sampai di-retry.

### Yang bisa offline

| Bisa di-antrian | Tetap online-only |
| --- | --- |
| CRUD job, start/pause/resume/step, assign, complete, cancel, reopen | Login baru & ganti password |
| Handover & peminjaman part | Import Excel / unduh template / export laporan |
| CRUD unit, teknisi, daftar hadir, template | Master **Users** (ada password) |
| | Backup / Undo |

Create memakai **ID dari client** (`J-…`, `S-…`, `H-…`, …) agar retry sync tidak dobel. Server **idempotent**: ID yang sama dikembalikan apa adanya.

### Konflik

- Sumber kebenaran setelah sync tetap **Excel di server**.
- Dua orang edit job yang sama saat offline → yang **terakhir flush** yang menang (last-write-wins).
- AuditLog / `backup-jobs.xlsx` tercatat **saat sync sukses**, bukan saat klik offline.

### File terkait

- `src/lib/offline/` — outbox, persist helper, optimistic cache, sync
- `src/lib/api.ts` — gagal jaringan → antri + update board lokal
- `public/sw.js` + `public/manifest.webmanifest` — app shell PWA
- IndexedDB: `tu-prima-offline` (outbox) + `tu-prima-query` (cache TanStack)

---

## Catatan operasional

- Excel cocok untuk **demo / workshop kecil**. Hindari membuka & menyimpan file `data/*.xlsx` di Excel saat app sedang menulis.
- Jika cache Next rusak (error auth / webpack aneh): hentikan semua `npm run dev`, hapus folder `.next`, jalankan lagi **satu** server.
- Jangan jalankan dua `next dev` bersamaan di port berbeda pada project yang sama.
- Template time frame diubah lewat **Kelola → Master Template** (tersimpan ke `data/job-templates.json`). Job yang sudah dibuat tidak otomatis ikut berubah.
- Alternatif: edit sumber Excel di `data/templates/` lalu regenerate katalog bila ada skrip parse; restart / refresh setelah ubah file.
- `data/*.xlsx` biasanya di-ignore git; backup `workshop.xlsx`, `completed-jobs.xlsx`, `cancelled-jobs.xlsx`, `deleted-jobs.xlsx` jika data penting.
- Dashboard menyertakan `completed_jobs` + `cancelled_jobs` dari file archive (selain `jobs` dari workshop).
- Board di-poll setiap **8 detik** lewat TanStack Query, **hanya jika tab aktif** (`refetchIntervalInBackground: false`) agar Excel tidak di-hit saat window di belakang. Fokus kembali ke tab → refetch otomatis. Start/pause/resume job memakai optimistic update lalu sync ulang ke server. Poll **mati** saat browser offline.
- Offline CRUD: buka + login sekali saat server hidup agar SW/cache terisi. Perubahan lokal ngantri di IndexedDB sampai server nyala. Jangan andalkan login baru atau import Excel saat offline.
- Service worker hanya cache app shell + `/api/auth/session`. **GET `/api/dashboard` tidak di-cache**, supaya assign/CRUD offline tidak ditimpa data lama. Poll/invalidate juga ditahan selama masih ada antrian outbox. Jika UI aneh setelah deploy: DevTools → Application → Service Workers → Unregister, lalu hard refresh.

### Ringkasan perubahan UI/data terkini

- **TanStack Query**: cache dashboard + master data; poll 8s hanya tab aktif; optimistic start/pause/resume
- Kartu sisa estimasi: teks putih + persen tersisa
- STP/Std Hours per step (UI, PDF, export Excel)
- Timer step berwarna menurut sisa STP (putih / oranye / merah)
- Status + Est/Progress ditampilkan di bawah deskripsi job
- Export digabung jadi **Export to excel** + filter tanggal
- Complete / Cancel / Hapus memakai archive Excel terpisah; reopen completed & cancelled (superuser)
- Loading overlay pada tambah/ubah/hapus handover & part loan
- **Offline CRUD**: persist TanStack Query + outbox mutasi + PWA; create job/handover/unit memakai ID client yang idempotent di server

---

## Lisensi / konteks

Project internal monitoring alokasi mekanik & progress recondition component (engine / non-engine).
