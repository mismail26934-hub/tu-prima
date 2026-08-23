/**
 * Shared MySQL helpers for archive / backup workbooks (MariaDB relational tables).
 */
import {
  loadMysqlWorkbook,
  saveMysqlWorkbook,
  readMysqlRows,
  writeMysqlSheet,
  MysqlWorkbook,
  MysqlSheet,
  type DbRow,
} from "@/db/mysql-workbook";

export type ArchiveRow = DbRow;

export async function loadArchiveWb(workbookName: string): Promise<MysqlWorkbook> {
  return loadMysqlWorkbook(workbookName);
}

export async function saveArchiveWb(wb: MysqlWorkbook): Promise<void> {
  await saveMysqlWorkbook(wb);
}

export function readArchiveRows(ws: MysqlSheet): ArchiveRow[] {
  return readMysqlRows(ws);
}

export function writeArchiveSheet(
  wb: MysqlWorkbook,
  name: string,
  headers: readonly string[],
  rows: ArchiveRow[]
) {
  writeMysqlSheet(wb, name, [...headers], rows);
}

export function appendArchiveSheet(
  wb: MysqlWorkbook,
  name: string,
  headers: readonly string[],
  newRows: ArchiveRow[]
) {
  const ws = wb.getWorksheet(name);
  const existing = ws ? readArchiveRows(ws) : [];
  writeArchiveSheet(wb, name, headers, [...existing, ...newRows]);
}

export { MysqlWorkbook, MysqlSheet };
