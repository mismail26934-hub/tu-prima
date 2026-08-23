/**
 * Microsoft Graph helpers for SharePoint Excel (client credentials).
 * Used for Meals Request → presence sync (available / offline), not master upsert.
 * Sharing URL is encoded for GET /shares/u!…/driveItem/content
 */

export type SharePointGraphConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  excelUrl: string;
};

/** Meals Request / kehadiran Excel on SharePoint (No. ID Badge = SN). */
export function getSharePointMealsConfig(): SharePointGraphConfig | null {
  const tenantId = String(process.env.AZURE_TENANT_ID || "").trim();
  const clientId = String(process.env.AZURE_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.AZURE_CLIENT_SECRET || "").trim();
  const excelUrl = String(
    process.env.SHAREPOINT_MEALS_EXCEL_URL ||
      process.env.SHAREPOINT_TECH_EXCEL_URL ||
      process.env.SHAREPOINT_EXCEL_URL ||
      ""
  ).trim();
  if (!tenantId || !clientId || !clientSecret || !excelUrl) return null;
  return { tenantId, clientId, clientSecret, excelUrl };
}

/** @deprecated use getSharePointMealsConfig */
export function getSharePointTechConfig(): SharePointGraphConfig | null {
  return getSharePointMealsConfig();
}

export function isSharePointMealsSyncConfigured(): boolean {
  return getSharePointMealsConfig() != null;
}

/** @deprecated use isSharePointMealsSyncConfigured */
export function isSharePointTechSyncConfigured(): boolean {
  return isSharePointMealsSyncConfigured();
}

/** Base64url encode a sharing URL for Graph /shares/{shareId} */
export function encodeSharingUrl(url: string): string {
  const b64 = Buffer.from(url.trim(), "utf8").toString("base64");
  return (
    "u!" +
    b64.replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_")
  );
}

let cachedToken: { value: string; expiresAt: number } | null = null;

export async function getGraphAccessToken(
  cfg: Pick<SharePointGraphConfig, "tenantId" | "clientId" | "clientSecret">
): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.value;
  }

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(
    cfg.tenantId
  )}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(
      json.error_description ||
        json.error ||
        `Gagal token Microsoft Graph (HTTP ${res.status})`
    );
  }

  const expiresIn = Number(json.expires_in || 3600);
  cachedToken = {
    value: json.access_token,
    expiresAt: now + expiresIn * 1000,
  };
  return json.access_token;
}

/** Download .xlsx bytes from a SharePoint sharing link via Graph. */
export async function downloadSharePointExcelBuffer(
  cfg?: SharePointGraphConfig
): Promise<Buffer> {
  const config = cfg || getSharePointMealsConfig();
  if (!config) {
    throw new Error(
      "SharePoint belum dikonfigurasi. Isi AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, dan SHAREPOINT_MEALS_EXCEL_URL di .env.local"
    );
  }

  const token = await getGraphAccessToken(config);
  const shareId = encodeSharingUrl(config.excelUrl);
  const url = `https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem/content`;

  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    redirect: "follow",
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = (await res.json()) as {
        error?: { message?: string; code?: string };
      };
      detail =
        err.error?.message ||
        err.error?.code ||
        detail;
    } catch {
      /* ignore */
    }
    throw new Error(
      `Gagal unduh Excel SharePoint: ${detail}. Pastikan app Entra punya izin Files.Read.All atau Sites.Read.All (admin consent) dan URL sharing valid.`
    );
  }

  const ab = await res.arrayBuffer();
  if (!ab.byteLength) {
    throw new Error("File Excel SharePoint kosong");
  }
  return Buffer.from(ab);
}
