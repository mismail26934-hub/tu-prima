import ExcelJS from "exceljs";
import type { JobTemplate, JobTemplateCategory } from "./types";
import {
  createJobTemplate,
  getJobTemplate,
  listJobTemplatesFull,
  updateJobTemplate,
  type JobTemplateStepInput,
} from "./job-templates";

function activeLabel(active: string): string {
  return active === "0" ? "nonaktif" : "aktif";
}

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF59E0B" },
};

function styleHeader(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.getRow(1).font = { bold: true, color: { argb: "FF111827" } };
  sheet.getRow(1).fill = HEADER_FILL;
}

/** Export one or many job templates to Excel (Templates + Steps sheets). */
export async function buildJobTemplatesWorkbook(
  templates: JobTemplate[]
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TU-PRIMA";
  workbook.created = new Date();

  const meta = workbook.addWorksheet("Templates");
  meta.columns = [
    { header: "id", key: "id", width: 28 },
    { header: "category", key: "category", width: 14 },
    { header: "name", key: "name", width: 28 },
    { header: "status", key: "status", width: 12 },
    { header: "std_minutes", key: "std_minutes", width: 14 },
    { header: "step_count", key: "step_count", width: 12 },
  ];
  styleHeader(meta);

  for (const t of templates) {
    meta.addRow({
      id: t.id,
      category: t.category,
      name: t.name,
      status: activeLabel(t.active),
      std_minutes: t.std_minutes,
      step_count: t.steps.length,
    });
  }

  const steps = workbook.addWorksheet("Steps");
  steps.columns = [
    { header: "template_id", key: "template_id", width: 28 },
    { header: "template_name", key: "template_name", width: 28 },
    { header: "phase", key: "phase", width: 18 },
    { header: "name", key: "name", width: 48 },
    { header: "order", key: "order", width: 10 },
    { header: "man_power", key: "man_power", width: 12 },
    { header: "std_minutes", key: "std_minutes", width: 14 },
  ];
  styleHeader(steps);

  for (const t of templates) {
    const sorted = t.steps.slice().sort((a, b) => a.order - b.order);
    for (const s of sorted) {
      steps.addRow({
        template_id: t.id,
        template_name: t.name,
        phase: s.phase,
        name: s.name,
        order: s.order,
        man_power: s.man_power,
        std_minutes: s.std_minutes,
      });
    }
  }

  addPetunjukSheet(workbook, false);
  return workbook;
}

/** Blank Excel for mass upload (with sample rows + validations). */
export async function buildJobTemplateUploadTemplate(): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TU-PRIMA";
  workbook.created = new Date();

  const meta = workbook.addWorksheet("Templates");
  meta.columns = [
    { header: "id", key: "id", width: 28 },
    { header: "category", key: "category", width: 14 },
    { header: "name", key: "name", width: 28 },
    { header: "status", key: "status", width: 12 },
  ];
  styleHeader(meta);
  meta.autoFilter = "A1:D1";
  meta.addRow({
    id: "",
    category: "engine",
    name: "Engine Contoh",
    status: "aktif",
  });

  for (let row = 2; row <= 201; row += 1) {
    meta.getCell(`B${row}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"engine,non_engine,goh"'],
      showErrorMessage: true,
      errorTitle: "Category tidak valid",
      error: "Pilih engine, non_engine, atau goh.",
    };
    meta.getCell(`D${row}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"aktif,nonaktif"'],
      showErrorMessage: true,
      errorTitle: "Status tidak valid",
      error: "Pilih aktif atau nonaktif.",
    };
  }

  const steps = workbook.addWorksheet("Steps");
  steps.columns = [
    { header: "template_id", key: "template_id", width: 28 },
    { header: "template_name", key: "template_name", width: 28 },
    { header: "phase", key: "phase", width: 18 },
    { header: "name", key: "name", width: 48 },
    { header: "order", key: "order", width: 10 },
    { header: "man_power", key: "man_power", width: 12 },
    { header: "std_minutes", key: "std_minutes", width: 14 },
  ];
  styleHeader(steps);
  steps.autoFilter = "A1:G1";
  steps.addRows([
    {
      template_id: "",
      template_name: "Engine Contoh",
      phase: "Receive",
      name: "Unpacking",
      order: 1,
      man_power: 1,
      std_minutes: 60,
    },
    {
      template_id: "",
      template_name: "Engine Contoh",
      phase: "Disassemble",
      name: "Dismantle",
      order: 2,
      man_power: 2,
      std_minutes: 120,
    },
  ]);

  addPetunjukSheet(workbook, true);
  return workbook;
}

