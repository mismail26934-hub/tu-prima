# TU-PRIMA — Progress Report & Inspection for Mechanic Allocation

Aplikasi monitoring job workshop / recondition mekanik dengan **Excel sebagai database** (`data/workshop.xlsx`).

Stack: **Next.js 15 · React 19 · NextAuth · ExcelJS · Zustand · TypeScript**

---

## Daftar isi

1. [Fitur utama](#fitur-utama)
2. [Alur proses bisnis](#alur-proses-bisnis)
3. [Template time frame (Engine / Non Engine)](#template-time-frame-engine--non-engine)
4. [Mode step: Berurutan vs Parallel](#mode-step-berurutan-vs-parallel)
5. [Timer & sisa estimasi](#timer--sisa-estimasi)
6. [Catatan handover](#catatan-handover-job-aktif)
7. [Catatan peminjaman part](#catatan-peminjaman-part-job-aktif)
8. [Audit trail (siapa melakukan apa)](#audit-trail-siapa-melakukan-apa)
9. [Struktur data Excel](#struktur-data-excel)
10. [Template JSON](#template-json)
11. [Autentikasi & hak akses](#autentikasi--hak-akses)
12. [Struktur folder](#struktur-folder)
13. [API ringkas](#api-ringkas)
14. [Menjalankan project](#menjalankan-project)
15. [Catatan operasional](#catatan-operasional)

---

## Fitur utama

### Board & progress

- Board teknisi: **available / busy / offline**
- Board job aktif + antrian, progress %, status job
- Timer live per **job** dan per **step**
- Kartu **sisa estimasi** (estimasi − waktu berjalan) dengan warna status
- Toggle **Light / Dark** mode (tersimpan di browser)
- Panel teknisi / job bisa disembunyikan (preferensi lokal)

### Job

- **CRUD job**: buat, edit, hapus, cancel
- Buat job dari **template time frame** (Component Engine / Non Engine) atau **custom**
- Assign **satu atau lebih teknisi** per job (lead = assignee pertama)
- Start, pause, resume, complete step, complete job
- Mode pengerjaan step: **Berurutan** atau **Parallel** (checkbox + start massal)
- **Catatan handover** pada job aktif: tabel NO / Job Handover / Done / Note
- **Catatan peminjaman part** pada job aktif: NO / Part yang dipinjam / Status (open|closed) / Note
- **Print PDF** per job: ringkasan job, teknisi, steps, handover, peminjaman part
- **Export Excel** (menu Kelola): **Export Job Aktif** / **Export Job Antrian** — file terpisah, 1 sheet detail lengkap per file

### Master data (via menu Kelola)

- **Unit** — CRUD + import Excel + unduh template
- **Teknisi** — CRUD + import Excel + unduh template
- **Users** — CRUD akun login (level, aktif)
- **Daftar hadir** — CRUD + import Excel

### Akun

- Login NextAuth (Credentials)
- Edit password sendiri (verifikasi password lama)
- Session menampilkan nama + level

### State UI

- Form Assign, Job, board filter: **Zustand** (`src/store/`)

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
8. Complete job (atau Cancel / Hapus)
```

### Status job

| Status        | Arti                                       |
| ------------- | ------------------------------------------ |
| `queued`      | Baru dibuat, belum di-assign / belum start |
| `assigned`    | Sudah punya teknisi, siap di-start         |
| `in_progress` | Sedang dikerjakan                          |
| `paused`      | Di-pause (timer job & step di-freeze)      |
| `done`        | Selesai                                    |
| `cancelled`   | Dibatalkan                                 |

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
2. Pilih **Component Engine** atau **Component Non Engine (Transmisi)**
3. Pilih komponen (contoh: Engine 3306, Transmission 16H,G)
4. Judul, deskripsi, estimasi menit, dan daftar tahapan terisi otomatis
5. Pilih **Unit** → Simpan

Estimasi = jumlah `std_minutes` semua step di template (dari Std Hours / STP × 60).

### Komponen yang tersedia (saat ini)

**Engine:** 3306, 3406, 3412, C9, C13, C27, 3412 E

**Non Engine (Transmisi):** 24H/M, 16M, 740, 777, 16H/G, 785/789, D10T/R

API: `GET /api/job-templates?category=engine|non_engine` · `GET /api/job-templates?id=...`

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

| Elemen        | Rumus                                                |
| ------------- | ---------------------------------------------------- |
| Timer job     | Wall-clock sejak `started_at`, dikurangi total pause |
| Timer step    | Independen per step (`duration_sec` + segmen aktif)  |
| Sisa estimasi | `estimated_minutes × 60 − elapsed`                   |

### Warna kartu sisa estimasi

| Sisa dari estimasi  | Warna                      |
| ------------------- | -------------------------- |
| **≥ 50%**           | Hijau — aman               |
| **> 20% dan < 50%** | Oranye — mulai ketat       |
| **≤ 20%**           | Merah — mendesak           |
| **≤ 0 (overtime)**  | Merah — tampil `-HH:MM:SS` |

Pause job: waktu pause **tidak** menambah durasi step (segmen di-freeze ke `duration_sec`).

---

## Catatan handover (job aktif)

Untuk job `in_progress` / `paused` / `done`, tersedia blok **Catatan handover** (serah terima shift):

| NO | Job Handover | Done | Note |
|----|--------------|------|------|
| 1 | Cleaning camshaft | Yes/No | Opsional |

- Pilih aksi **Tambah / Ubah / Hapus** (select) agar UI lebih aman:
  - **Tambah** — field + tombol `+ Tambah` (langsung simpan)
  - **Ubah** — tabel editable + tombol **Save**
  - **Hapus** — tombol Hapus per baris
- **Add / update / delete hanya foreman**; level lain hanya lihat read-only (termasuk pada job `done`)
- Tersimpan di sheet **JobHandovers**; aksi tercatat di **AuditLog**

API: `POST /api/jobs/[id]/handovers` · `PATCH|DELETE /api/jobs/[id]/handovers/[handoverId]`

---

## Catatan peminjaman part (job aktif)

Untuk job `in_progress` / `paused` / `done`, tersedia blok **Catatan peminjaman part**:

| NO | Part yang dipinjam | Status | Note |
|----|--------------------|--------|------|
| 1 | Seal kit | open / closed | Opsional |

- Pola UI sama handover: aksi **Tambah / Ubah / Hapus**
- Status default **open** saat tambah; ubah ke **closed** lewat mode Ubah
- Judul menampilkan jumlah, mis. `Catatan peminjaman part (2)`
- Write hanya **foreman** (juga pada job `done`); level lain read-only
- Tersimpan di sheet **JobPartLoans** + **AuditLog**

API: `POST /api/jobs/[id]/part-loans` · `PATCH|DELETE /api/jobs/[id]/part-loans/[loanId]`

---

## Audit trail (siapa melakukan apa)

Setiap aksi job / assign / progress mencatat **user login** (dari session).

### Sheet `JobEvents` (timeline job)

Kolom: `id`, `job_id`, `type`, `note`, `created_at`, **`user_id`**, **`user_name`**, **`user_level`**

Jenis event: `created`, `updated`, `assigned`, `started`, `paused`, `resumed`, `step_started`, `step_completed`, `completed`, `cancelled`, …

### Sheet `AuditLog` (append-only)

Tetap ada **meski job dihapus**.

| Kolom                                  | Isi                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `at`                                   | timestamp                                                                                             |
| `user_id` / `user_name` / `user_level` | pelaku                                                                                                |
| `action`                               | create, update, delete, assign, start, pause, resume, start_steps, complete_step, complete, cancel, … |
| `entity` / `entity_id`                 | biasanya `job` + id job                                                                               |
| `detail`                               | ringkasan (judul, unit, status, catatan)                                                              |

Tercakup: create/update/delete job, assign/ubah teknisi, start/pause/resume/step/complete/cancel.

---

## Struktur data Excel

File: **`data/workshop.xlsx`**

| Sheet        | Isi utama                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| Technicians  | id, name, **sn** (SN KPC), status, current_job_id, phone                                                            |
| Units        | id, code, name, active                                                                                              |
| Jobs         | id, title, unit, unit_id, description, status, technician_id, **template_id**, timestamps, pause, estimated_minutes |
| JobAssignees | job_id, technician_id, is_lead, assigned_at                                                                         |
| JobSteps     | job_id, name, order, status, started_at, completed_at, duration_sec                                                 |
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
  workshop.xlsx          ← database runtime
  job-templates.json     ← katalog template Engine / Non Engine
  templates/             ← file Excel time frame sumber
    TIME FRAME ENGINE RECONDITION.xlsx
    TIME FRAME NON ENGINE RECONDITION (TRANSMISI).xlsx
```

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

| Level     | Job  | User | Teknisi | Unit | Daftar Hadir | Assign | Start/Pause/Resume/Step/Complete | Handover write |
| --------- | ---- | ---- | ------- | ---- | ------------ | ------ | -------------------------------- | -------------- |
| superuser | CRUD | CRUD | CRUD    | CRUD | CRUD         | Ya     | Ya                               | —              |
| inputer   | CRUD | R    | R       | CRUD | R            | —      | —                                | —              |
| teknisi   | R    | R    | R       | —    | R            | —      | —                                | —              |
| foreman   | CRUD | R    | R       | CRUD | R            | Ya     | Ya                               | Ya             |
| spv       | CRUD | R    | R       | CRUD | R            | —      | —                                | —              |
| hrd       | R    | R    | R       | R    | CRUD         | —      | —                                | —              |
| guest     | R    | R    | R       | —    | R            | —      | —                                | —              |

Catatan:

- Enforce di **UI** dan **API** (`401` / `403`).
- `guest` & `teknisi` tidak mendapat data Unit di dashboard.
- Minimal satu `superuser` aktif harus tersisa.
- **Handover write** (add/update/delete) hanya `foreman`; level lain tetap bisa melihat tabel read-only.

---

## Struktur folder

```text
src/
  app/
    page.tsx              ← dashboard utama (board, modal, job UI)
    login/page.tsx
    api/                  ← REST routes (jobs, units, technicians, …)
    globals.css
  auth.ts / auth.config.ts
  lib/
    excel.ts              ← baca/tulis Excel + jobAction + audit
    job-templates.ts      ← katalog time frame
    access.ts / permissions.ts
    duration.ts           ← timer & progress
    types.ts
  store/                  ← Zustand (job form, assign, board)
middleware.ts             ← proteksi route + guest boleh /
data/
  workshop.xlsx
  job-templates.json
  templates/
```

---

## API ringkas

| Method       | Path                                                              | Keterangan                                                                                               |
| ------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| GET          | `/api/dashboard`                                                  | Snapshot board                                                                                           |
| GET          | `/api/job-templates`                                              | List / detail template                                                                                   |
| POST         | `/api/jobs`                                                       | Buat job (+ `template_id`, actor audit)                                                                  |
| PATCH/DELETE | `/api/jobs/[id]`                                                  | Update / hapus job                                                                                       |
| POST         | `/api/jobs/[id]/action`                                           | `assign`, `start`, `pause`, `resume`, `start_step`, `start_steps`, `complete_step`, `complete`, `cancel` |
| POST         | `/api/jobs/[id]/handovers`                                        | Tambah catatan handover                                                                                  |
| PATCH/DELETE | `/api/jobs/[id]/handovers/[handoverId]`                            | Update / hapus catatan handover                                                                          |
| POST         | `/api/jobs/[id]/part-loans`                                       | Tambah catatan peminjaman part                                                                           |
| PATCH/DELETE | `/api/jobs/[id]/part-loans/[loanId]`                               | Update / hapus catatan peminjaman part                                                                   |
| GET          | `/api/reports/jobs?scope=active\|queue`                            | Export Excel job aktif / antrian (file terpisah, login)                                                  |
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

## Catatan operasional

- Excel cocok untuk **demo / workshop kecil**. Hindari membuka & menyimpan `workshop.xlsx` di Excel saat app sedang menulis.
- Jika cache Next rusak (error auth / webpack aneh): hentikan semua `npm run dev`, hapus folder `.next`, jalankan lagi **satu** server.
- Jangan jalankan dua `next dev` bersamaan di port berbeda pada project yang sama.
- Template time frame diubah → regenerate `data/job-templates.json` (parse ulang Excel sumber), lalu restart / refresh.
- `data/*.xlsx` biasanya di-ignore git; pastikan backup `workshop.xlsx` dan `AuditLog` jika data produksi penting.
- Timer & warna sisa estimasi (≥50% hijau, 20–50% oranye, ≤20%/overtime merah)

---

## Lisensi / konteks

Project internal monitoring alokasi mekanik & progress recondition component (engine / non-engine).
