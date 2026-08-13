import fs from "fs";
import path from "path";
import { broadcastDashboardChanged } from "./realtime/hub";
import type {
  JobTemplate,
  JobTemplateCategory,
  JobTemplateStep,
  JobTemplateSummary,
} from "./types";

const CATALOG_PATH = path.join(process.cwd(), "data", "job-templates.json");

type CatalogFile = {
  version: number;
  templates: JobTemplate[];
};

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

let cache: CatalogFile | null = null;
let cacheMtimeMs = -1;

export function clearJobTemplateCache() {
  cache = null;
  cacheMtimeMs = -1;
}

function catalogMtimeMs(): number {
  try {
    if (!fs.existsSync(CATALOG_PATH)) return -1;
    return fs.statSync(CATALOG_PATH).mtimeMs;
  } catch {
    return -1;
  }
}

function loadCatalog(): CatalogFile {
  const mtimeMs = catalogMtimeMs();
  if (cache && cacheMtimeMs === mtimeMs && mtimeMs >= 0) return cache;

  if (!fs.existsSync(CATALOG_PATH)) {
    cache = { version: 1, templates: [] };
    cacheMtimeMs = -1;
    return cache;
  }
  const raw = fs.readFileSync(CATALOG_PATH, "utf8");
  const parsed = JSON.parse(raw) as CatalogFile;
  cache = {
    version: parsed.version || 1,
    templates: Array.isArray(parsed.templates) ? parsed.templates : [],
  };
  cacheMtimeMs = mtimeMs;
  return cache;
}

function saveCatalog(catalog: CatalogFile) {
  const dir = path.dirname(CATALOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  cache = catalog;
  cacheMtimeMs = catalogMtimeMs();
  broadcastDashboardChanged();
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

  // Ensure unique step ids after pad collisions
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

export function listJobTemplates(
  category?: JobTemplateCategory,
  opts?: { includeInactive?: boolean }
): JobTemplateSummary[] {
  const { templates } = loadCatalog();
  return templates
    .filter((t) => opts?.includeInactive || t.active !== "0")
    .filter((t) => !category || t.category === category)
    .map(toSummary)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Full rows for master UI / export. */
export function listJobTemplatesFull(
  category?: JobTemplateCategory,
  opts?: { includeInactive?: boolean }
): JobTemplate[] {
  const { templates } = loadCatalog();
  return templates
    .filter((t) => opts?.includeInactive || t.active !== "0")
    .filter((t) => !category || t.category === category)
    .map((t) => ({
      ...t,
      steps: t.steps.slice().sort((a, b) => a.order - b.order),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getJobTemplate(
  id: string,
  opts?: { includeInactive?: boolean }
): JobTemplate | null {
  const { templates } = loadCatalog();
  const found = templates.find((t) => t.id === id) || null;
  if (!found) return null;
  if (!opts?.includeInactive && found.active === "0") return null;
  return {
    ...found,
    steps: found.steps.slice().sort((a, b) => a.order - b.order),
  };
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

function assertCategory(value: unknown): JobTemplateCategory {
  if (value === "engine" || value === "non_engine" || value === "goh") return value;
  throw new Error("category harus engine, non_engine, atau goh");
}

export function createJobTemplate(input: JobTemplateWriteInput): JobTemplate {
  const catalog = loadCatalog();
  const category = assertCategory(input.category);
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Nama template wajib diisi");

  const existingIds = new Set(catalog.templates.map((t) => t.id));
  let id = String(input.id || "").trim();
  if (id) {
    if (existingIds.has(id)) {
      return getJobTemplate(id, { includeInactive: true })!;
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

  catalog.templates.push(template);
  saveCatalog(catalog);
  return getJobTemplate(id, { includeInactive: true })!;
}

export function updateJobTemplate(
  id: string,
  input: JobTemplateWriteInput
): JobTemplate {
  const catalog = loadCatalog();
  const index = catalog.templates.findIndex((t) => t.id === id);
  if (index < 0) throw new Error("Template tidak ditemukan");

  const category = assertCategory(input.category);
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Nama template wajib diisi");

  const steps = normalizeSteps(id, input.steps || []);
  const prev = catalog.templates[index];
  const template: JobTemplate = {
    id,
    category,
    name,
    active:
      input.active != null ? normalizeActive(input.active) : normalizeActive(prev.active),
    std_minutes: sumStdMinutes(steps),
    steps,
  };

  catalog.templates[index] = template;
  saveCatalog(catalog);
  return getJobTemplate(id, { includeInactive: true })!;
}

/** Soft-delete: set active = "0" so existing jobs keep template_id. */
export function deleteJobTemplate(id: string): { ok: true; template: JobTemplate } {
  const catalog = loadCatalog();
  const index = catalog.templates.findIndex((t) => t.id === id);
  if (index < 0) throw new Error("Template tidak ditemukan");

  catalog.templates[index] = {
    ...catalog.templates[index],
    active: "0",
  };
  saveCatalog(catalog);
  return {
    ok: true,
    template: getJobTemplate(id, { includeInactive: true })!,
  };
}
