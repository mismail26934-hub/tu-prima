# PRIMA — Progress Report & Inspection for Mechanic Allocation

Aplikasi monitoring job mekanik.

- **Dev lokal (saat ini):** Excel sebagai database (`data/workshop.xlsx`) via Next.js API routes.
- **Production target:** Frontend Next.js di **VPS Hostinger** + API PHP native di **File Manager** + **MySQL** (phpMyAdmin). Lihat [`api-php/README.md`](api-php/README.md).

## Fitur

- Board teknisi: **available / busy / offline**
- Job progress per tahap (step) saat sedang dikerjakan
- Timer durasi live per job & per step
- Assign **satu atau lebih teknisi** per job, start, pause, resume, complete step, complete job
- **CRUD Jobs**: buat, lihat, edit, hapus permanen
- Setiap user login dapat memperbarui password sendiri dengan verifikasi password saat ini
- Toggle **Light / Dark** mode (tersimpan di browser)
- State form Assign & Job pakai **Zustand** (`src/store/`)
- Data tersimpan di file Excel (bisa dibuka di Microsoft Excel / LibreOffice)

## Sheet Excel

| Sheet | Isi |
|---|---|
| Technicians | id, name, skill, status, current_job_id, phone |
| Units | master unit (id, code, name, active) — dipilih di form Job |
| Jobs | id, title, unit, unit_id, description, status, technician_id, timestamps, durasi pause |
| JobAssignees | relasi banyak teknisi per job (job_id, technician_id, is_lead) |
| JobSteps | tahap job + status + duration_sec |
| JobEvents | timeline event (created, assigned, started, paused, …) |
| Attendance | daftar hadir (date, technician_id, pernr, status, dws, check_in/out) |
| Users | akun login (id, username, password, name, level, active, created_at) |

## Autentikasi & Hak Akses

Login memakai **NextAuth (Credentials)**; akun tersimpan di sheet **Users** pada Excel.
Saat sheet kosong, user awal di-seed dari `.env.local` (`APP_USERNAME` / `APP_PASSWORD`) sebagai `superuser`.
Ikon user di samping nama · level membuka menu **Edit password** dan **Logout**.

### Level user

Setiap user punya salah satu level: `superuser`, `inputer`, `teknisi`, `foreman`, `hrd`, `spv`.
Pengunjung yang **belum login** diperlakukan sebagai `guest`.

### Matriks hak akses (CRUD)

Keterangan: **CRUD** = Create/Read/Update/Delete, **R** = Read saja, **—** = tanpa akses.

| Level | Job | User | Teknisi | Unit | Daftar Hadir | Assign teknisi |
|---|---|---|---|---|---|---|
| superuser | CRUD | CRUD | CRUD | CRUD | CRUD | Ya |
| inputer | CRUD | R | R | CRUD | R | — |
| teknisi | R | R | R | — | R | — |
| foreman | CRUD | R | R | CRUD | R | Ya |
| spv | CRUD | R | R | CRUD | R | — |
| hrd | R | R | R | R | CRUD | — |
| guest (belum login) | R | R | R | — | R | — |

Catatan penerapan:

- Hak akses dipaksakan di **dua lapis**: UI (tombol disembunyikan/di-disable) dan **API route** (menolak dengan `401`/`403`).
- **Assign teknisi** ke job hanya untuk level **superuser** dan **foreman** (level lain tombol disabled + API 403).
- **Start / Pause / Resume / Selesai step / Complete job** hanya untuk level **superuser** dan **foreman** (level lain tombol disabled + API 403).
- `guest` & `teknisi` tidak melihat data Unit (dikosongkan di dashboard).
- Minimal satu `superuser` aktif harus selalu tersisa (tidak bisa dihapus/dinonaktifkan/diturunkan level).

## Menjalankan

```bash
npm install
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000) (atau port lain jika 3000 sudah terpakai).

File Excel otomatis dibuat di `data/workshop.xlsx` saat pertama kali diakses.

## Catatan

- Excel cocok untuk demo / workshop kecil. Hindari edit file Excel saat aplikasi sedang menulis data.
