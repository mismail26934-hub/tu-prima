# Database layer (MySQL / MariaDB)

## Relational tables (phpMyAdmin)

| Table | Description |
|-------|-------------|
| `users` | Login accounts |
| `technicians` | Master teknisi |
| `units` | Master unit |
| `jobs` | Jobs (`job_scope`: active / completed / cancelled / deleted) |
| `job_assignees` | Assign teknisi per job |
| `job_steps` | Steps per job |
| `job_events` | Timeline job |
| `job_handovers` | Catatan handover |
| `job_part_loans` | Peminjaman part |
| `attendance` | Daftar hadir |
| `audit_log` | Audit trail |
| `job_change_backups` | Backup / undo |

Connection: `DATABASE_URL` in `.env.local`.

## Commands

```bash
npm run db:ensure   # create schema if missing
```

Start MariaDB/MySQL via Windows service or your local installer (XAMPP, etc.) before running the app.

Backup database:

```bash
mysqldump -u root tu_prima > backup-tu_prima.sql
```

ExcelJS remains only for import/export and SharePoint attendance files.
