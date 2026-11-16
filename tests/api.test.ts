import { it, expect, vi } from "vitest";
import { sha256 } from "../src/lib/domain";
import { signSession } from "../src/lib/session";
const mocks = vi.hoisted(() => ({ env: {} as any }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({ env: mocks.env }),
}));
import { api } from "../src/lib/api";
it("一覧・詳細・公開ユーザーのAPIが本人にハート数とdevice_idを漏らさない", async () => {
  const secret = "a".repeat(64),
    device = await sha256(secret);
  const post = {
    id: "p1",
    device_id: device,
    public_id: "public",
    heart_count: 99,
    status: "published",
    created_at: new Date().toISOString(),
    nickname: "陰",
  };
  mocks.env = {
    SESSION_SECRET: "s".repeat(32),
    DB: {
      prepare: (sql: string) => {
        const statement = {
          bind: () => statement,
          all: async () => ({
            results: sql.includes("FROM settings")
              ? [
                  { key: "festival_start", value: "2026-01-01" },
                  { key: "festival_end", value: "2099-01-01" },
                ]
              : sql.includes("FROM posts")
                ? [post]
                : [],
          }),
          first: async () =>
            sql.includes("SELECT public_id")
              ? { public_id: "public", last_nickname: "陰" }
              : post,
        };
        return statement;
      },
    },
  };
  for (const path of ["posts", "posts/p1", "users/public"]) {
    const response = await api(
      new Request("http://localhost/api/" + path, {
        headers: { "X-Device-Secret": secret },
      }),
    );
    expect(response.status).toBe(200);
    const value = (await response.json()) as any;
    const p = value.post || value.posts[0];
    expect(p.heart_count).toBeNull();
    expect(p).not.toHaveProperty("device_id");
  }
  const response = await api(new Request("http://localhost/api/posts"));
  expect(((await response.json()) as any).posts[0].heart_count).toBe(99);
});

function adminEnvironment(baseUrl?: string) {
  mocks.env = {
    SESSION_SECRET: "s".repeat(32),
    DEVICE_ID_SECRET: "d".repeat(32),
    APP_BASE_URL: baseUrl,
    DB: {
      prepare: (sql: string) => {
        const statement = {
          bind: () => statement,
          run: async () => ({}),
          all: async () => ({
            results: sql.includes("FROM places")
              ? [{ id: "p1", name: "会場" }]
              : [],
          }),
          first: async () =>
            sql.includes("JOIN admins") ? { id: "admin" } : null,
        };
        return statement;
      },
    },
  };
}

it.each([
  ["https://qr.example", "https://qr.example"],
  ["http://localhost:3000", "http://localhost:3000"],
  ["bad-url", "https://request.example"],
  ["https://qr.example/path", "https://request.example"],
  ["http://qr.example", "https://request.example"],
])("admin QR API validates APP_BASE_URL %s", async (configured, expected) => {
  adminEnvironment(configured);
  const cookie = await signSession(
    crypto.randomUUID(),
    mocks.env.SESSION_SECRET,
  );
  const response = await api(
    new Request("https://request.example/api/admin/qr", {
      headers: { cookie: `kage_session=${cookie}` },
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    base_url: expected,
    places: [{ id: "p1", name: "会場" }],
  });
});

it.each([
  ["development", "local", "1", true],
  ["development", "local", undefined, false],
  ["production", "local", "1", false],
  ["development", "production", "1", false],
])(
  "me exposes dev login only when enabled (%s, %s, %s)",
  async (nodeEnv, appEnv, enabled, expected) => {
    adminEnvironment();
    mocks.env.APP_ENV = appEnv;
    mocks.env.DEV_LOGIN = enabled;
    vi.stubEnv("NODE_ENV", nodeEnv);
    try {
      const response = await api(
        new Request("http://localhost/api/me", {
          headers: { "X-Device-Secret": "a".repeat(64) },
        }),
      );
      expect(response.status).toBe(200);
      expect(((await response.json()) as any).dev_login_enabled).toBe(expected);
    } finally {
      vi.unstubAllEnvs();
    }
  },
);
