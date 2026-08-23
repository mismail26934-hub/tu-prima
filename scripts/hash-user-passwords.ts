import dotenv from "dotenv";
import type mysql from "mysql2/promise";

dotenv.config({ path: ".env.local" });
dotenv.config();

import { closePool, ensureSchema, getPool } from "../src/db/mysql-workbook";
import { hashPassword, isBcryptHash } from "../src/lib/password";

async function main() {
  await ensureSchema();
  const pool = getPool();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id, username, password_hash FROM users ORDER BY username"
  );

  let migrated = 0;
  let skipped = 0;

  for (const row of rows) {
    const stored = String(row.password_hash ?? "");
    if (!stored) {
      console.warn(`Skip ${row.username}: password kosong`);
      skipped++;
      continue;
    }
    if (isBcryptHash(stored)) {
      console.log(`Skip ${row.username}: sudah bcrypt`);
      skipped++;
      continue;
    }

    const hashed = await hashPassword(stored);
    await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [
      hashed,
      row.id,
    ]);
    console.log(`Hashed ${row.username}`);
    migrated++;
  }

  console.log(`Selesai. ${migrated} user di-hash, ${skipped} dilewati.`);
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
