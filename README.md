# TU-PRIMA — Progress Report & Inspection for Mechanic Allocation

Aplikasi monitoring job workshop / recondition mekanik dengan **MySQL/MariaDB sebagai database** (migrasi dari Excel).

Stack: **Next.js 16 · React 19 · NextAuth · TanStack Query · mysql2 · ExcelJS (import/export saja) · Zustand · TypeScript · PWA / IndexedDB (offline) · WebSocket**

---

## Daftar isi

1. [Fitur utama](#fitur-utama)
2. [Alur proses bisnis](#alur-proses-bisnis)
3. [Template time frame (Engine / Non Engine)](#template-time-frame-engine--non-engine)
4. [Mode step: Berurutan vs Parallel](#mode-step-berurutan-vs-parallel)
5. [Timer & sisa estimasi](#timer--sisa-estimasi)
6. [Prioritas job (URGENT / P1 / P2 / P3)](#prioritas-job-urgent--p1--p2--p3)
7. [Archive job (complete / cancel / hapus)](#archive-job-complete--cancel--hapus)
8. [Catatan handover](#catatan-handover-job-aktif)
9. [Catatan peminjaman part](#catatan-peminjaman-part-job-aktif)
10. [Audit trail (siapa melakukan apa)](#audit-trail-siapa-melakukan-apa)
11. [Struktur data (MySQL)](#struktur-data-mysql)
12. [Template JSON & file data](#template-json--file-data)
13. [Autentikasi & hak akses](#autentikasi--hak-akses)
14. [Struktur folder](#struktur-folder)
15. [API ringkas](#api-ringkas)
16. [Menjalankan project](#menjalankan-project)
17. [Deploy production (Hostinger)](#deploy-production-hostinger)
18. [Mode offline (CRUD tanpa server)](#mode-offline-crud-tanpa-server)
19. [Realtime WebSocket](#realtime-websocket)
20. [Kehadiran Meals Request → status teknisi](#kehadiran-meals-request--status-teknisi)
21. [Catatan operasional](#catatan-operasional)

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

- **CRUD job**: buat, edit, hapus (backup ke `job_scope = deleted`), cancel (pindah ke `cancelled`)
- Buat job dari **template time frame** (Component Engine / Non Engine) atau **custom**
- Assign **satu atau lebih teknisi** per job (lead = assignee pertama)
- Start, pause, resume, complete step
- **Complete job** → `job_scope = completed` (keluar dari board aktif). Ditolak jika ada catatan handover yang **DONE** masih **No**
- **Buka kembali** (hanya **superuser**):
  - dari **Job completed** → restore → `paused`
  - dari **Job cancelled** → restore → `paused` / `assigned` / `queued`
- Filter board: All / Job aktif / Antrian / **Job completed** / **Job cancelled**
- **Prioritas job** opsional: `URGENT` / `P1` / `P2` / `P3` (form Create/Edit, pill di kartu, filter Job aktif & Antrian)
- Mode pengerjaan step: **Berurutan** atau **Parallel** (checkbox + start massal)
- Setiap step menampilkan **STP/Std Hours** (`std_minutes` dari template)
- Estimasi di kartu: `Est. N mnt / H jam M mnt · Progress P%` (di bawah deskripsi job)
- **Catatan handover** + loading tambah/ubah (foreman pengendali **atau** teknisi assigned) / hapus (foreman pengendali)
- **Catatan peminjaman part** + loading tambah/ubah (foreman pengendali **atau** teknisi assigned) / hapus (foreman pengendali)
- **Print PDF** per job (modal loading/success/error)
- **Export to excel** (menu Kelola): satu menu → popup pilih Job Aktif / Job Antrian + filter tanggal (create / start / end), kolom **stp_std_hours** + STP per step
- **Backup / Undo** (menu Kelola, **superuser** saja): snapshot perubahan ke tabel `job_change_backups`

### Master data (via menu Kelola)

- **Unit** — CRUD + import Excel + unduh template
- **Teknisi** — CRUD + import Excel + unduh template
- **Template** — CRUD time frame Engine / Non Engine + unduh template Excel + mass upload
- **Users** — CRUD akun login (nama, **email**, **no. telp**, level, aktif)
- **Daftar hadir** — CRUD + import Excel absensi; **Sync Meals Request** (SharePoint Graph atau upload) untuk set **available / offline** pada board teknisi

### Akun

- Login NextAuth (Credentials)
- Edit password sendiri (verifikasi password lama)
- Session menampilkan nama + level

### State UI

- **Server state** (dashboard, master data, mutasi): **TanStack Query** (`src/hooks/`, cache + poll 8s fallback; ping WebSocket saat data berubah)
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
1. Login di /sign-in (wajib untuk dashboard `/`; tautan customer `/?job=…&view=customer` boleh tanpa login)
2. Pastikan master Unit & Teknisi tersedia
3. Buat Job baru
      ├─ Mode template → pilih Engine / Non Engine / GOH → pilih komponen
      │                 (steps + estimasi terisi dari time frame)
      ├─ Mode custom  → isi judul, unit, deskripsi, steps manual
      └─ Prioritas (opsional) → URGENT / P1 / P2 / P3; boleh dikosongkan
4. Assign teknisi (Foreman / Superuser)
5. Start job
6. Kerjakan step (berurutan ATAU parallel)
7. Pause / Resume bila perlu
8. Complete job → job_scope `completed` di MySQL (atau Cancel → `cancelled` / Hapus → `deleted`)
   Syarat complete: setiap handover DONE = Yes (jika ada), plus foto & catatan step yang belum selesai
9. Superuser dapat **Buka kembali** job completed/cancelled dari archive
```

### Status job

| Status        | Arti                                       | Penyimpanan runtime (`jobs.job_scope`) |
| ------------- | ------------------------------------------ | -------------------------------------- |
| `queued`      | Baru dibuat, belum di-assign / belum start | `active`                               |
| `assigned`    | Sudah punya teknisi, siap di-start         | `active`                               |
| `in_progress` | Sedang dikerjakan                          | `active`                               |
| `paused`      | Di-pause (timer job & step di-freeze)      | `active`                               |
| `done`        | Selesai                                    | **`completed`** (setelah Complete)     |
| `cancelled`   | Dibatalkan                                 | **`cancelled`** (setelah Cancel)       |

### Status step

| Status        | Arti                                               |
| ------------- | -------------------------------------------------- |
| `pending`     | Belum dimulai                                      |
| `in_progress` | Sedang aktif (boleh lebih dari satu jika parallel) |
| `done`        | Selesai; `duration_sec` tersimpan                  |

---

## Template time frame (Engine / Non Engine)

Sumber Excel asli disalin ke `data/templates/`, lalu dikonversi ke katalog MySQL:

- MySQL `job_templates` + `job_template_steps` — **sumber runtime**
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

API: `GET /api/job-templates?full=1` (katalog + steps) · `GET /api/job-templates?category=engine|non_engine|goh` · `GET /api/job-templates?id=...` · `GET /api/job-templates?include_inactive=1` (master) · `POST /api/job-templates` · `PATCH|DELETE /api/job-templates/[id]` · `GET /api/job-templates/template` (blank upload) · `POST /api/job-templates/import` · `GET /api/job-templates/download` (export xlsx)

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

| Elemen        | Rumus                                                                     |
| ------------- | ------------------------------------------------------------------------- |
| Timer job     | Wall-clock sejak `started_at`, dikurangi total pause                      |
| Timer step    | Independen per step (`duration_sec` + segmen aktif)                       |
| Sisa estimasi | `estimated_minutes × 60 − elapsed` + **% tersisa**                        |
| STP/Std Hours | `std_minutes` per step (dari template); format `H jam` atau `H jam M mnt` |

### Warna kartu sisa estimasi (teks putih)

| Sisa dari estimasi   | Latar kartu |
| -------------------- | ----------- |
| **≥ 50%**            | Hijau       |
| **> 20% dan < 50%**  | Oranye      |
| **≤ 20% / overtime** | Merah       |

### Warna timer per step (vs STP)

| Sisa dari STP step   | Warna timer |
| -------------------- | ----------- |
| **≥ 50%**            | Putih       |
| **> 20% dan < 50%**  | Oranye      |
| **≤ 20% / overtime** | Merah       |

Pause job: waktu pause **tidak** menambah durasi step (segmen di-freeze ke `duration_sec`).
Reopen/complete **tidak mereset** `started_at` — timer akumulatif tetap dari start awal.
Sync offline memakai `started_at` / `next_started_at` dari client, bukan jam server saat flush (supaya timer step tidak reset ke 00:00:00).

### Web Speech (peringatan sisa estimasi)

Browser membacakan job lewat `speechSynthesis` (`src/lib/remain-alert-sound.ts`). Bukan pengenalan suara.

Hanya **penugas** atau **penerima delegasi** yang mendengarnya, untuk job `in_progress` / `paused`. Job selesai, dibatalkan, atau tanpa estimasi tidak dibacakan. Speaker di navbar bisa dimatikan. Bahasa ID/EN dipilih di panel suara (tersimpan di `localStorage`).

Kali pertama job terlihat, suaranya diam. Setelah itu dibacakan bila:

- masuk oranye (sisa **< 50%** dan **> 20%**) atau merah (**≤ 20%** / waktu habis)
- sisa persen turun lagi sebesar langkah (standar 5%, diatur 1–20%)
- waktu habis (0%), lalu berulang setiap lembur (standar 1 jam, diatur 0,5–24 jam)

---

## Prioritas job (URGENT / P1 / P2 / P3)

Field **Selected Item Priority Job (optional)** di form Create / Edit, tepat di bawah Judul.

| Nilai      | Arti                |
| ---------- | ------------------- |
| _(kosong)_ | Tidak ada prioritas |
| `URGENT`   | Urgent              |
| `P1`       | Priority 1          |
| `P2`       | Priority 2          |
| `P3`       | Priority 3          |

- Tersimpan di kolom **`jobs.priority`** (`VARCHAR(16)`, default `''`)
- Nilai selain daftar di atas diabaikan (dinormalisasi ke kosong)
- Kartu job menampilkan **pill** di samping judul jika prioritas diisi
- PDF dan export Excel ikut kolom `priority`
- Filter dropdown **Filter prioritas** di panel Job berlaku hanya untuk **Job aktif** dan **Antrian** (termasuk slider). Job completed / cancelled tidak tersaring
- Di mobile, bar filter (section + prioritas + penugasan) ditumpuk vertikal agar label/dropdown tidak berdesakan

Migrasi kolom otomatis saat app start (`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS priority …` di `src/db/relational-store.ts`).

API: `POST /api/jobs` dan `PATCH /api/jobs/[id]` menerima `priority` · `GET /api/jobs/list?section=active|queue&priority=URGENT|P1|P2|P3`

---

## Archive job (complete / cancel / hapus)

Job aktif & antrian disimpan di MySQL dengan `job_scope = 'active'`. Complete / cancel / hapus memindahkan baris ke scope terpisah (bukan file Excel terpisah):

| Aksi     | `job_scope` | Efek pada job aktif     | Lihat di UI              | Restore (superuser)                |
| -------- | ----------- | ----------------------- | ------------------------ | ---------------------------------- |
| Complete | `completed` | Keluar dari board aktif | Filter **Job completed** | → `paused`                         |
| Cancel   | `cancelled` | Keluar dari board aktif | Filter **Job cancelled** | → `paused` / `assigned` / `queued` |
| Hapus    | `deleted`   | Keluar; audit tetap     | — (arsip DB)             | Tidak (hanya backup)               |

Setiap baris archive menyimpan meta `archived_at` / `deleted_at` + user pelaku, plus relasi turunan (steps, events, assignees, handovers, part loans).

Arsip memakai id step baru agar tidak bentrok primary key. File foto bukti tetap bernama id step lama. `GET /api/jobs/[id]/steps/[stepId]/photo` membaca foto yang tercatat di baris step itu (nama file tersimpan), bukan menolak hanya karena id step berubah.

Modul: `src/lib/job-completed-archive.ts`, `job-cancelled-archive.ts`, `job-delete-archive.ts` · penyimpanan: `src/db/archive-store.ts`.

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
- **Tambah / Ubah**: foreman pengendali job, atau **teknisi yang di-assign** ke job tersebut
- **Hapus**: hanya foreman pengendali job; level lain (termasuk teknisi) hanya lihat read-only untuk hapus
- Pada job dari archive (`from_archive`), catatan **read-only**
- **Complete job ditolak** jika ada baris handover dengan **DONE = No** (`done !== "1"`). Job tanpa handover tetap bisa selesai. Modal Complete menonaktifkan tombol dan menampilkan daftar handover yang belum Yes
- Tersimpan di tabel **`job_handovers`**; aksi tercatat di **`audit_log`**

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
- **Tambah / Ubah**: foreman pengendali job, atau **teknisi yang di-assign** ke job tersebut
- **Hapus**: hanya foreman pengendali job; archive completed/cancelled = read-only
- Tersimpan di tabel **`job_part_loans`** + **`audit_log`**

API: `POST /api/jobs/[id]/part-loans` · `PATCH|DELETE /api/jobs/[id]/part-loans/[loanId]`

---

## Audit trail (siapa melakukan apa)

Setiap aksi job / assign / progress mencatat **user login** (dari session).

### Tabel `job_events` (timeline job)

Kolom: `id`, `job_id`, `type`, `note`, `created_at`, **`user_id`**, **`user_name`**, **`user_level`**

Jenis event: `created`, `updated`, `assigned`, `started`, `paused`, `resumed`, `step_started`, `step_completed`, `completed`, `cancelled`, `reopened`, …

### Tabel `audit_log` (append-only)

Tetap ada **meski job dihapus**.

| Kolom                                  | Isi                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `at`                                   | timestamp                                                                                                     |
| `user_id` / `user_name` / `user_level` | pelaku                                                                                                        |
| `action`                               | create, update, delete, assign, start, pause, resume, start_steps, complete_step, complete, cancel, reopen, … |
| `entity` / `entity_id`                 | biasanya `job` + id job                                                                                       |
| `detail`                               | ringkasan (judul, unit, status, catatan)                                                                      |

Tercakup: create/update/delete job, assign/ubah teknisi, start/pause/resume/step/complete/cancel/reopen.

### Tabel `job_change_backups` (ChangeLog — untuk undo)

Setiap create / update / delete job, assign, start/pause/resume/step/complete/cancel, handover, dan part loan menyimpan **snapshot JSON sebelum & sesudah** di tabel `job_change_backups` (dulu `backup-jobs.xlsx`).

| Kolom                        | Isi                                               |
| ---------------------------- | ------------------------------------------------- |
| `before_json` / `after_json` | Snapshot data (job bundle / handover / part loan) |
| `user_*`                     | Pelaku                                            |
| `undone`                     | `1` jika sudah di-undo                            |

- UI: menu **Kelola → Backup / Undo** (**superuser** saja)
- API: `GET/POST /api/backups/jobs` (**superuser** saja)
- Undo mengembalikan state `before_json` ke job aktif di MySQL (dan membersihkan arsip complete/cancel bila relevan)

---

## Struktur data (MySQL)

Database: **`tu_prima`** (via `DATABASE_URL`). Schema lengkap: `src/db/schema.sql` · migrasi otomatis: `src/db/relational-store.ts`.

| Tabel                | Isi utama                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `technicians`        | id, name, **sn** (SN), badge_id, status, current_job_id, phone, email                                                                                            |
| `units`              | id, code, name, serial_number, active                                                                                                                            |
| `jobs`               | id, **job_scope**, title, **priority** (`URGENT`/`P1`/`P2`/`P3` atau kosong), unit, status, technician_id, **template_id**, timestamps, pause, estimated_minutes |
| `job_assignees`      | job_id, technician_id, is_lead, assigned_at                                                                                                                      |
| `job_steps`          | job_id, name, order, status, started_at, completed_at, duration_sec, **std_minutes** (STP/Std Hours)                                                             |
| `job_events`         | timeline + **user_id / user_name / user_level**                                                                                                                  |
| `job_handovers`      | catatan serah terima job aktif (order, title, done, note, user)                                                                                                  |
| `job_part_loans`     | catatan peminjaman part (order, part_name, status open/closed, note, user)                                                                                       |
| `attendance`         | date, technician_id, pernr, status, dws, check_in/out, …                                                                                                         |
| `users`              | username, password_hash, name, **email**, **phone**, level, active                                                                                               |
| `audit_log`          | jejak aksi user (tahan delete)                                                                                                                                   |
| `job_change_backups` | snapshot before/after untuk undo                                                                                                                                 |

Detail archive: lihat [Archive job](#archive-job-complete--cancel--hapus).

---

## Template JSON & file data

Runtime job/master/audit/template disimpan di **MySQL**. File Excel di folder `data/templates/` hanya sumber import time frame:

```text
data/
  templates/             ← file Excel time frame sumber (import / referensi)
    TIME FRAME ENGINE RECONDITION.xlsx
    TIME FRAME NON ENGINE RECONDITION (TRANSMISI).xlsx
    Time Frame GOH.xlsx
```

**ExcelJS** dipakai hanya untuk import/export laporan, upload master data, dan unduhan template — bukan database runtime.

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

Login: **NextAuth v5 (Credentials)** · halaman `/sign-in` · error `/auth-gagal` · API session di **`/api/session`** (bukan `/api/auth`, untuk menghindari blok WAF Hostinger).

Akun di tabel **`users`** (kolom `email`, `phone` opsional).  
Seed admin awal dari `.env.local` (`APP_USERNAME` / `APP_PASSWORD`) sebagai `superuser` jika tabel users kosong.

Environment wajib production:

```env
AUTH_SECRET=string-acak-panjang
AUTH_URL=https://prima.strakin.tech
DATABASE_URL=mysql://USER:PASSWORD@srvXXXX.hstgr.io:3306/nama_db
```

`trustHost: true` sudah diset di `auth.config.ts`. Lihat juga [Deploy production](#deploy-production-hostinger).

Level: `superuser`, `inputer`, `teknisi`, `foreman`, `hrd`, `spv` · belum login = `guest`.

### Matriks hak akses

**CRUD** = Create/Read/Update/Delete · **R** = Read · **—** = tidak ada

| Level     | Job  | User | Teknisi | Unit | Template | Daftar Hadir | Assign | Start/Pause/Resume/Step/Complete | Handover write | Reopen |
| --------- | ---- | ---- | ------- | ---- | -------- | ------------ | ------ | -------------------------------- | -------------- | ------ |
| superuser | CRUD | CRUD | CRUD    | CRUD | CRUD     | CRUD         | Ya     | Ya                               | —              | Ya     |
| inputer   | CRUD | R    | R       | CRUD | CRUD     | R            | —      | —                                | —              | —      |
| teknisi   | R    | R    | R       | —    | R        | R            | —      | —                                | Tambah/Ubah*   | —      |
| foreman   | CRUD | R    | R       | CRUD | CRUD     | R            | Ya     | Ya                               | Ya             | —      |
| spv       | CRUD | R    | R       | CRUD | CRUD     | R            | —      | —                                | —              | —      |
| hrd       | R    | R    | R       | R    | R        | CRUD         | —      | —                                | —              | —      |
| guest     | R    | R    | R       | —    | —        | R            | —      | —                                | —              | —      |

Catatan:

- Enforce di **UI** dan **API** (`401` / `403`).
- `guest` & `teknisi` tidak mendapat data Unit di dashboard.
- Minimal satu `superuser` aktif harus tersisa.
- **Handover / peminjaman part Tambah & Ubah**: `foreman` pengendali job, atau `teknisi` yang di-assign ke job tersebut (`*`).
- **Handover / peminjaman part Hapus**: hanya `foreman` pengendali job; level lain tetap bisa melihat tabel read-only.
- **Reopen** (completed/cancelled dari archive) hanya `superuser`.

---

## Struktur folder

```text
server.ts                 ← custom Node server (Next + WebSocket /ws + ensureSchema)
.htaccess                 ← opsional: nonaktifkan ModSecurity di Apache (Hostinger WAF)
src/
  app/
    page.tsx              ← dashboard utama (board, modal, job UI)
    sign-in/page.tsx        ← halaman login
    auth-gagal/page.tsx   ← halaman error NextAuth (custom, hindari WAF)
    api/
      session/[...nextauth]/  ← NextAuth handlers (basePath /api/session)
      …                   ← REST routes (jobs, units, technicians, reports, …)
    globals.css
  auth.ts / auth.config.ts
  lib/
    auth-path.ts          ← AUTH_BASE_PATH = /api/session
    excel.ts              ← logika bisnis + audit + ping WS (via mysql-workbook)
    job-completed-archive.ts
    job-cancelled-archive.ts
    job-delete-archive.ts
    job-change-backup.ts  ← job_change_backups + helpers undo
    job-excel-report.ts   ← export Job Aktif / Antrian
    job-pdf.ts
    job-templates.ts      ← katalog time frame (MySQL job_templates)
    job-template-excel.ts ← export Excel Master Template
    access.ts / permissions.ts
    duration.ts           ← timer & progress
    types.ts
    api.ts                ← fetch helper + error JSON
    query-keys.ts         ← factory key TanStack Query
    offline/              ← outbox IndexedDB, optimistic cache, sync saat online
    realtime/hub.ts       ← hub WS globalThis + broadcast ping
  db/
    schema.sql            ← DDL MySQL
    mysql-workbook.ts     ← pool + load/save ke tabel relasional
    relational-store.ts   ← migrasi & mapping sheet → SQL
    archive-store.ts      ← helper archive/backup di MySQL
  hooks/                  ← useDashboard, master queries, job action + invalidate, useOfflineStatus
  store/                  ← Zustand (job form, assign, board, locale)
  i18n/                   ← kamus ID/EN + useT()
  components/             ← LanguageToggle, OfflineSyncChip, ServiceWorkerRegister, RealtimeBridge
middleware.ts             ← proteksi route: belum login → /sign-in; customer view & /api/* dikecualikan
public/
  sw.js                   ← service worker (app shell + session GET; API data tidak di-cache)
  manifest.webmanifest
scripts/
  hash-user-passwords.ts  ← hash password plain di DB
  seed.ts                 ← seed awal (opsional)
data/
  templates/
```

---

## API ringkas

| Method       | Path                                                              | Keterangan                                                                                                         |
| ------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| \*           | `/api/session/*`                                                  | NextAuth (login, logout, session) — basePath custom                                                                |
| GET          | `/api/dashboard`                                                  | Snapshot board                                                                                                     |
| GET          | `/api/job-templates`                                              | List / detail template (`full=1` katalog + steps; `include_inactive=1` master)                                     |
| POST         | `/api/job-templates`                                              | Buat template time frame                                                                                           |
| PATCH/DELETE | `/api/job-templates/[id]`                                         | Update / soft-delete (nonaktif) template                                                                           |
| GET          | `/api/job-templates/template`                                     | Unduh blank Excel untuk mass upload                                                                                |
| POST         | `/api/job-templates/import`                                       | Mass upload template (sheet Templates + Steps)                                                                     |
| GET          | `/api/job-templates/download`                                     | Export katalog Excel (opsional `id` / `category`)                                                                  |
| POST         | `/api/jobs`                                                       | Buat job (+ `template_id`, `priority` opsional, actor audit)                                                       |
| PATCH/DELETE | `/api/jobs/[id]`                                                  | Update / hapus job (`priority` opsional)                                                                           |
| GET          | `/api/jobs/list?section=&page=&limit=&q=&ownership=&priority=`    | List paginated (filter `priority` hanya active/queue)                                                              |
| POST         | `/api/jobs/[id]/action`                                           | `assign`, `start`, `pause`, `resume`, `start_step`, `start_steps`, `complete_step`, `complete`, `cancel`, `reopen` |
| POST         | `/api/jobs/[id]/handovers`                                        | Tambah catatan handover                                                                                            |
| PATCH/DELETE | `/api/jobs/[id]/handovers/[handoverId]`                           | Update / hapus catatan handover                                                                                    |
| POST         | `/api/jobs/[id]/part-loans`                                       | Tambah catatan peminjaman part                                                                                     |
| PATCH/DELETE | `/api/jobs/[id]/part-loans/[loanId]`                              | Update / hapus catatan peminjaman part                                                                             |
| GET          | `/api/reports/jobs?scope=active\|queue&dateField=&from=&to=`      | Export Excel (+ filter tanggal create/start/end, login)                                                            |
| GET          | `/api/backups/jobs`                                               | List ChangeLog `job_change_backups` (**superuser**)                                                                |
| POST         | `/api/backups/jobs`                                               | Undo satu entri (`{ id }`, **superuser**)                                                                          |
| \*           | `/api/units`, `/api/technicians`, `/api/users`, `/api/attendance` | CRUD + import/template di subpath masing-masing                                                                    |
| POST         | `/api/attendance/sync-sharepoint`                                 | Meals Request → presence: No. ID Badge = SN; ada → available, tidak ada → offline (upload file atau Graph)         |
| POST         | `/api/technicians/sync-sharepoint`                                | _Deprecated_ — sama presence sync; UI di **Daftar Hadir**                                                          |
| POST         | `/api/account/password`                                           | Ganti password sendiri                                                                                             |

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

Pastikan **MySQL atau MariaDB** berjalan lokal (tanpa Docker), lalu buat database (otomatis saat app start / migrasi).

### 2. Environment

Salin `.env.example` → `.env.local`:

```env
AUTH_SECRET=ganti-dengan-string-panjang-acak
AUTH_URL=http://localhost:3000
DATABASE_URL=mysql://root@127.0.0.1:3306/tu_prima
APP_USERNAME=admin
APP_PASSWORD=admin123
```

**Penting:** untuk `npm run dev` lokal, pakai MySQL **lokal** (`127.0.0.1`). Jangan arahkan `.env.local` ke database Hostinger — IP lokal Anda biasanya ditolak oleh Remote MySQL.

Opsional (sync Meals SharePoint): `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `SHAREPOINT_MEALS_EXCEL_URL`.

### 3. Database schema

Schema otomatis dibuat saat pertama kali `npm run dev` atau:

```bash
npm run db:ensure
```

Tabel: `users`, `technicians`, `units`, `jobs`, `job_steps`, `audit_log`, dll. (lihat `src/db/README.md`).

Hash password plain (sekali, jika perlu):

```bash
npm run db:hash-passwords
```

Backup MariaDB:

```bash
mysqldump -u root tu_prima > backup-tu_prima.sql
```

### 4. Dev server

```bash
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000).  
Script ini menjalankan **custom server** (`server.ts`): HTTP Next + WebSocket `ws://host:port/ws`.

### 5. Production (lokal / VPS)

```bash
npm run build
npm start
```

Harus lewat `tsx server.ts` agar WebSocket `/ws` aktif. **`next start` saja tidak menyediakan `/ws`.**

---

## Deploy production (Hostinger)

Production: [https://prima.strakin.tech](https://prima.strakin.tech)

### Environment variables (hPanel → Deployments → Settings)

| Key                             | Contoh / catatan                                                  |
| ------------------------------- | ----------------------------------------------------------------- |
| `AUTH_SECRET`                   | String acak panjang (wajib)                                       |
| `AUTH_URL`                      | `https://prima.strakin.tech`                                      |
| `DATABASE_URL`                  | `mysql://USER:PASSWORD@srv1858.hstgr.io:3306/u925538922_tu_prima` |
| `APP_USERNAME` / `APP_PASSWORD` | Seed superuser jika DB kosong                                     |

**Format `DATABASE_URL`:**

- Hanya connection string di kolom **Value** — jangan ulang `DATABASE_URL=` di value.
- Host MySQL untuk Node.js: **`srvXXXX.hstgr.io`** (bukan `auth-dbXXXX.hstgr.io` yang dipakai phpMyAdmin).
- URL-encode karakter khusus di password (`@`, `&`, `(`, dll.).
- Aktifkan **Remote MySQL** di hPanel jika app dan DB terpisah; untuk deploy Hostinger Node.js biasanya sudah diizinkan internal.

### WAF / ModSecurity

Hostinger WAF sering memblokir path `/login` dan `/api/auth/error`. Project ini memakai:

| Asli (sering diblok)   | Pengganti        |
| ---------------------- | ---------------- |
| `/login`               | `/sign-in`       |
| `/api/auth/*`          | `/api/session/*` |
| error default NextAuth | `/auth-gagal`    |

File `.htaccess` di root (jika tidak ditimpa deploy) menonaktifkan ModSecurity:

```apache
SecFilterEngine Off
SecFilterScanPOST Off
```

### Build & start

Hostinger menjalankan `npm run build` lalu `npm start` (custom server + WebSocket). Setelah deploy, cek login di `/sign-in` dan koneksi realtime antar tab.

### Troubleshooting

| Gejala                         | Kemungkinan penyebab                                                        |
| ------------------------------ | --------------------------------------------------------------------------- |
| 403 di login / auth            | WAF — pastikan path `/sign-in` dan `/api/session`                           |
| "Server configuration" error   | `AUTH_SECRET` atau `DATABASE_URL` kosong/salah                              |
| Data tidak tampil              | `DATABASE_URL` salah host/password; DB belum di-seed                        |
| WebSocket tidak sync antar tab | Pastikan `npm start` (bukan `next start`); hub pakai `globalThis` singleton |

---

## Mode offline (CRUD tanpa server)

App tetap bisa **create / update / delete** (dan aksi progress) meski server atau jaringan mati. Database MySQL di server **tidak berubah** sampai perangkat online lagi dan antrian terkirim.

### Syarat

1. User **sudah buka app + login** saat server masih hidup (sekali cukup).
2. Browser menyimpan: UI (service worker `public/sw.js`), session (10 jam), snapshot dashboard/template (IndexedDB).
3. Buka kembali app dari URL yang sama (LAN / localhost). Kalau belum pernah dibuka, shell & data belum ada → tidak bisa.
4. F5 / ikon Refresh saat offline restore board dari snapshot (localStorage + IndexedDB). Refresh ke server hanya saat online dan outbox kosong.

### Alur

```text
Online  → UI ↔ /api/* ↔ MySQL (tu_prima)
Offline → UI → cache IndexedDB + outbox (antrian mutasi)
Online kembali → flush outbox berurutan → MySQL + audit/backup → refresh board
```

- Chip di topbar: **Offline · N** / **N** pending / error (klik → popover **Coba sync** + Refresh, plus daftar **Akan disinkron**).
- Poll 8 detik **berhenti** saat `navigator.onLine === false`. Item sync gagal (4xx) ditandai di chip merah; item berikutnya menunggu sampai di-retry.
- Hapus handover / peminjaman part yang sudah tidak ada di server dianggap selesai (tidak menggantung antrean dengan "tidak ditemukan").
- **Assign** offline menampilkan nama teknisi dari cache board / pool, bukan daftar kosong.
- **Delegasi** offline memakai daftar foreman yang sudah diambil saat online (disimpan di snapshot). Buka halaman sekali saat online supaya daftar itu ada.
- `npm start` memaksa `NODE_ENV=production` agar route nested (`/api/jobs/[id]/action`, handover, part-loan) tidak 404 saat sync.
- **Tampilan customer**: tautan `/?job={id}&view=customer` (dipakai WhatsApp) menampilkan **hanya job itu** — tanpa navbar, panel teknisi, filter, mode slider, STP/Std Hours, atau tombol aksi. Tautan staff `/?job={id}` (tanpa `view=customer`) tetap membuka board penuh.

### Yang bisa offline

| Bisa di-antrian                                                     | Tetap online-only                              |
| ------------------------------------------------------------------- | ---------------------------------------------- |
| CRUD job, start/pause/resume/step, assign, complete, cancel, reopen | Login baru & ganti password                    |
| Job baru dari **template** (katalog di-cache saat online)           | Import Excel / unduh template / export laporan |
| Handover & peminjaman part                                          | Master **Users** (ada password)                |
| CRUD unit, teknisi, daftar hadir, template                          | Backup / Undo                                  |

Create memakai **ID dari client** (`J-…`, `S-…`, `H-…`, …) agar retry sync tidak dobel. Server **idempotent**: ID yang sama dikembalikan apa adanya.

### Konflik

- Sumber kebenaran setelah sync tetap **MySQL di server**.
- Dua orang edit job yang sama saat offline → yang **terakhir flush** yang menang (last-write-wins).
- `audit_log` / `job_change_backups` tercatat **saat sync sukses**, bukan saat klik offline.

### File terkait

- `src/lib/offline/` — outbox, persist helper, optimistic cache, sync
- `src/lib/api.ts` — gagal jaringan → antri + update board lokal
- `public/sw.js` + `public/manifest.webmanifest` — app shell PWA
- IndexedDB: `tu-prima-offline` (outbox) + `tu-prima-query` (cache TanStack)

---

## Realtime WebSocket

User lain melihat perubahan board **tanpa menunggu poll 8 detik**. Koneksi TCP tetap terbuka (full-duplex); server hanya mengirim **ping kecil**, bukan payload board.

### Alur

```text
Browser A  →  POST /api/...  →  saveMysqlWorkbook / saveCatalog
                                   ↓
                         broadcast { type: "dashboard-changed" }
                                   ↓
Browser B  ←  WebSocket /ws  ←  invalidate + refetch GET /api/dashboard
```

- Hub in-memory: `src/lib/realtime/hub.ts` — **singleton `globalThis`** agar koneksi WS dari `server.ts` dan API route Next.js berbagi client set yang sama (penting di dev & Hostinger).
- Client: `RealtimeBridge` subscribe `ws(s)://<host>/ws`. Pesan `dashboard-changed` → invalidate dashboard + katalog template.
- **Tidak refetch** jika offline atau outbox masih pending (`shouldHoldServerRefresh`) — supaya cache lokal tidak ditimpa data server lama.
- Poll 8 detik tetap jalan sebagai **cadangan** (tab aktif, online, outbox kosong).
- MySQL tetap sumber kebenaran. WS tidak mengganti REST/outbox.

### Syarat

- Server harus `tsx server.ts` (`npm run dev` / `npm start` setelah `npm run build`). `next start` murni **tidak** punya `/ws`.
- Beberapa tab / PC di LAN yang sama: buka URL host yang sama (mis. `http://192.168.x.x:3000`).
- Offline: socket putus; reconnect otomatis saat `online`.

---

---

## Kehadiran Meals Request → status teknisi

Meals Request SharePoint (SHESangatta) **bukan** sumber master teknisi. Master Teknisi tetap diisi manual / mass upload. Meals (atau absensi) dipakai untuk **membandingkan kehadiran** dengan master:

```text
Master Teknisi (SN)  ×  Meals Request (No. ID Badge)
        │
        ├─ Badge/SN ada di meals     → status available  (+ baris Attendance hadir)
        ├─ Badge/SN tidak ada        → status offline
        └─ Teknisi busy (sedang job) → tidak diubah
```

Kunci match: **No. ID Badge = SN / Pernr**.

### Cara pakai (UI)

Menu **Kelola → Daftar Hadir**:

1. **Sync Meals SharePoint** — unduh Excel via Microsoft Graph (butuh `AZURE_*` + `SHAREPOINT_MEALS_EXCEL_URL`), atau
2. **Upload Meals Request (.xlsx)** — hasil unduhan manual / Power Automate / Power Query, atau
3. **Upload absensi** biasa + centang sync status (hadir → available; tidak di file / tidak hadir → offline)

### Environment

```env
AZURE_TENANT_ID=
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=
SHAREPOINT_MEALS_EXCEL_URL=https://tmtgroup.sharepoint.com/:x:/t/SHESangatta/...
```

App Entra: permission application `Files.Read.All` atau `Sites.Read.All` + **admin consent**.  
Tanpa Entra: pakai Power Automate (salin file ke folder) lalu **upload** di Daftar Hadir.

Alias lama `SHAREPOINT_TECH_EXCEL_URL` masih dibaca.

### Catatan file Meals Request

- Kolom wajib: **No. ID Badge**, idealnya juga **Nama Karyawan**
- Sheet sumber lebih baik **Formula** (tab shift sering hanya `FILTER` dari Formula)
  - Parser membaca semua sheet yang punya header badge; mengutamakan sheet bernama Formula

### API

- `POST /api/attendance/sync-sharepoint` — JSON `{}` / `{ "date": "YYYY-MM-DD" }` (Graph) atau `multipart` field `file` (+ opsional `date`)
- `POST /api/attendance/import` + `sync_tech_status=1` — absensi klasik; teknisi yang tidak muncul sebagai hadir di file juga di-set **offline**

---

## Catatan operasional

- Database runtime: **MySQL/MariaDB** (`tu_prima`). Jangan edit langsung di phpMyAdmin saat app sedang menulis — gunakan UI atau backup dulu.
- Jika cache Next rusak (error auth / webpack aneh): hentikan semua `npm run dev`, hapus folder `.next`, jalankan lagi **satu** server.
- Jangan jalankan dua server (`tsx server.ts` / sisa `next dev`) bersamaan di port berbeda pada project yang sama.
- Template time frame diubah lewat **Kelola → Master Template** (tersimpan ke MySQL `job_templates`). Job yang sudah dibuat tidak otomatis ikut berubah.
- Alternatif: edit sumber Excel di `data/templates/` lalu import ulang; restart / refresh setelah ubah katalog.
- Backup rutin: `mysqldump -u root tu_prima > backup.sql` (production: export dari hPanel / phpMyAdmin).
- Dashboard menyertakan job `completed` + `cancelled` dari MySQL (selain job `active`).
- Perubahan data memicu ping WebSocket `{ type: "dashboard-changed" }` ke klien lain (refetch board). Poll 8 detik lewat TanStack Query tetap cadangan, **hanya jika tab aktif** (`refetchIntervalInBackground: false`). Fokus kembali ke tab → refetch otomatis. Start/pause/resume job memakai optimistic update lalu sync ulang ke server. Poll + WS **mati / ditahan** saat browser offline atau outbox pending.
- Offline CRUD: buka + login sekali saat server hidup agar SW/cache terisi. Perubahan lokal ngantri di IndexedDB sampai server nyala. Jangan andalkan login baru atau import Excel saat offline.
- **Meals / kehadiran → board**: lihat [Kehadiran Meals Request → status teknisi](#kehadiran-meals-request--status-teknisi). Sync ada di **Daftar Hadir**, bukan Master Teknisi.
- Service worker hanya cache app shell + `/api/session/session`. **GET `/api/dashboard` tidak di-cache**, supaya assign/CRUD offline tidak ditimpa data lama. Poll/invalidate juga ditahan selama masih ada antrian outbox. Jika UI aneh setelah deploy: DevTools → Application → Service Workers → Unregister, lalu hard refresh.
- Tombol **Refresh** di navbar melakukan full page reload (`window.location.reload()`).

### Ringkasan perubahan terkini

- **Tampilan customer** (`/?job=…&view=customer`): hanya satu job, tanpa navbar / filter / panel teknisi / slider / STP; tautan WhatsApp memakai mode ini; boleh dibuka tanpa login
- **Dashboard `/`**: user belum login dialihkan ke `/sign-in` (kecuali customer view di atas)
- **Complete job** ditolak selama ada handover **DONE = No** (UI + server)
- **Foto job selesai** tetap tampil: foto arsip dibaca dari nama file tersimpan, meski id step di-remint
- **Sync hapus** handover / part loan yang sudah hilang tidak lagi macet di antrean
- **Offline**: assign menampilkan nama teknisi; Delegasi memakai cache foreman; chip sync merinci perubahan yang akan dikirim
- **Web Speech** membacakan peringatan sisa estimasi (oranye/merah, turun persen, habis, lembur) untuk penugas atau penerima delegasi
- **Prioritas job** opsional (`URGENT` / `P1` / `P2` / `P3`): form Create/Edit, kolom `jobs.priority`, pill di kartu, PDF/Excel, filter Job aktif & Antrian; layout filter mobile ditumpuk vertikal
- **Catatan per step** (`job_steps.note`) + ikon/modal di kartu job
- **Delegasi penuh**: hanya foreman terdelegasi + superuser yang mengendalikan job (assigner asli tidak bisa undelegate)
- **MySQL/MariaDB** sebagai database runtime (migrasi dari Excel workbook)
- **Users**: kolom `email` + `phone` di DB dan UI Master User
- **Auth**: login `/sign-in`, session `/api/session`, error `/auth-gagal` (WAF-friendly)
- **WebSocket hub**: singleton `globalThis` — broadcast realtime konsisten di dev & Hostinger
- **TanStack Query**: cache dashboard + master data; poll 8s cadangan + ping WebSocket realtime; optimistic start/pause/resume
- Kartu sisa estimasi: teks putih + persen tersisa · STP/Std Hours per step (UI, PDF, export Excel)
- Export digabung **Export to excel** + filter tanggal · Complete/Cancel/Hapus via `job_scope`
- **Offline CRUD**: persist TanStack Query + outbox mutasi + PWA; ID client idempotent di server

---

## Lisensi / konteks

Project internal monitoring alokasi mekanik & progress recondition component (engine / non-engine).
