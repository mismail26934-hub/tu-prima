# PRIMA API — PHP Native (Hostinger)

Backend PHP murni untuk Hostinger File Manager + MySQL (phpMyAdmin).
Frontend Next.js tetap di VPS Hostinger dan memanggil API ini.

## Isi folder

| File / folder | Fungsi |
|---|---|
| `schema.sql` | Skema 8 tabel + seed admin |
| `config.example.php` | Template config — copy jadi `config.php` |
| `index.php` | Router API |
| `.htaccess` | Rewrite + Authorization header |
| `lib/` | Db, Jwt, Cors, Auth, Permissions |
| `src/` | Business logic (jobs, units, …) |
| `uploads/` | Tempat file sementara (import Excel nanti) |

## Deploy ke Hostinger (File Manager)

1. **Buat subdomain** misalnya `api.domainmu.com` → document root ke folder kosong.
2. **Upload** seluruh isi `api-php/` ke document root itu (ZIP → Extract).
3. **Copy** `config.example.php` → `config.php`, isi:
   - kredensial MySQL dari hPanel
   - `jwt_secret` (string panjang acak)
   - `cors_origins` = URL frontend Next.js di VPS (`https://app.domainmu.com`)
4. **phpMyAdmin** → pilih database → Import → `schema.sql`.
5. Uji: buka `https://api.domainmu.com/health` → harus `{ "ok": true, ... }`.

### Login default setelah import schema

- Username: `admin`
- Password: `admin123`
- **Ganti password segera** lewat UI / `POST /account/password`.

## Endpoint utama

Base URL contoh: `https://api.domainmu.com`

| Method | Path | Keterangan |
|---|---|---|
| POST | `/auth/login` | `{ username, password }` → `{ token, user }` |
| GET | `/auth/me` | Header `Authorization: Bearer <token>` |
| GET | `/dashboard` | Mirror `DashboardData` Next.js |
| GET/POST | `/jobs` | List / create |
| PATCH/DELETE | `/jobs/{id}` | Update / hapus |
| POST | `/jobs/{id}/action` | assign, start, pause, resume, complete_step, complete, cancel |
| CRUD | `/units`, `/technicians`, `/attendance`, `/users` | Sama kontrak Next.js |
| POST | `/account/password` | Ganti password sendiri |

Import/template Excel mengembalikan **501** sampai PhpSpreadsheet diaktifkan (CRUD & migrasi SQL tetap jalan).

## Auth dari Next.js (VPS)

```env
NEXT_PUBLIC_API_URL=https://api.domainmu.com
```

Contoh login:

```ts
const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username, password }),
});
const { token, user } = await res.json();
// simpan token, kirim di setiap request:
// Authorization: Bearer <token>
```

## Hak akses

Sama dengan matriks di README utama (superuser / inputer / teknisi / foreman / hrd / spv / guest).
Assign + start/pause/resume/complete hanya **superuser** & **foreman**.

## Migrasi data dari Excel

1. Export tiap sheet `workshop.xlsx` ke CSV, atau
2. Tulis script sekali jalan yang insert ke MySQL.
3. Password plaintext dari Excel akan **otomatis di-hash bcrypt** saat user login pertama kali lewat API PHP.

## Syarat server

- PHP **8.1+**
- Extensi: `pdo_mysql`, `json`, `mbstring`
- `mod_rewrite` aktif (standar Hostinger)

## Catatan keamanan

- Jangan upload `config.php` ke Git publik.
- Batasi `cors_origins` hanya ke domain frontend.
- Ganti `jwt_secret` & password admin setelah deploy.