function addPetunjukSheet(workbook: ExcelJS.Workbook, forUpload: boolean) {
  const guide = workbook.addWorksheet("Petunjuk");
  guide.columns = [
    { header: "Kolom / Topik", key: "topic", width: 22 },
    { header: "Keterangan", key: "note", width: 78 },
  ];
  const rows = forUpload
    ? [
        {
          topic: "Cara pakai",
          note: "Isi sheet Templates + Steps, lalu unggah di Kelola → Master Template → Mass upload Excel. Cek dulu baris OK/Error, centang yang ingin masuk katalog.",
        },
        {
          topic: "Templates.id",
          note: "Opsional. Kosong = buat baru (id otomatis). Isi id yang sudah ada untuk update.",
        },
        {
          topic: "Templates.category",
          note: "Wajib: engine, non_engine, atau goh.",
        },
        {
          topic: "Templates.name",
          note: "Wajib. Nama komponen (mis. Engine 3306).",
        },
        {
          topic: "Templates.status",
          note: "Opsional: aktif / nonaktif. Default aktif.",
        },
        {
          topic: "Steps.template_id",
          note: "Opsional jika template_name diisi. Harus cocok dengan id di sheet Templates bila diisi.",
        },
        {
          topic: "Steps.template_name",
          note: "Wajib bila template_id kosong. Harus sama dengan name di sheet Templates.",
        },
        {
          topic: "Steps.name",
          note: "Wajib. Nama langkah. phase / order / man_power / std_minutes boleh diisi.",
        },
        {
          topic: "Update",
          note: "Jika id atau (category+name) sudah ada, steps diganti penuh dari file.",
        },
        {
          topic: "Contoh",
          note: "Baris contoh boleh dihapus / diubah sebelum upload.",
        },
      ]
    : [
        {
          topic: "Sumber",
          note: "Export katalog Master Template. Bisa diedit lalu di-upload ulang (mass upload).",
        },
        {
          topic: "category",
          note: "engine = Component Engine; non_engine = Component Non Engine (Transmisi); goh = GOH.",
        },
        {
          topic: "std_minutes",
          note: "Estimasi menit template = jumlah std_minutes semua step.",
        },
      ];
  guide.addRows(rows);
  styleHeader(guide);
}

export async function jobTemplatesToExcelBuffer(
  templates: JobTemplate[]
): Promise<Buffer> {
  const workbook = await buildJobTemplatesWorkbook(templates);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function jobTemplateUploadTemplateBuffer(): Promise<Buffer> {
  const workbook = await buildJobTemplateUploadTemplate();
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function cellStr(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "object") {
    const obj = value as { text?: unknown; result?: unknown; richText?: Array<{ text?: string }> };
    if (typeof obj.text === "string") return obj.text.trim();
    if (obj.result != null) return String(obj.result).trim();
    if (Array.isArray(obj.richText)) {
      return obj.richText.map((p) => p.text || "").join("").trim();
    }
  }
  return String(value).trim();
}

function headerMap(sheet: ExcelJS.Worksheet): Record<string, number> {
  const map: Record<string, number> = {};
  sheet.getRow(1).eachCell((cell, column) => {
    const key = cellStr(cell.value).toLowerCase();
    if (key) map[key] = column;
  });
  return map;
}

function colOf(map: Record<string, number>, ...names: string[]): number {
  for (const name of names) {
    const column = map[name.toLowerCase()];
    if (column) return column;
  }
  return 0;
}

function parseCategory(raw: string): JobTemplateCategory | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (
    v === "engine" ||
    v === "component engine" ||
    v === "eng"
  ) {
    return "engine";
  }
  if (
    v === "non_engine" ||
    v === "non-engine" ||
    v === "nonengine" ||
    v === "component non engine (transmisi)" ||
    v === "component non engine" ||
    v === "transmisi" ||
    v === "ne"
  ) {
    return "non_engine";
  }
  if (v === "goh" || v === "general overhaul" || v === "time frame goh") {
    return "goh";
  }
  return null;
}

