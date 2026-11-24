import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api as login } from '../src/lib/api';

const mocks = vi.hoisted(() => ({ env: {} as CloudflareEnv }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({ env: mocks.env }),
}));


let sqlite: DatabaseSync;
const passcode = "test-demo-passcode";
const migrations = ["0000_busy_maverick.sql","0001_integrity.sql","0002_demo_login_attempts.sql"];

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DEMO_PASSCODE", undefined);
  sqlite = new DatabaseSync(":memory:");
  for (const migration of migrations) {
    sqlite.exec(readFileSync(new URL("../drizzle/" + migration, import.meta.url), "utf8"));
  }
  sqlite.exec("INSERT INTO admins VALUES ('sample-admin', 'FAKE_ADMIN', 'Fake admin', 1), ('real-account', 'UREAL', 'Real admin', 1);");
  mocks.env = {
    APP_ENV: "local", DEV_LOGIN: "1", SESSION_SECRET: "s".repeat(32),
    DEMO_PASSCODE: passcode,
    DB: {
      prepare(sql: string) {
        const statement = sqlite.prepare(sql);
        const bound = (...values: SQLInputValue[]) => ({
          first: async () => statement.get(...values) ?? null,
          all: async () => ({ results: statement.all(...values) }),
          raw: async () => statement.all(...values).map(row => Object.values(row)),
          run: async () => ({ results: [], success: Boolean(statement.run(...values)) }),
        });
        return { ...bound(), bind: bound };
      },
      batch: async (statements: { all(): Promise<unknown> }[]) => Promise.all(statements.map(statement => statement.all())),
    } as unknown as D1Database,
  } as CloudflareEnv;
});

afterEach(() => {
  sqlite.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const post = (input?: string, ip = "192.0.2.1", account = "sample-admin") => login(
  new Request("https://demo.example/api/auth/dev-login", {
    method: "POST",
    headers: { Origin: "https://demo.example", "CF-Connecting-IP": ip },
    body: new URLSearchParams({ admin_id: account, ...(input !== undefined ? { passcode: input } : {}) }),
  }),
);
const sessionCount = () => sqlite.prepare("SELECT COUNT(*) AS count FROM sessions").get()?.count;

it("requires the correct passcode in production and only signs in fake accounts", async () => {
  expect((await post()).status).toBe(403);
  expect((await post("wrong")).status).toBe(403);
  expect((await post(passcode, "192.0.2.1", "real-account")).status).toBe(401);
  expect(sessionCount()).toBe(0);
  expect((await post(passcode)).status).toBe(303);
  expect(sessionCount()).toBe(1);
});

it("keeps production dev login disabled when the secret is absent or too short", async () => {
  for (const value of [undefined, "short"]) {
    mocks.env.DEMO_PASSCODE = value;
    expect((await post(passcode)).status).toBe(404);
  }
  expect(sessionCount()).toBe(0);
});

it("limits concurrent failures per IP and restores access after 10 minutes", async () => {
  const start = Date.now();
  const now = vi.spyOn(Date, "now").mockReturnValue(start);
  const statuses = await Promise.all(Array.from({ length: 32 }, () => post("wrong")));
  expect(statuses.filter(response => response.status === 403)).toHaveLength(30);
  expect(statuses.filter(response => response.status === 429)).toHaveLength(2);
  expect((await post(passcode)).status).toBe(429);
  expect((await post(passcode, "192.0.2.2")).status).toBe(303);
  now.mockReturnValue(start + 10 * 60 * 1000);
  expect((await post(passcode)).status).toBe(303);
});
