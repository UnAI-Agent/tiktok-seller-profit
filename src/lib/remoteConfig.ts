import flags from "../flags.json";
import { CONFIG_PUBLIC_KEY_SPKI_B64 } from "../config/configPublicKey";
import { FEE_PRESETS, type FeePresetId } from "../config";

export const CONFIG_CACHE_KEY = "remoteConfigCache";
export const INSTALL_ID_KEY = "installId";
export const KILL_REASON = "Temporarily paused while we fix an issue. Your data is safe.";
export const UPDATE_BANNER = "Please update MarginMark";

export const FLAG_KEYS = [
  "overlay",
  "productCheck",
  "aiInsights",
  "trendsTelemetry",
  "trendsView",
  "diamondEnabled",
  "statementImport",
  "bulkScan",
  "promoGuard",
  "whatIf",
  "csvExport",
  "creatorProfit",
  "bulkCost",
] as const;

export type FlagKey = (typeof FLAG_KEYS)[number];

const SERVER_FLAGS = new Set<FlagKey>(FLAG_KEYS.filter((key) => key !== "overlay"));

export type FlagSpec = {
  enabled: boolean;
  rolloutPct: number;
  minVersion?: string;
  tiers?: Array<"free" | "pro" | "diamond">;
  reason?: string;
  statusUrl?: string;
};

export type RemoteConfig = {
  version: number;
  issuedAt: string;
  expiresAt: string;
  minSupportedVersion: string;
  flags: Record<FlagKey, FlagSpec>;
  feePresets: Record<string, { platformFeePct: number; paymentFeePct: number; paymentFixed: number }>;
  selectors: Record<string, { version: number; fields: Record<string, { css?: string; labelText?: string; attr?: string }> }>;
  thresholds: Record<string, number>;
  messages: { announcement?: string; updateBanner?: string };
  signature: string;
};

export type FeatureState = {
  enabled: boolean;
  reason: string;
  statusUrl?: string;
  updateRequired: boolean;
};

const EXECUTABLE = /javascript:|<script|eval\(|new\s+function/i;
const SURFACES = new Set(["product-edit", "product-list"]);
const FIELDS = new Set(["productTitle", "listPrice", "unitsSold", "spsScore"]);

export function bundledFlags(): Record<FlagKey, FlagSpec> {
  const out = {} as Record<FlagKey, FlagSpec>;
  for (const key of FLAG_KEYS) {
    const row = flags[key];
    out[key] = { enabled: row.enabled, rolloutPct: row.rolloutPct };
  }
  return out;
}

export function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = sortValue(src[key]);
    return out;
  }
  return value;
}

export function canonicalConfigBody(doc: Record<string, unknown>): string {
  const body = { ...doc };
  delete body.signature;
  return JSON.stringify(sortValue(body));
}

function bad(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function scanStrings(value: unknown): boolean {
  if (typeof value === "string") return EXECUTABLE.test(value);
  if (Array.isArray(value)) return value.some(scanStrings);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(scanStrings);
  }
  return false;
}

