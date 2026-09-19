import type mysql from "mysql2/promise";
import { getPool } from "@/db/mysql-workbook";
import { broadcastDashboardChanged } from "./realtime/hub";
import type {
  JobTemplate,
  JobTemplateCategory,
  JobTemplateStep,
  JobTemplateSummary,
} from "./types";

export type JobTemplateStepInput = {
  id?: string;
  phase?: string;
  name: string;
  order?: number;
  man_power?: number;
  std_minutes?: number;
};

export type JobTemplateWriteInput = {
  category: JobTemplateCategory;
  name: string;
  active?: string;
  steps: JobTemplateStepInput[];
  /** Optional custom id on create; otherwise auto-generated. */
  id?: string;
};

let cache: JobTemplate[] | null = null;
let loadPromise: Promise<JobTemplate[]> | null = null;

export function clearJobTemplateCache() {
  cache = null;
  loadPromise = null;
}

function slugify(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function categoryPrefix(category: JobTemplateCategory): string {
  if (category === "engine") return "eng";
  if (category === "goh") return "goh";
  return "ne";
}

function makeTemplateId(
  category: JobTemplateCategory,
  name: string,
  existing: Set<string>
): string {
  const base = `${categoryPrefix(category)}-${slugify(name) || "template"}`;
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function normalizeActive(value: unknown): "1" | "0" {
  const raw = String(value ?? "1").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "nonaktif" || raw === "inactive") {
    return "0";
  }
  return "1";
}

function normalizeSteps(
  templateId: string,
  steps: JobTemplateStepInput[]
): JobTemplateStep[] {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error("Minimal satu step wajib diisi");
  }

  const normalized = steps.map((step, index) => {
    const name = String(step.name || "").trim();
    if (!name) {
      throw new Error(`Nama step baris ${index + 1} wajib diisi`);
    }
    const order =
      step.order != null && Number.isFinite(Number(step.order))
        ? Math.max(1, Math.round(Number(step.order)))
        : index + 1;
    const std_minutes = Math.max(0, Math.round(Number(step.std_minutes) || 0));
    const man_power = Math.max(0, Number(step.man_power) || 0);
    const phase = String(step.phase || "").trim();
    const id =
      String(step.id || "").trim() ||
      `${templateId}-S${String(order).padStart(2, "0")}`;

    return {
      id,
      template_id: templateId,
      phase,
      name,
      order,
      man_power,
      std_minutes,
    };
  });

  const used = new Set<string>();
  for (const step of normalized) {
    let id = step.id;
    if (used.has(id)) {
      let n = 2;
      while (used.has(`${step.id}-${n}`)) n += 1;
      id = `${step.id}-${n}`;
    }
    used.add(id);
    step.id = id;
  }

  return normalized.sort((a, b) => a.order - b.order);
}

function sumStdMinutes(steps: JobTemplateStep[]): number {
  return steps.reduce((sum, s) => sum + Number(s.std_minutes || 0), 0);
}

function toSummary(t: JobTemplate): JobTemplateSummary {
  return {
    id: t.id,
    category: t.category,
    name: t.name,
    std_minutes: t.std_minutes,
    step_count: t.steps.length,
  };
}

function parseCategory(value: unknown): JobTemplateCategory {
  if (value === "engine" || value === "non_engine" || value === "goh") return value;
  return "engine";
}

function assertCategory(value: unknown): JobTemplateCategory {
  if (value === "engine" || value === "non_engine" || value === "goh") return value;
  throw new Error("category harus engine, non_engine, atau goh");
}

function cloneTemplate(t: JobTemplate): JobTemplate {
  return {
    ...t,
    steps: t.steps.slice().sort((a, b) => a.order - b.order),
  };
}

function rowStr(value: unknown): string {
  return String(value ?? "").trim();
}

function mapStep(row: mysql.RowDataPacket): JobTemplateStep {
  return {
    id: rowStr(row.id),
    template_id: rowStr(row.template_id),
    phase: rowStr(row.phase),
    name: rowStr(row.name),
    order: Number(row.sort_order || 0) || 0,
    man_power: Number(row.man_power || 0) || 0,
    std_minutes: Number(row.std_minutes || 0) || 0,
  };
}

function mapTemplate(
  row: mysql.RowDataPacket,
  steps: JobTemplateStep[]
): JobTemplate {
  const category = parseCategory(rowStr(row.category) || "engine");
  return {
    id: rowStr(row.id),
    category,
    name: rowStr(row.name),
    active: Number(row.active) === 0 ? "0" : "1",
    std_minutes: Number(row.std_minutes || 0) || 0,
    steps: steps.slice().sort((a, b) => a.order - b.order),
  };
}