function parseActive(raw: string): "1" | "0" | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (["1", "aktif", "active", "ya", "true"].includes(v)) return "1";
  if (["0", "nonaktif", "inactive", "tidak", "false"].includes(v)) return "0";
  return null;
}

export type JobTemplateImportPreviewRow = {
  row: number;
  sheet: "Templates" | "Steps";
  excelRow: number;
  id: string;
  category: string;
  name: string;
  active: "" | "1" | "0";
  stepCount: number;
  ok: boolean;
  action: "create" | "update" | "skip";
  error?: string;
  steps: JobTemplateStepInput[];
};

export type JobTemplateImportCommitRow = {
  id?: string;
  category: JobTemplateCategory;
  name: string;
  active?: string;
  steps: JobTemplateStepInput[];
};

type PreviewDraft = {
  row: number;
  sheet: "Templates" | "Steps";
  excelRow: number;
  id: string;
  category: string;
  categoryValid: JobTemplateCategory | null;
  name: string;
  active: "" | "1" | "0";
  steps: JobTemplateStepInput[];
  errors: string[];
};

function findSheet(
  workbook: ExcelJS.Workbook,
  ...names: string[]
): ExcelJS.Worksheet | null {
  const wanted = names.map((n) => n.toLowerCase());
  for (const ws of workbook.worksheets) {
    if (wanted.includes(String(ws.name || "").trim().toLowerCase())) {
      return ws;
    }
  }
  return null;
}

function nameKey(category: string, name: string) {
  return `${category}::${name.trim().toLowerCase()}`;
}

function findExistingTemplate(
  id: string,
  category: JobTemplateCategory | null,
  name: string
): JobTemplate | null {
  if (id) {
    const byId = getJobTemplate(id, { includeInactive: true });
    if (byId) return byId;
  }
  if (!category || !name) return null;
  return (
    listJobTemplatesFull(category, { includeInactive: true }).find(
      (t) => t.name.toLowerCase() === name.toLowerCase()
    ) || null
  );
}

function toPreviewRow(draft: PreviewDraft): JobTemplateImportPreviewRow {
  const errors = draft.errors.slice();
  if (!errors.length && draft.categoryValid && draft.name && !draft.steps.length) {
    errors.push("Tidak ada step di sheet Steps");
  }
  const ok = errors.length === 0 && Boolean(draft.categoryValid && draft.name);
  const existing = ok
    ? findExistingTemplate(draft.id, draft.categoryValid, draft.name)
    : null;
  return {
    row: draft.row,
    sheet: draft.sheet,
    excelRow: draft.excelRow,
    id: draft.id,
    category: draft.category,
    name: draft.name,
    active: draft.active || (ok ? "1" : ""),
    stepCount: draft.steps.length,
    ok,
    action: ok ? (existing ? "update" : "create") : "skip",
    error: errors.length ? errors.join(" · ") : undefined,
    steps: ok ? draft.steps : [],
  };
}

