import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { hostname as osHostname, networkInterfaces } from "os";
import { join } from "path";

const CERT_DIR = join(process.cwd(), "certs");
const CERT_FILE = join(CERT_DIR, "lan-cert.pem");
const KEY_FILE = join(CERT_DIR, "lan-key.pem");
const SAN_FILE = join(CERT_DIR, "lan-san.txt");

export type LanTls = {
  cert: Buffer;
  key: Buffer;
  hosts: string[];
};

function lanNamesAndIps(preferredHost: string) {
  const names = new Set<string>([
    preferredHost,
    "localhost",
    osHostname(),
    osHostname().replace(/\.local$/i, ""),
  ]);
  const ips = new Set<string>(["127.0.0.1", "::1"]);
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets || []) {
      if (!net.address || net.internal) continue;
      ips.add(net.address);
    }
  }
  return {
    names: [...names].filter(Boolean).sort(),
    ips: [...ips].sort(),
  };
}

function sanLine(preferredHost: string) {
  const { names, ips } = lanNamesAndIps(preferredHost);
  const dns = names.map((n) => `DNS:${n}`).join(",");
  const ip = ips.map((n) => `IP:${n}`).join(",");
  return [dns, ip].filter(Boolean).join(",");
}

function generateCert(preferredHost: string, san: string) {
  mkdirSync(CERT_DIR, { recursive: true });
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-sha256",
      "-days",
      "825",
      "-nodes",
      "-keyout",
      KEY_FILE,
      "-out",
      CERT_FILE,
      "-subj",
      "/CN=PRIMA LAN",
      "-addext",
      `subjectAltName=${san}`,
    ],
    { stdio: "pipe" }
  );
  writeFileSync(SAN_FILE, san, "utf8");
}

function trustWindowsUserRoot() {
  if (process.platform !== "win32") return;
  try {
    execFileSync(
      "certutil",
      ["-addstore", "-user", "Root", CERT_FILE],
      { stdio: "pipe" }
    );
  } catch {
    /* no admin / policy — browser will show Continue */
  }
}

export function tlsEnabled() {
  const raw = (process.env.TLS_ENABLE || "").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "on") return true;
  const url = process.env.AUTH_URL || process.env.NEXTAUTH_URL || "";
  return url.startsWith("https://");
}

export function loadLanTls(preferredHost: string): LanTls {
  const certPath = process.env.TLS_CERT || CERT_FILE;
  const keyPath = process.env.TLS_KEY || KEY_FILE;
  const custom = Boolean(process.env.TLS_CERT || process.env.TLS_KEY);
  const san = sanLine(preferredHost);

  if (!custom) {
    const stale =
      !existsSync(CERT_FILE) ||
      !existsSync(KEY_FILE) ||
      (existsSync(SAN_FILE) ? readFileSync(SAN_FILE, "utf8") !== san : true);
    if (stale) {
      generateCert(preferredHost, san);
      trustWindowsUserRoot();
    }
  }

  const { names, ips } = lanNamesAndIps(preferredHost);
  return {
    cert: readFileSync(certPath),
    key: readFileSync(keyPath),
    hosts: [...names, ...ips],
  };
}