async function fetchAllFromDb(): Promise<JobTemplate[]> {
  const p = getPool();
  const [headers] = await p.query<mysql.RowDataPacket[]>(
    `SELECT id, category, name, active, std_minutes FROM job_templates`
  );
  const [stepRows] = await p.query<mysql.RowDataPacket[]>(
    `SELECT id, template_id, phase, name, sort_order, man_power, std_minutes
     FROM job_template_steps
     ORDER BY template_id, sort_order, id`
  );
  const stepsByTemplate = new Map<string, JobTemplateStep[]>();
  for (const row of stepRows) {
    const step = mapStep(row);
    const list = stepsByTemplate.get(step.template_id) || [];
    list.push(step);
    stepsByTemplate.set(step.template_id, list);
  }
  return headers
    .map((row) => mapTemplate(row, stepsByTemplate.get(rowStr(row.id)) || []))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function loadCatalog(): Promise<JobTemplate[]> {
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

async function insertTemplateRows(
  conn: mysql.PoolConnection | mysql.Pool,
  template: JobTemplate
) {
  await conn.query(
    `INSERT INTO job_templates (id, category, name, active, std_minutes)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       category = VALUES(category),
       name = VALUES(name),
       active = VALUES(active),
       std_minutes = VALUES(std_minutes)`,
    [
      template.id,
      template.category,
      template.name,
      template.active === "0" ? 0 : 1,
      template.std_minutes,
    ]
  );
  await conn.query(`DELETE FROM job_template_steps WHERE template_id = ?`, [
    template.id,
  ]);
  for (const step of template.steps) {
    await conn.query(
      `INSERT INTO job_template_steps
        (id, template_id, phase, name, sort_order, man_power, std_minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        step.id,
        template.id,
        step.phase || "",
        step.name,
        step.order,
        step.man_power,
        step.std_minutes,
      ]
    );
  }
}

async function persistTemplate(template: JobTemplate): Promise<void> {
  const p = getPool();
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();
    await insertTemplateRows(conn, template);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  clearJobTemplateCache();
  broadcastDashboardChanged();
}

export async function listJobTemplates(
  category?: JobTemplateCategory,
  opts?: { includeInactive?: boolean }
): Promise<JobTemplateSummary[]> {
  const templates = await loadCatalog();
  return templates
    .filter((t) => opts?.includeInactive || t.active !== "0")
    .filter((t) => !category || t.category === category)
    .map(toSummary)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Full rows for master UI / export. */
export async function listJobTemplatesFull(
  category?: JobTemplateCategory,
  opts?: { includeInactive?: boolean }
): Promise<JobTemplate[]> {
  const templates = await loadCatalog();
  return templates
    .filter((t) => opts?.includeInactive || t.active !== "0")
    .filter((t) => !category || t.category === category)
    .map(cloneTemplate)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getJobTemplate(
  id: string,
  opts?: { includeInactive?: boolean }
): Promise<JobTemplate | null> {
  const templates = await loadCatalog();
  const found = templates.find((t) => t.id === id) || null;
  if (!found) return null;
  if (!opts?.includeInactive && found.active === "0") return null;
  return cloneTemplate(found);
}

/** Step name + STP minutes from template (sorted by order). */
export function stepsFromTemplate(
  template: JobTemplate
): Array<{ name: string; std_minutes: number }> {
  return template.steps
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      name: s.phase ? `${s.phase}: ${s.name}` : s.name,
      std_minutes: Number(s.std_minutes || 0),
    }));
}

export function stepNamesFromTemplate(template: JobTemplate): string[] {
  return stepsFromTemplate(template).map((s) => s.name);
}

export async function createJobTemplate(
  input: JobTemplateWriteInput
): Promise<JobTemplate> {
  const templates = await loadCatalog();
  const category = assertCategory(input.category);
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Nama template wajib diisi");

  const existingIds = new Set(templates.map((t) => t.id));
  let id = String(input.id || "").trim();
  if (id) {
    if (existingIds.has(id)) {
      return (await getJobTemplate(id, { includeInactive: true }))!;
    }
  } else {
    id = makeTemplateId(category, name, existingIds);
  }

  const steps = normalizeSteps(id, input.steps || []);
  const template: JobTemplate = {
    id,
    category,
    name,
    active: normalizeActive(input.active),
    std_minutes: sumStdMinutes(steps),
    steps,
  };
  await persistTemplate(template);
  return (await getJobTemplate(id, { includeInactive: true }))!;
}

export async function updateJobTemplate(
  id: string,
  input: JobTemplateWriteInput
): Promise<JobTemplate> {
  const prev = await getJobTemplate(id, { includeInactive: true });
  if (!prev) throw new Error("Template tidak ditemukan");

  const category = assertCategory(input.category);
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Nama template wajib diisi");

  const steps = normalizeSteps(id, input.steps || []);
  const template: JobTemplate = {
    id,
    category,
    name,
    active:
      input.active != null ? normalizeActive(input.active) : normalizeActive(prev.active),
    std_minutes: sumStdMinutes(steps),
    steps,
  };
  await persistTemplate(template);
  return (await getJobTemplate(id, { includeInactive: true }))!;
}

/**
 * Hard-delete from MySQL. Existing jobs keep `template_id`; lookup returns null.
 */
export async function deleteJobTemplate(
  id: string
): Promise<{ ok: true; id: string }> {
  const prev = await getJobTemplate(id, { includeInactive: true });
  if (!prev) throw new Error("Template tidak ditemukan");
  const p = getPool();
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM job_template_steps WHERE template_id = ?`, [id]);
    await conn.query(`DELETE FROM job_templates WHERE id = ?`, [id]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  clearJobTemplateCache();
  broadcastDashboardChanged();
  return { ok: true, id };
}