/** Parse Excel into a review table. Does not write the catalog. */
export async function previewJobTemplatesFromBuffer(
  buffer: ArrayBuffer | Buffer
): Promise<{
  rows: JobTemplateImportPreviewRow[];
  okCount: number;
  errorCount: number;
}> {
  const src = new ExcelJS.Workbook();
  const bytes =
    buffer instanceof ArrayBuffer
      ? Buffer.from(new Uint8Array(buffer))
      : Buffer.from(buffer);
  await src.xlsx.load(bytes as unknown as ExcelJS.Buffer);

  const metaSheet =
    findSheet(src, "Templates", "Template", "Master") || src.worksheets[0];
  const stepsSheet =
    findSheet(src, "Steps", "Step", "Langkah") ||
    src.worksheets.find((ws) => ws !== metaSheet) ||
    null;

  if (!metaSheet || !stepsSheet) {
    throw new Error(
      'File harus punya sheet "Templates" dan "Steps" (unduh template Excel).'
    );
  }

  const metaMap = headerMap(metaSheet);
  const cId = colOf(metaMap, "id", "template_id");
  const cCategory = colOf(
    metaMap,
    "category",
    "jenis",
    "jenis komponen",
    "component"
  );
  const cName = colOf(metaMap, "name", "nama", "template_name", "nama template");
  const cStatus = colOf(metaMap, "status", "active", "aktif");

  if (!cCategory || !cName) {
    throw new Error(
      'Sheet Templates wajib punya kolom "category" dan "name".'
    );
  }

  const drafts: PreviewDraft[] = [];
  const byLookup = new Map<string, PreviewDraft>();
  const seenKeys = new Set<string>();

  metaSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const id = cId ? cellStr(row.getCell(cId).value) : "";
    const categoryRaw = cellStr(row.getCell(cCategory).value);
    const name = cellStr(row.getCell(cName).value);
    const statusRaw = cStatus ? cellStr(row.getCell(cStatus).value) : "";
    if (!id && !categoryRaw && !name && !statusRaw) return;

    const errors: string[] = [];
    const category = parseCategory(categoryRaw);
    if (!category) {
      errors.push(`category tidak valid (${categoryRaw || "kosong"})`);
    }
    if (!name) errors.push("name wajib diisi");
    const activeParsed = parseActive(statusRaw);
    if (statusRaw && !activeParsed) {
      errors.push(`status "${statusRaw}" tidak valid (aktif/nonaktif)`);
    }

    const key = id || (category && name ? `name:${nameKey(category, name)}` : "");
    if (key && seenKeys.has(key)) {
      errors.push("duplikat id atau nama di sheet Templates");
    } else if (key) {
      seenKeys.add(key);
    }

    const draft: PreviewDraft = {
      row: rowNumber,
      sheet: "Templates",
      excelRow: rowNumber,
      id,
      category: category || categoryRaw,
      categoryValid: category,
      name,
      active: activeParsed || (statusRaw ? "" : "1"),
      steps: [],
      errors,
    };
    drafts.push(draft);
    if (key && !draft.errors.includes("duplikat id atau nama di sheet Templates")) {
      byLookup.set(key, draft);
      if (id) byLookup.set(`id:${id}`, draft);
      if (category && name) byLookup.set(nameKey(category, name), draft);
    }
  });

  const stepMap = headerMap(stepsSheet);
  const sTplId = colOf(stepMap, "template_id", "id");
  const sTplName = colOf(
    stepMap,
    "template_name",
    "name template",
    "nama template"
  );
  const sPhase = colOf(stepMap, "phase", "fase");
  const sName = colOf(stepMap, "name", "nama", "step", "langkah");
  const sOrder = colOf(stepMap, "order", "urutan", "no", "no.");
  const sMp = colOf(stepMap, "man_power", "manpower", "mp");
  const sStd = colOf(stepMap, "std_minutes", "std minutes", "menit", "stp_minutes");

  if (!sName) {
    throw new Error('Sheet Steps wajib punya kolom "name".');
  }
  if (!sTplId && !sTplName) {
    throw new Error(
      'Sheet Steps wajib punya "template_id" dan/atau "template_name".'
    );
  }

  const extraRows: PreviewDraft[] = [];

  stepsSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const templateId = sTplId ? cellStr(row.getCell(sTplId).value) : "";
    const templateName = sTplName ? cellStr(row.getCell(sTplName).value) : "";
    const phase = sPhase ? cellStr(row.getCell(sPhase).value) : "";
    const name = cellStr(row.getCell(sName).value);
    const orderRaw = sOrder ? cellStr(row.getCell(sOrder).value) : "";
    const mpRaw = sMp ? cellStr(row.getCell(sMp).value) : "";
    const stdRaw = sStd ? cellStr(row.getCell(sStd).value) : "";
    if (!templateId && !templateName && !phase && !name && !orderRaw) return;

    const pushStepError = (message: string) => {
      extraRows.push({
        row: 100000 + rowNumber,
        sheet: "Steps",
        excelRow: rowNumber,
        id: templateId,
        category: "",
        categoryValid: null,
        name: templateName || name,
        active: "",
        steps: [],
        errors: [message],
      });
    };

    if (!name) {
      pushStepError("name step wajib");
      return;
    }

    let draft =
      (templateId && byLookup.get(`id:${templateId}`)) ||
      (templateId && byLookup.get(templateId)) ||
      null;

    if (!draft && templateName) {
      for (const item of drafts) {
        if (item.name.toLowerCase() === templateName.toLowerCase()) {
          draft = item;
          break;
        }
      }
    }

    if (!draft && templateId) {
      const existing = getJobTemplate(templateId, { includeInactive: true });
      if (!existing) {
        pushStepError(
          `template_id "${templateId}" tidak ada di sheet Templates / katalog`
        );
        return;
      }
      const stubKey = `id-only:${templateId}`;
      draft = byLookup.get(stubKey) || null;
      if (!draft) {
        draft = {
          row: 200000 + extraRows.length + drafts.length,
          sheet: "Templates",
          excelRow: rowNumber,
          id: existing.id,
          category: existing.category,
          categoryValid: existing.category,
          name: existing.name,
          active: existing.active === "0" ? "0" : "1",
          steps: [],
          errors: [],
        };
        drafts.push(draft);
        byLookup.set(stubKey, draft);
        byLookup.set(`id:${existing.id}`, draft);
      }
    }

    if (!draft) {
      pushStepError(
        `tidak cocok ke template (${templateId || templateName || "?"})`
      );
      return;
    }

    draft.steps.push({
      phase,
      name,
      order: orderRaw
        ? Math.max(1, Math.round(Number(orderRaw) || draft.steps.length + 1))
        : draft.steps.length + 1,
      man_power: mpRaw ? Math.max(0, Number(mpRaw) || 0) : 0,
      std_minutes: stdRaw ? Math.max(0, Math.round(Number(stdRaw) || 0)) : 0,
    });
  });

  const rows = [...drafts, ...extraRows].map(toPreviewRow);
  if (!rows.length) {
    throw new Error("Tidak ada baris template yang bisa diimpor");
  }

  const okCount = rows.filter((r) => r.ok).length;
  return {
    rows,
    okCount,
    errorCount: rows.length - okCount,
  };
}

