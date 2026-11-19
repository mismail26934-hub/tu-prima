import type mysql from "mysql2/promise";
import { getPool } from "@/db/mysql-workbook";
import { broadcastDashboardChanged } from "./realtime/hub";
import type { Customer } from "./types";

let cache: Customer[] | null = null;
let loadPromise: Promise<Customer[]> | null = null;

export function clearCustomerCache() {
  cache = null;
  loadPromise = null;
}

export function customerLabel(c: Pick<Customer, "code" | "name">): string {
  const code = String(c.code || "").trim();
  const name = String(c.name || "").trim();
  if (code && name) return `${code} — ${name}`;
  return code || name || "";
}

function mapRow(row: mysql.RowDataPacket): Customer {
  return {
    id: String(row.id || ""),
    code: String(row.code || "").trim(),
    name: String(row.name || "").trim(),
    active: Number(row.active) === 0 ? "0" : "1",
  };
}

function sortRows(rows: Customer[]): Customer[] {
  return [...rows].sort((a, b) => {
    const byCode = a.code.localeCompare(b.code);
    if (byCode !== 0) return byCode;
    return a.name.localeCompare(b.name);
  });
}

async function fetchAllFromDb(): Promise<Customer[]> {
  const p = getPool();
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    `SELECT id, code, name, active
     FROM customers
     ORDER BY code ASC, name ASC`
  );
  return sortRows(rows.map(mapRow).filter((row) => row.id));
}

async function loadCatalog(): Promise<Customer[]> {
  if (cache) return cache;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      cache = await fetchAllFromDb();
      return cache;
    } finally {
      loadPromise = null;
    }
  })();
  return loadPromise;
}

function newCustomerId(): string {
  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `CU-${rand}`;
}

function normalizeCode(raw: unknown): string {
  return String(raw || "")
    .trim()
    .toUpperCase();
}

export async function listCustomers(opts?: {
  includeInactive?: boolean;
}): Promise<Customer[]> {
  const rows = await loadCatalog();
  if (opts?.includeInactive) return rows;
  return rows.filter((row) => row.active === "1");
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const wanted = String(id || "").trim();
  if (!wanted) return null;
  const rows = await loadCatalog();
  return rows.find((row) => row.id === wanted) || null;
}

export async function assertCustomerForWrite(
  customerId: unknown,
  previousId?: string
): Promise<Customer> {
  const id = String(customerId || "").trim();
  if (!id) throw new Error("Customer wajib dipilih");
  const prev = String(previousId || "").trim();
  const found = await getCustomer(id);
  if (!found) throw new Error("Customer tidak ditemukan");
  if (found.active !== "1" && found.id !== prev) {
    throw new Error("Customer nonaktif");
  }
  return found;
}

async function persist(row: Customer): Promise<void> {
  const p = getPool();
  await p.query(
    `INSERT INTO customers (id, code, name, active)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       code = VALUES(code),
       name = VALUES(name),
       active = VALUES(active)`,
    [row.id, row.code, row.name, row.active === "0" ? 0 : 1]
  );
  clearCustomerCache();
  broadcastDashboardChanged();
}

export async function createCustomer(input: {
  code: string;
  name: string;
  active?: string;
  id?: string;
}): Promise<Customer> {
  const code = normalizeCode(input.code);
  const name = String(input.name || "").trim();
  if (!code) throw new Error("Kode customer wajib diisi");
  if (!name) throw new Error("Nama customer wajib diisi");
  const existing = await loadCatalog();
  if (existing.some((row) => row.code === code)) {
    throw new Error("Kode customer sudah dipakai");
  }
  const row: Customer = {
    id: String(input.id || "").trim() || newCustomerId(),
    code,
    name,
    active: String(input.active ?? "1").trim() === "0" ? "0" : "1",
  };
  await persist(row);
  return row;
}

export async function updateCustomer(
  id: string,
  input: {
    code?: string;
    name?: string;
    active?: string;
  }
): Promise<Customer> {
  const current = await getCustomer(id);
  if (!current) throw new Error("Customer tidak ditemukan");
  const code =
    input.code != null ? normalizeCode(input.code) : current.code;
  const name =
    input.name != null ? String(input.name).trim() : current.name;
  if (!code) throw new Error("Kode customer wajib diisi");
  if (!name) throw new Error("Nama customer wajib diisi");
  const existing = await loadCatalog();
  if (existing.some((row) => row.code === code && row.id !== current.id)) {
    throw new Error("Kode customer sudah dipakai");
  }
  const row: Customer = {
    ...current,
    code,
    name,
    active:
      input.active != null
        ? String(input.active).trim() === "0"
          ? "0"
          : "1"
        : current.active,
  };
  await persist(row);

  const label = customerLabel(row);
  const p = getPool();
  await p.query(`UPDATE jobs SET customer_label = ? WHERE customer_id = ?`, [
    label,
    row.id,
  ]);
  return row;
}

export async function deleteCustomer(id: string): Promise<{ ok: true }> {
  const current = await getCustomer(id);
  if (!current) throw new Error("Customer tidak ditemukan");
  const p = getPool();
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM jobs WHERE customer_id = ?`,
    [current.id]
  );
  const used = Number(rows[0]?.cnt) || 0;
  if (used > 0) {
    throw new Error(
      "Customer masih dipakai job — nonaktifkan lewat Edit jika perlu"
    );
  }
  await p.query(`DELETE FROM customers WHERE id = ?`, [current.id]);
  clearCustomerCache();
  broadcastDashboardChanged();
  return { ok: true };
}
