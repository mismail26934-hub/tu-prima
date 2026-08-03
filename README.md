# PRIMA — Progress Report & Inspection for Mechanic Allocation

Aplikasi monitoring job mekanik dengan **Excel sebagai database** (`data/workshop.xlsx`).

## Fitur

- Board teknisi: **available / busy / offline**
- Job progress per tahap (step) saat sedang dikerjakan
- Timer durasi live per job & per step
- Assign **satu atau lebih teknisi** per job, start, pause, resume, complete step, complete job
- **CRUD Jobs**: buat, lihat, edit, hapus permanen
- Toggle **Light / Dark** mode (tersimpan di browser)
- Data tersimpan di file Excel (bisa dibuka di Microsoft Excel / LibreOffice)

## Sheet Excel

| Sheet | Isi |
|---|---|
| Technicians | id, name, skill, status, current_job_id, phone |
| Jobs | id, title, unit, description, status, technician_id, timestamps, durasi pause |
| JobAssignees | relasi banyak teknisi per job (job_id, technician_id, is_lead) |
| JobSteps | tahap job + status + duration_sec |
| JobEvents | timeline event (created, assigned, started, paused, …) |

## Menjalankan

```bash
npm install
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000) (atau port lain jika 3000 sudah terpakai).

File Excel otomatis dibuat di `data/workshop.xlsx` saat pertama kali diakses.

## Catatan

- Excel cocok untuk demo / workshop kecil. Hindari edit file Excel saat aplikasi sedang menulis data.