export function validateRemoteConfig(raw: unknown): { ok: true; doc: RemoteConfig } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad("shape");
  const src = raw as Record<string, unknown>;
  if (scanStrings(src)) return bad("executable");
  if (typeof src.version !== "number" || !Number.isInteger(src.version) || src.version < 1) return bad("version");
  if (typeof src.issuedAt !== "string" || typeof src.expiresAt !== "string") return bad("dates");
  if (typeof src.minSupportedVersion !== "string" || src.minSupportedVersion.length > 20) return bad("minVersion");
  if (typeof src.signature !== "string" || src.signature.length < 40 || src.signature.length > 200) return bad("signature");
  if (!src.flags || typeof src.flags !== "object" || Array.isArray(src.flags)) return bad("flags");
  const flagSrc = src.flags as Record<string, unknown>;
  const flagKeys = Object.keys(flagSrc);
  if (flagKeys.length !== FLAG_KEYS.length || FLAG_KEYS.some((key) => !flagKeys.includes(key))) return bad("flag-keys");
  const flagsOut = {} as Record<FlagKey, FlagSpec>;
  for (const key of FLAG_KEYS) {
    const row = flagSrc[key];
    if (!row || typeof row !== "object" || Array.isArray(row)) return bad("flag");
    const item = row as Record<string, unknown>;
    const allowed = new Set(["enabled", "rolloutPct", "minVersion", "tiers", "reason", "statusUrl"]);
    if (Object.keys(item).some((name) => !allowed.has(name))) return bad("flag-field");
    if (typeof item.enabled !== "boolean") return bad("flag-enabled");
    if (typeof item.rolloutPct !== "number" || item.rolloutPct < 0 || item.rolloutPct > 100) return bad("rollout");
    const spec: FlagSpec = { enabled: item.enabled, rolloutPct: item.rolloutPct };
    if (item.minVersion !== undefined) {
      if (typeof item.minVersion !== "string" || item.minVersion.length > 20) return bad("flag-min");
      spec.minVersion = item.minVersion;
    }
    if (item.reason !== undefined) {
      if (typeof item.reason !== "string" || item.reason.length > 120) return bad("reason");
      spec.reason = item.reason;
    }
    if (item.statusUrl !== undefined) {
      if (typeof item.statusUrl !== "string" || !isHttps(item.statusUrl)) return bad("statusUrl");
      spec.statusUrl = item.statusUrl;
    }
    if (item.tiers !== undefined) {
      if (!Array.isArray(item.tiers) || item.tiers.some((tier) => tier !== "free" && tier !== "pro" && tier !== "diamond")) {
        return bad("tiers");
      }
      spec.tiers = item.tiers as FlagSpec["tiers"];
    }
    flagsOut[key] = spec;
  }
  if (!src.feePresets || typeof src.feePresets !== "object" || Array.isArray(src.feePresets)) return bad("fees");
  const feeOut: RemoteConfig["feePresets"] = {};
  for (const [id, value] of Object.entries(src.feePresets as Record<string, unknown>)) {
    if (id !== "us-standard" && id !== "us-jewelry" && id !== "us-legacy") return bad("fee-id");
    if (!value || typeof value !== "object") return bad("fee");
    const fee = value as Record<string, unknown>;
    if (Object.keys(fee).some((name) => !["platformFeePct", "paymentFeePct", "paymentFixed"].includes(name))) return bad("fee-field");
    for (const name of ["platformFeePct", "paymentFeePct", "paymentFixed"] as const) {
      if (typeof fee[name] !== "number" || fee[name] < 0 || fee[name] > 100) return bad("fee-num");
    }
    feeOut[id] = {
      platformFeePct: fee.platformFeePct as number,
      paymentFeePct: fee.paymentFeePct as number,
      paymentFixed: fee.paymentFixed as number,
    };
  }
  if (!src.selectors || typeof src.selectors !== "object" || Array.isArray(src.selectors)) return bad("selectors");
  const selectors = {} as RemoteConfig["selectors"];
  for (const [surface, value] of Object.entries(src.selectors as Record<string, unknown>)) {
    if (!SURFACES.has(surface) || !value || typeof value !== "object") return bad("surface");
    const surfaceRow = value as Record<string, unknown>;
    if (typeof surfaceRow.version !== "number" || !surfaceRow.fields || typeof surfaceRow.fields !== "object") return bad("surface");
    const fields: RemoteConfig["selectors"][string]["fields"] = {};
    for (const [field, spec] of Object.entries(surfaceRow.fields as Record<string, unknown>)) {
      if (!FIELDS.has(field) || !spec || typeof spec !== "object") return bad("field");
      const fieldRow = spec as Record<string, unknown>;
      if (Object.keys(fieldRow).some((name) => !["css", "labelText", "attr"].includes(name))) return bad("field-key");
      const next: { css?: string; labelText?: string; attr?: string } = {};
      if (fieldRow.css !== undefined) {
        if (typeof fieldRow.css !== "string" || fieldRow.css.length > 200) return bad("css");
        next.css = fieldRow.css;
      }
      if (fieldRow.labelText !== undefined) {
        if (typeof fieldRow.labelText !== "string" || fieldRow.labelText.length > 80) return bad("label");
        next.labelText = fieldRow.labelText;
      }
      if (fieldRow.attr !== undefined) {
        if (typeof fieldRow.attr !== "string" || fieldRow.attr.length > 40) return bad("attr");
        next.attr = fieldRow.attr;
      }
      fields[field] = next;
    }
    selectors[surface] = { version: surfaceRow.version, fields };
  }
  if (!src.thresholds || typeof src.thresholds !== "object" || Array.isArray(src.thresholds)) return bad("thresholds");
  const thresholds: Record<string, number> = {};
  for (const [key, value] of Object.entries(src.thresholds as Record<string, unknown>)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,40}$/.test(key) || typeof value !== "number" || !Number.isFinite(value)) return bad("threshold");
    thresholds[key] = value;
  }
  if (!src.messages || typeof src.messages !== "object" || Array.isArray(src.messages)) return bad("messages");
  const messageRow = src.messages as Record<string, unknown>;
  if (Object.keys(messageRow).some((name) => name !== "announcement" && name !== "updateBanner")) return bad("message-key");
  const messages: RemoteConfig["messages"] = {};
  if (messageRow.announcement !== undefined) {
    if (typeof messageRow.announcement !== "string" || messageRow.announcement.length > 500) return bad("announcement");
    messages.announcement = messageRow.announcement;
  }
  if (messageRow.updateBanner !== undefined) {
    if (typeof messageRow.updateBanner !== "string" || messageRow.updateBanner.length > 200) return bad("banner");
    messages.updateBanner = messageRow.updateBanner;
  }
  return {
    ok: true,
    doc: {
      version: src.version,
      issuedAt: src.issuedAt,
      expiresAt: src.expiresAt,
      minSupportedVersion: src.minSupportedVersion,
      flags: flagsOut,
      feePresets: feeOut,
      selectors,
      thresholds,
      messages,
      signature: src.signature,
    },
  };
}

