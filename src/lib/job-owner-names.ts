import type mysql from "mysql2/promise";
import { getPool } from "@/db/mysql-workbook";
import type { Job } from "@/lib/types";

function str(v: unknown): string {
  return String(v ?? "").trim();
}

export function userDisplayName(name: string, username: string): string {
  return str(name) || str(username);
}

/** Overlay live user display names onto job Penugas / Delegasi fields. */
export async function applyLiveOwnerNames(jobs: Job[]): Promise<void> {
  if (!jobs.length) return;
  const ids = [
    ...new Set(
      jobs
        .flatMap((job) => [
          str(job.assigned_by_user_id),
          str(job.delegated_to_user_id),
        ])
        .filter(Boolean)
    ),
  ];
  if (!ids.length) return;

  const placeholders = ids.map(() => "?").join(",");
  const p = getPool();
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    `SELECT id, name, username FROM users WHERE id IN (${placeholders})`,
    ids
  );
  const byId = new Map<string, string>();
  for (const row of rows) {
    const id = str(row.id);
    if (!id) continue;
    const label = userDisplayName(str(row.name), str(row.username));
    if (label) byId.set(id, label);
  }

  for (const job of jobs) {
    const assigner = byId.get(str(job.assigned_by_user_id));
    if (assigner) job.assigned_by_user_name = assigner;
    const delegate = byId.get(str(job.delegated_to_user_id));
    if (delegate) job.delegated_to_user_name = delegate;
  }
}

/** Keep job snapshots in sync when a user's display name changes. */
export async function syncJobOwnerDisplayNames(
  userId: string,
  displayName: string
): Promise<void> {
  const id = str(userId);
  const name = str(displayName);
  if (!id || !name) return;
  const p = getPool();
  await p.query(
    `UPDATE jobs SET assigned_by_user_name = ? WHERE assigned_by_user_id = ?`,
    [name, id]
  );
  await p.query(
    `UPDATE jobs SET delegated_to_user_name = ? WHERE delegated_to_user_id = ?`,
    [name, id]
  );
}
