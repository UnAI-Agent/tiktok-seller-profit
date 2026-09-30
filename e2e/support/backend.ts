import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pythonCommand } from "../../scripts/python-cmd.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const backendDir = path.join(root, "backend");

export type Api = {
  base: string;
  adminKey: string;
  telemetryKey: string;
  webhookSecret: string;
  dbPath: string;
  registerApi: (email: string, password?: string) => Promise<{ token: string; userId: number }>;
  loginApi: (email: string, password?: string) => Promise<string>;
  me: (token: string) => Promise<Record<string, unknown>>;
  verifyEmail: (uid: number, email: string) => Promise<void>;
  webhook: (type: string, obj: Record<string, unknown>, eventId?: string) => Promise<Response>;
  rows: (table: string) => Promise<unknown>;
  telemetry: () => Promise<unknown>;
  publishConfig: (doc: unknown) => Promise<void>;
  down: () => Promise<void>;
  up: (extra?: Record<string, string>) => Promise<void>;
  stop: () => Promise<void>;
};

let ipN = 10;

function nextIp() {
  ipN += 1;
  return `203.0.113.${ipN % 200}`;
}

async function waitHealth(dbPath: string) {
  const deadline = Date.now() + 30_000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch("http://127.0.0.1:8000/health");
      if (res.ok) {
        const body = (await res.json()) as { db?: string; db_path?: string };
        if (body.db !== "sqlite" || body.db_path !== dbPath) {
          throw new Error(`health is not the temp sqlite file: ${JSON.stringify(body)}`);
        }
        return;
      }
      last = `${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`backend did not become healthy: ${last}`);
}

export async function startBackend(): Promise<Api> {
  const py = pythonCommand();
  const dbPath = path.join(mkdtempSync(path.join(os.tmpdir(), "marginmark-e2e-")), "e2e.sqlite");
  const adminKey = randomBytes(32).toString("hex");
  const telemetryKey = randomBytes(32).toString("hex");
  const webhookSecret = `whsec_e2e_${randomBytes(16).toString("hex")}`;
  const adminApiToken = randomBytes(32).toString("hex");
  const keyFile = path.join(root, "qa", "report", "e2e-public-key.txt");
  const configPublicKey = existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : "";
  const sink = spawn(py.cmd, [...py.prefix, path.join(root, "e2e", "support", "smtp_sink.py")], {
    cwd: backendDir,
    stdio: "ignore",
  });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ENV: "development",
    APP_ENV: "local",
    DATABASE_URL: "",
    DATABASE_URL_UNPOOLED: "",
    DB_PATH: dbPath,
    STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: webhookSecret,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "1025",
    SMTP_USER: "",
    SMTP_PASSWORD: "",
    SMTP_FROM: "noreply@e2e.test",
    SUPPORT_INBOX: "support@e2e.test",
    ANTHROPIC_API_KEY: "",
    OTEL_EXPORTER_OTLP_ENDPOINT: "",
    JWT_SECRET: randomBytes(32).toString("hex"),
    ADMIN_KEY: adminKey,
    TELEMETRY_READ_KEY: telemetryKey,
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    FACEBOOK_APP_ID: "",
    FACEBOOK_APP_SECRET: "",
    TIKTOK_CLIENT_KEY: "",
    TIKTOK_CLIENT_SECRET: "",
    STRIPE_PRICE_PRO_MONTHLY: "",
    STRIPE_PRICE_PRO_YEARLY: "",
    STRIPE_PRICE_DIAMOND_MONTHLY: "",
    STRIPE_PRICE_DIAMOND_YEARLY: "",
    STRIPE_PRICE_TIKTOK_SELLER: "",
    STRIPE_PRICE_TIKTOK_SELLER_YEARLY: "",
    CONFIG_PUBLIC_KEY: configPublicKey,
    ADMIN_API_ENABLED: "1",
    ADMIN_API_TOKEN: adminApiToken,
    ADMIN_API_ALLOWLIST: "203.0.113.9",
  };
  let stderr = "";
  let api: ChildProcess | null = null;
  if (process.env.E2E_REUSE_API !== "1") {
    api = spawn(py.cmd, [...py.prefix, "-m", "uvicorn", "marginmark_app:app", "--host", "127.0.0.1", "--port", "8000"], {
      cwd: backendDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    api.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-2000);
    });
  }
  try {
    await waitHealth(dbPath);
  } catch (err) {
    api?.kill();
    sink.kill();
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${message}\n${stderr}`);
  }

  const base = "http://127.0.0.1:8000";

  async function json(method: string, urlPath: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has("Fly-Client-IP")) headers.set("Fly-Client-IP", nextIp());
    const res = await fetch(base + urlPath, { ...init, method, headers });
    return res;
  }

  return {
    base,
    adminKey,
    telemetryKey,
    webhookSecret,
    dbPath,
    async registerApi(email, password = "Valid-pass-1") {
      const res = await json("POST", "/auth/register", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error(`register ${res.status} ${await res.text()}`);
      const body = (await res.json()) as { access_token: string; user?: { id: number }; id?: number };
      const meRes = await json("GET", "/auth/me", { headers: { Authorization: `Bearer ${body.access_token}` } });
      const meBody = (await meRes.json()) as { id?: number; user_id?: number };
      return { token: body.access_token, userId: meBody.id ?? meBody.user_id ?? body.id ?? 0 };
    },
    async loginApi(email, password = "Valid-pass-1") {
      const res = await json("POST", "/auth/login", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error(`login ${res.status} ${await res.text()}`);
      return ((await res.json()) as { access_token: string }).access_token;
    },
    async me(token) {
      const res = await json("GET", "/auth/me", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`me ${res.status}`);
      return (await res.json()) as Record<string, unknown>;
    },
    async verifyEmail(uid, email) {
      if (email) {
        const listed = await fetch("http://127.0.0.1:1026/");
        const messages = (await listed.json()) as { to: string; body: string }[];
        const mine = [...messages].reverse().find((msg) => msg.to.toLowerCase().includes(email.toLowerCase()));
        const code = mine?.body.match(/\b(\d{6})\b/)?.[1];
        if (code) {
          const res = await json("POST", "/auth/verify-email", {
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${(await this.loginApi(email))}` },
            body: JSON.stringify({ code }),
          });
          if (res.ok) return;
        }
      }
      const res = await json("PUT", "/admin/db/rows", {
        headers: { "Content-Type": "application/json", "X-Admin-Key": adminKey },
        body: JSON.stringify({
          table: "users",
          pk: { id: uid },
          values: { email_verified_at: new Date().toISOString() },
        }),
      });
      if (!res.ok) throw new Error(`verify fallback ${res.status} ${await res.text()}`);
    },
    async webhook(type, obj, eventId = `evt_${randomBytes(6).toString("hex")}`) {
      const payload = JSON.stringify({
        id: eventId,
        object: "event",
        api_version: "2026-08-26.dahlia",
        created: Math.floor(Date.now() / 1000),
        type,
        livemode: false,
        data: { object: obj },
      });
      const timestamp = Math.floor(Date.now() / 1000);
      const digest = createHmac("sha256", webhookSecret).update(`${timestamp}.${payload}`).digest("hex");
      return json("POST", "/billing/webhook", {
        headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${timestamp},v1=${digest}` },
        body: payload,
      });
    },
    async rows(table) {
      const res = await json("GET", `/admin/db/rows?table=${encodeURIComponent(table)}`, {
        headers: { "X-Admin-Key": adminKey },
      });
      if (!res.ok) throw new Error(`rows ${res.status} ${await res.text()}`);
      return res.json();
    },
    async telemetry() {
      const res = await json("GET", "/admin/telemetry/events", { headers: { "X-Telemetry-Key": telemetryKey } });
      if (!res.ok) throw new Error(`telemetry ${res.status}`);
      return res.json();
    },
    async publishConfig(doc) {
      const res = await fetch(base + "/admin/v1/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminApiToken}`,
          "Fly-Client-IP": "203.0.113.9",
        },
        body: JSON.stringify(doc),
      });
      if (!res.ok) throw new Error(`config ${res.status} ${await res.text()}`);
    },
    async down() {
      api?.kill();
      api = null;
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        try {
          await fetch(base + "/health");
        } catch {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error("backend did not stop");
    },
    async up(extra = {}) {
      if (api) return;
      api = spawn(py.cmd, [...py.prefix, "-m", "uvicorn", "marginmark_app:app", "--host", "127.0.0.1", "--port", "8000"], {
        cwd: backendDir,
        env: { ...env, ...extra },
        stdio: ["ignore", "pipe", "pipe"],
      });
      await waitHealth(dbPath);
    },
    async stop() {
      api?.kill();
      sink.kill();
      await new Promise((resolve) => setTimeout(resolve, 300));
    },
  };
}