export function compareVersions(left: string, right: string): number {
  const a = left.split(".").map((part) => Number(part) || 0);
  const b = right.split(".").map((part) => Number(part) || 0);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function rolloutBucket(installId: string, flag: string): number {
  let hash = 2166136261;
  const text = `${installId}:${flag}`;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 100;
}

function b64ToBytes(value: string): Uint8Array | null {
  try {
    const bin = atob(value);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export async function verifySignature(
  doc: RemoteConfig,
  publicKeySpkiB64: string,
): Promise<boolean> {
  if (!publicKeySpkiB64) return false;
  const keyBytes = b64ToBytes(publicKeySpkiB64);
  const sigBytes = b64ToBytes(doc.signature);
  if (!keyBytes || !sigBytes || !globalThis.crypto?.subtle) return false;
  try {
    const key = await crypto.subtle.importKey(
      "spki",
      keyBytes.slice(),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const data = new TextEncoder().encode(canonicalConfigBody(doc));
    return crypto.subtle.verify({ name: "Ed25519" }, key, sigBytes.slice(), data);
  } catch {
    return false;
  }
}

export async function acceptPublishedConfig(
  raw: unknown,
  cached: RemoteConfig | null,
  nowMs: number,
  publicKeySpkiB64 = CONFIG_PUBLIC_KEY_SPKI_B64,
): Promise<RemoteConfig | null> {
  const parsed = validateRemoteConfig(raw);
  if (!parsed.ok) return cached;
  const expires = Date.parse(parsed.doc.expiresAt);
  if (!Number.isFinite(expires) || expires <= nowMs) return cached;
  if (cached && parsed.doc.version < cached.version) return cached;
  if (!(await verifySignature(parsed.doc, publicKeySpkiB64))) return cached;
  return parsed.doc;
}

export function evaluateFlag(
  flag: FlagKey,
  docFlags: Record<FlagKey, FlagSpec>,
  ctx: { tier: "free" | "pro" | "diamond"; version: string; installId: string; minSupportedVersion?: string },
): FeatureState {
  const spec = docFlags[flag];
  const updateRequired = Boolean(
    ctx.minSupportedVersion && compareVersions(ctx.version, ctx.minSupportedVersion) < 0,
  );
  const reason = spec?.reason || KILL_REASON;
  if (updateRequired && SERVER_FLAGS.has(flag)) {
    return { enabled: false, reason: UPDATE_BANNER, updateRequired: true };
  }
  const bundledOn = bundledFlags()[flag].enabled;
  if (!bundledOn || !spec?.enabled) return { enabled: false, reason, statusUrl: spec?.statusUrl, updateRequired };
  if (spec.minVersion && compareVersions(ctx.version, spec.minVersion) < 0) {
    return { enabled: false, reason: UPDATE_BANNER, statusUrl: spec.statusUrl, updateRequired: true };
  }
  if (spec.tiers && !spec.tiers.includes(ctx.tier)) {
    return { enabled: false, reason, statusUrl: spec.statusUrl, updateRequired };
  }
  if (rolloutBucket(ctx.installId, flag) >= spec.rolloutPct) {
    return { enabled: false, reason, statusUrl: spec.statusUrl, updateRequired };
  }
  return { enabled: true, reason: "", updateRequired };
}

export function announcementFromVerified(doc: RemoteConfig | null): string | null {
  const note = doc?.messages.announcement?.trim();
  return note ? note : null;
}

export function presetFees(
  preset: FeePresetId,
  current: { platformFeePct: number; paymentFeePct: number; paymentFixed: number },
  remote: RemoteConfig | null,
): { platformFeePct: number; paymentFeePct: number; paymentFixed: number } {
  if (preset === "custom") return current;
  const bundled = FEE_PRESETS[preset];
  const published = remote?.feePresets[preset];
  const matchesBundled =
    current.platformFeePct === bundled.platformFeePct &&
    current.paymentFeePct === bundled.paymentFeePct &&
    current.paymentFixed === bundled.paymentFixed;
  const matchesRemote =
    published !== undefined &&
    current.platformFeePct === published.platformFeePct &&
    current.paymentFeePct === published.paymentFeePct &&
    current.paymentFixed === published.paymentFixed;
  if (published && (matchesBundled || matchesRemote)) return published;
  return {
    platformFeePct: bundled.platformFeePct,
    paymentFeePct: bundled.paymentFeePct,
    paymentFixed: bundled.paymentFixed,
  };
}

export async function refreshRemoteConfig(): Promise<void> {
  const { API_BASE_URL, SERVICE_SLUG } = await import("../config");
  const cachedRaw = await chrome.storage.local.get(CONFIG_CACHE_KEY);
  const cachedParsed = validateRemoteConfig(cachedRaw[CONFIG_CACHE_KEY]);
  const cached = cachedParsed.ok ? cachedParsed.doc : null;
  try {
    const res = await fetch(
      `${API_BASE_URL}/config/remote?service=${encodeURIComponent(SERVICE_SLUG)}`,
    );
    if (!res.ok) return;
    const body = (await res.json()) as { published?: boolean };
    if (body.published === false) return;
    const next = await acceptPublishedConfig(body, cached, Date.now());
    if (next) await chrome.storage.local.set({ [CONFIG_CACHE_KEY]: next });
  } catch {
    /* keep the last good config */
  }
}
