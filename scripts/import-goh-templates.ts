/**
 * One-shot: parse data/templates/Time Frame GOH.xlsx → upsert MySQL job_templates.
 * Run: npx tsx scripts/import-goh-templates.ts
 */
import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import type { JobTemplate, JobTemplateStep } from "../src/lib/types";
import { ensureSchema } from "../src/db/mysql-workbook";
import {
  createJobTemplate,
  getJobTemplate,
  updateJobTemplate,
} from "../src/lib/job-templates";

dotenv.config({ path: ".env.local" });
dotenv.config();

const ROOT = process.cwd();
const XLSX = path.join(ROOT, "data", "templates", "Time Frame GOH.xlsx");

function cellStr(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (typeof value === "object") {
    const obj = value as {
      text?: unknown;
      result?: unknown;
      richText?: Array<{ text?: string }>;
    };
    if (obj.result != null) return cellStr(obj.result);
    if (typeof obj.text === "string") return obj.text.trim();
    if (Array.isArray(obj.richText)) {
      return obj.richText.map((p) => p.text || "").join("").trim();
    }
  }
  return String(value).trim();
}

function slugify(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
}

function templateNameFromSheet(ws: ExcelJS.Worksheet, sheetName: string): string {
  for (let r = 1; r <= 5; r++) {
    const b = cellStr(ws.getRow(r).getCell(2).value);
    const m = b.match(/Job Description\s+(.+)$/i);
    if (m?.[1]) return m[1].trim().replace(/\s+/g, " ").replace(/\s*\/\s*/g, "/");
  }
  return sheetName.replace(/^GOH\s+/i, "GOH ").trim();
}

function parseSheet(ws: ExcelJS.Worksheet): {
  name: string;
  steps: Array<{ phase: string; name: string; order: number; std_minutes: number }>;
} {
  const name = templateNameFromSheet(ws, ws.name);
  let phase = "";
  const steps: Array<{
    phase: string;
    name: string;
    order: number;
    std_minutes: number;
  }> = [];

  ws.eachRow((row) => {
    const a = cellStr(row.getCell(1).value);
    const b = cellStr(row.getCell(2).value);
    const c = cellStr(row.getCell(3).value);
    if (!b) return;
    if (/^no$/i.test(a) || /job description|duration\s*\(/i.test(b)) return;

    const num = Number(a);
    const hrs = Number(c);
    const hasOrder = a !== "" && Number.isFinite(num);
    const hasHours = c !== "" && Number.isFinite(hrs);

    if (!hasOrder && !hasHours) {
      phase = b;
      return;
    }
    if (!hasOrder && !hasHours) return;
    if (!b) return;

    steps.push({
      phase,
      name: b,
      order: hasOrder ? Math.max(1, Math.round(num)) : steps.length + 1,
      std_minutes: Math.max(0, Math.round((Number.isFinite(hrs) ? hrs : 0) * 60)),
    });
  });

  // Normalize order sequentially while keeping Excel order
  steps.forEach((s, i) => {
    s.order = i + 1;
  });

  return { name, steps };
}

function toTemplate(
  name: string,
  stepsIn: Array<{ phase: string; name: string; order: number; std_minutes: number }>
): JobTemplate {
  const id = `goh-${slugify(name.replace(/^goh\s+/i, ""))}`;
  const steps: JobTemplateStep[] = stepsIn.map((s, i) => {
    const order = i + 1;
    return {
      id: `${id}-S${String(order).padStart(2, "0")}`,
      template_id: id,
      phase: s.phase,
      name: s.name,
      order,
      man_power: 1,
      std_minutes: s.std_minutes,
    };
  });
  return {
    id,
    category: "goh",
    name: name.startsWith("GOH") ? name : `GOH ${name}`,
    active: "1",
    std_minutes: steps.reduce((sum, s) => sum + s.std_minutes, 0),
    steps,
  };
}

async function main() {
  if (!fs.existsSync(XLSX)) {
    throw new Error(`File tidak ditemukan: ${XLSX}`);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX);

  const incoming: JobTemplate[] = [];
  for (const ws of wb.worksheets) {
    const parsed = parseSheet(ws);
    if (parsed.steps.length === 0) {
      console.warn(`Skip kosong: ${ws.name}`);
      continue;
    }
    const tpl = toTemplate(parsed.name, parsed.steps);
    incoming.push(tpl);
    console.log(
      `+ ${tpl.id} · ${tpl.name} · ${tpl.steps.length} step · ${tpl.std_minutes} mnt`
    );
  }

  await ensureSchema();
  let dbUpdated = 0;
  let dbImported = 0;
  for (const tpl of incoming) {
    const existing = await getJobTemplate(tpl.id, { includeInactive: true });
    const payload = {
      id: tpl.id,
      category: tpl.category,
      name: tpl.name,
      active: tpl.active,
      steps: tpl.steps,
    };
    if (existing) {
      await updateJobTemplate(tpl.id, payload);
      dbUpdated += 1;
    } else {
      await createJobTemplate(payload);
      dbImported += 1;
    }
  }

  console.log(`\nDone. MySQL imported=${dbImported} updated=${dbUpdated}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
