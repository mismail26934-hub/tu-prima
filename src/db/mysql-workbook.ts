import mysql from 'mysql2/promise';
import {
  ensureRelationalSchema,
  loadRelationalWorkbook,
  saveRelationalWorkbook,
} from './relational-store';

export type DbRow = Record<string, string | number>;

let pool: mysql.Pool | null = null;

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (url) return url;
  // Local default (MariaDB/MySQL)
  return 'mysql://root@127.0.0.1:3306/tu_prima';
}

function parseDatabaseUrl(url: string): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} {
  const u = new URL(url);
  return {
    host: u.hostname || '127.0.0.1',
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username || 'root'),
    password: decodeURIComponent(u.password || ''),
    database: (u.pathname || '/tu_prima').replace(/^\//, '') || 'tu_prima',
  };
}

export function getPool(): mysql.Pool {
  if (pool) return pool;
  const cfg = parseDatabaseUrl(getDatabaseUrl());
  pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
  });
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function ensureDatabaseExists() {
  const cfg = parseDatabaseUrl(getDatabaseUrl());
  let conn: mysql.Connection;
  try {
    conn = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      multipleStatements: true,
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ECONNREFUSED') {
      throw new Error(
        `MariaDB/MySQL tidak berjalan di ${cfg.host}:${cfg.port}. ` +
          `Start MariaDB/MySQL service terlebih dahulu (atau jalankan mysqld).`
      );
    }
    throw err;
  }
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${cfg.database}\`
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await conn.end();
  }
}

export async function ensureSchema() {
  await ensureDatabaseExists();
  await ensureRelationalSchema();
}

export async function loadMysqlWorkbook(
  workbookName: string
): Promise<MysqlWorkbook> {
  await ensureSchema();
  return loadRelationalWorkbook(workbookName);
}

export async function workbookHasData(workbookName: string): Promise<boolean> {
  await ensureSchema();
  const p = getPool();
  if (workbookName === 'workshop') {
    const [users] = await p.query<mysql.RowDataPacket[]>(
      `SELECT 1 AS ok FROM users LIMIT 1`
    );
    if (users.length) return true;
    const [techs] = await p.query<mysql.RowDataPacket[]>(
      `SELECT 1 AS ok FROM technicians LIMIT 1`
    );
    if (techs.length) return true;
    const [jobs] = await p.query<mysql.RowDataPacket[]>(
      `SELECT 1 AS ok FROM jobs WHERE job_scope = 'active' LIMIT 1`
    );
    return jobs.length > 0;
  }
  if (workbookName === 'backup') {
    const [rows] = await p.query<mysql.RowDataPacket[]>(
      `SELECT 1 AS ok FROM job_change_backups LIMIT 1`
    );
    return rows.length > 0;
  }
  const scope =
    workbookName === 'completed'
      ? 'completed'
      : workbookName === 'cancelled'
        ? 'cancelled'
        : workbookName === 'deleted'
          ? 'deleted'
          : null;
  if (scope) {
    const [rows] = await p.query<mysql.RowDataPacket[]>(
      `SELECT 1 AS ok FROM jobs WHERE job_scope = ? LIMIT 1`,
      [scope]
    );
    return rows.length > 0;
  }
  return false;
}

export async function saveMysqlWorkbook(wb: MysqlWorkbook): Promise<void> {
  await ensureSchema();
  await saveRelationalWorkbook(wb);
}

export class MysqlSheet {
  name: string;
  id: number;
  headers: string[] = [];
  rows: DbRow[] = [];

  constructor(name: string, id: number) {
    this.name = name;
    this.id = id;
  }

  getRow(rowNumber: number) {
    if (rowNumber === 1) {
      const values = this.headers;
      return {
        eachCell: (fn: (cell: { value: string }, col: number) => void) => {
          values.forEach((h, i) => fn({ value: h }, i + 1));
        },
        getCell: (col: number) => ({ value: values[col - 1] ?? '' }),
        font: {} as { bold?: boolean },
      };
    }
    const row = this.rows[rowNumber - 2];
    return {
      eachCell: (
        fn: (cell: { value: string | number }, col: number) => void
      ) => {
        this.headers.forEach((h, i) => {
          fn({ value: row?.[h] ?? '' }, i + 1);
        });
      },
      getCell: (col: number) => {
        const h = this.headers[col - 1];
        return { value: h && row ? (row[h] ?? '') : '' };
      },
      font: {} as { bold?: boolean },
    };
  }

  eachRow(
    fn: (row: ReturnType<MysqlSheet['getRow']>, rowNumber: number) => void
  ) {
    fn(this.getRow(1), 1);
    this.rows.forEach((_, i) => fn(this.getRow(i + 2), i + 2));
  }

  addRow(values: Array<string | number> | Record<string, string | number>) {
    if (Array.isArray(values)) {
      if (this.headers.length === 0) {
        this.headers = values.map((v) => String(v));
        return;
      }
      const obj: DbRow = {};
      this.headers.forEach((h, i) => {
        obj[h] = values[i] ?? '';
      });
      this.rows.push(obj);
      return;
    }
    this.rows.push({ ...values });
  }
}

export class MysqlWorkbook {
  workbookName: string;
  private sheets = new Map<string, MysqlSheet>();
  private nextId = 1;
  dirty = false;

  constructor(workbookName: string) {
    this.workbookName = workbookName;
  }

  get worksheets(): MysqlSheet[] {
    return [...this.sheets.values()];
  }

  getWorksheet(name: string): MysqlSheet | undefined {
    return this.sheets.get(name);
  }

  addWorksheet(name: string): MysqlSheet {
    const existing = this.sheets.get(name);
    if (existing) return existing;
    const sheet = new MysqlSheet(name, this.nextId++);
    this.sheets.set(name, sheet);
    this.dirty = true;
    return sheet;
  }

  removeWorksheet(idOrName: number | string) {
    if (typeof idOrName === 'string') {
      this.sheets.delete(idOrName);
      this.dirty = true;
      return;
    }
    for (const [name, sheet] of this.sheets) {
      if (sheet.id === idOrName) {
        this.sheets.delete(name);
        this.dirty = true;
        return;
      }
    }
  }

  /** Used by ExcelJS-style consumers that inspect worksheets list. */
  setSheetData(name: string, headers: string[], rows: DbRow[]) {
    const sheet = this.addWorksheet(name);
    sheet.headers = [...headers];
    sheet.rows = rows.map((r) => ({ ...r }));
    this.dirty = true;
  }
}

export function readMysqlRows(ws: MysqlSheet): DbRow[] {
  return ws.rows.map((r) => {
    const obj: DbRow = {};
    for (const h of ws.headers) {
      if (!h) continue;
      const v = r[h];
      obj[h] = v == null ? '' : v;
    }
    // Keep unknown keys for forward-compat
    for (const [k, v] of Object.entries(r)) {
      if (!(k in obj)) obj[k] = v == null ? '' : v;
    }
    return obj;
  });
}

export function writeMysqlSheet(
  wb: MysqlWorkbook,
  name: string,
  headers: string[],
  rows: DbRow[]
) {
  const existing = wb.getWorksheet(name);
  if (existing) wb.removeWorksheet(existing.id);
  wb.setSheetData(
    name,
    headers,
    rows.map((r) => {
      const obj: DbRow = {};
      for (const h of headers) obj[h] = r[h] == null ? '' : r[h];
      return obj;
    })
  );
}