/** Write selected preview rows into the catalog. */
export function commitJobTemplatesImport(
  rows: JobTemplateImportCommitRow[]
): { imported: number; updated: number; skipped: string[] } {
  const skipped: string[] = [];
  let imported = 0;
  let updated = 0;

  for (const row of rows) {
    const category = parseCategory(String(row.category || ""));
    const name = String(row.name || "").trim();
    const steps = Array.isArray(row.steps) ? row.steps : [];
    if (!category) {
      skipped.push(`${name || row.id || "?"}: category tidak valid`);
      continue;
    }
    if (!name) {
      skipped.push(`${row.id || "?"}: name wajib diisi`);
      continue;
    }
    if (!steps.length) {
      skipped.push(`Template "${name}" dilewati: tidak ada step`);
      continue;
    }

    try {
      const existing = findExistingTemplate(
        String(row.id || ""),
        category,
        name
      );
      const active =
        row.active != null && String(row.active) !== ""
          ? String(row.active)
          : existing?.active || "1";
      if (existing) {
        updateJobTemplate(existing.id, {
          category,
          name,
          active,
          steps,
        });
        updated += 1;
      } else {
        createJobTemplate({
          id: row.id ? String(row.id) : undefined,
          category,
          name,
          active,
          steps,
        });
        imported += 1;
      }
    } catch (e) {
      skipped.push(
        `Template "${name}": ${e instanceof Error ? e.message : "gagal simpan"}`
      );
    }
  }

  if (imported === 0 && updated === 0) {
    throw new Error(skipped[0] || "Tidak ada template yang berhasil diimpor");
  }

  return {
    imported,
    updated,
    skipped: skipped.slice(0, 50),
  };
}
