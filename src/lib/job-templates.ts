import fs from "fs";
import path from "path";
import type {
  JobTemplate,
  JobTemplateCategory,
  JobTemplateSummary,
} from "./types";

const CATALOG_PATH = path.join(process.cwd(), "data", "job-templates.json");

type CatalogFile = {
  version: number;
  templates: JobTemplate[];
};

let cache: CatalogFile | null = null;

function loadCatalog(): CatalogFile {
  if (cache) return cache;
  if (!fs.existsSync(CATALOG_PATH)) {
    cache = { version: 1, templates: [] };
    return cache;
  }
  const raw = fs.readFileSync(CATALOG_PATH, "utf8");
  const parsed = JSON.parse(raw) as CatalogFile;
  cache = {
    version: parsed.version || 1,
    templates: Array.isArray(parsed.templates) ? parsed.templates : [],
  };
  return cache;
}

export function listJobTemplates(
  category?: JobTemplateCategory
): JobTemplateSummary[] {
  const { templates } = loadCatalog();
  return templates
    .filter((t) => t.active !== "0")
    .filter((t) => !category || t.category === category)
    .map((t) => ({
      id: t.id,
      category: t.category,
      name: t.name,
      std_minutes: t.std_minutes,
      step_count: t.steps.length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getJobTemplate(id: string): JobTemplate | null {
  const { templates } = loadCatalog();
  return templates.find((t) => t.id === id && t.active !== "0") || null;
}

export function stepNamesFromTemplate(template: JobTemplate): string[] {
  return template.steps
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((s) => (s.phase ? `${s.phase}: ${s.name}` : s.name));
}
