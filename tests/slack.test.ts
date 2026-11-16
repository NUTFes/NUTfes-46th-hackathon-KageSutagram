import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  exchangeSlack,
  openState,
  sealState,
  OIDC_COOKIE,
} from "../src/lib/slack-oidc";
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined),
    set: (k: string, v: string) => jar.set(k, v),
  }),
}));
import { handleSlackAuth } from "../src/lib/slack-auth";
const secret = "s".repeat(32),
  config = {
    clientId: "client",
    clientSecret: "private",
    teamId: "TTEST",
    baseUrl: "https://kage.test",
  };
let pair: CryptoKeyPair, jwk: JsonWebKey;
beforeAll(async () => {
  pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
});
afterEach(() => {
  vi.unstubAllGlobals();
  jar.clear();
});
async function token(
  overrides: Record<string, unknown> = {},
  headerOverrides: Record<string, unknown> = {},
) {
  const encode = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = `${encode({ alg: "RS256", kid: "test", ...headerOverrides })}.${encode({ iss: "https://slack.com", aud: "client", sub: "U123TEST", name: "担当", nonce: "nonce", iat: Date.now() / 1000, exp: Date.now() / 1000 + 300, "https://slack.com/team_id": "TTEST", "https://slack.com/user_id": "U123TEST", ...overrides })}`;
  return `${data}.${Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(data))).toString("base64url")}`;
}
function mockFetch(jwt: string) {
  return vi.fn(async (url: unknown) =>
    Response.json(
      String(url).endsWith("/keys")
        ? { keys: [{ ...jwk, kid: "test", alg: "RS256" }] }
        : { ok: true, id_token: jwt },
    ),
  );
}
describe("Slack OIDC", () => {
  it("署名付きstate・期限・return_toを検証", async () => {
    const state = {
      state: "state",
      nonce: "nonce",
      return_to: "//evil.test",
      expires: Date.now() + 10000,
    };
    const cookie = await sealState(state, secret);
    expect((await openState(cookie, "state", secret)).return_to).toBe(
      "/admin/reports",
    );
    await expect(openState(cookie, "bad", secret)).rejects.toThrow();
    await expect(openState(cookie + "x", "state", secret)).rejects.toThrow();
    await expect(
      openState(
        await sealState({ ...state, expires: 0 }, secret),
        "state",
        secret,
      ),
    ).rejects.toThrow();
  });
  it("RSA署名・JWKSを確認し正しいユーザーを返す", async () => {
    const fetcher = mockFetch(await token());
    expect(
      (await exchangeSlack("code", "nonce", config, fetcher as typeof fetch))
        .slack_user_id,
    ).toBe("U123TEST");
    // リクエストの宛先も固定であることを確認する。
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://slack.com/api/openid.connect.token",
    );
  });
  it.each([
    { iss: "https://evil.test" },
    { aud: "wrong" },
    { exp: 0 },
    { nonce: "wrong" },
    { "https://slack.com/team_id": "OTHER" },
    { iat: Date.now() / 1000 + 600 },
    { aud: ["client", "other"], azp: "wrong" },
    { "https://slack.com/user_id": 123 },
  ])("不正claimを拒否 %j", async (claims) => {
    await expect(
      exchangeSlack(
        "code",
        "nonce",
        config,
        mockFetch(await token(claims)) as typeof fetch,
      ),
    ).rejects.toThrow();
  });
  it("署名改ざん・未知kid・別アルゴリズム・token失敗を拒否", async () => {
    const jwt = await token();
    const parts = jwt.split(".");
    parts[1] = Buffer.from("{}").toString("base64url");
    for (const bad of [
      parts.join("."),
      await token({}, { kid: "missing" }),
      await token({}, { alg: "none" }),
    ])
      await expect(
        exchangeSlack("code", "nonce", config, mockFetch(bad) as typeof fetch),
      ).rejects.toThrow();
    await expect(
      exchangeSlack(
        "code",
        "nonce",
        config,
        vi.fn(async () => Response.json({ ok: false })) as typeof fetch,
      ),
    ).rejects.toThrow();
  });
});
function environment(member: unknown = null) {
  const calls: { query: string; args: unknown[] }[] = [];
  const DB = {
    prepare(query: string) {
      const call = { query, args: [] as unknown[] };
      calls.push(call);
      return {
        bind(...args: unknown[]) {
          call.args = args;
          return this;
        },
        async first() {
          return member;
        },
      };
    },
    batch: vi.fn(async () => []),
  };
  return {
    env: {
      DB,
      SESSION_SECRET: secret,
      SLACK_CLIENT_ID: "client",
      SLACK_CLIENT_SECRET: "private",
      SLACK_TEAM_ID: "TTEST",
      APP_BASE_URL: config.baseUrl,
    } as unknown as CloudflareEnv,
    calls,
    DB,
  };
}
describe("Slack callback と登録待ち", () => {
  it("loginはstate/nonceと安全な戻り先をcookieに保存", async () => {
    const { env } = environment();
    const r = await handleSlackAuth(
      new Request(
        config.baseUrl + "/api/auth/slack/login?return_to=%2Fgallery",
      ),
      env,
    );
    const location = new URL(r.headers.get("location")!);
    expect(location.origin).toBe("https://slack.com");
    expect(location.searchParams.get("scope")).toBe("openid profile email");
    expect(
      (
        await openState(
          jar.get(OIDC_COOKIE),
          location.searchParams.get("state"),
          secret,
        )
      ).return_to,
    ).toBe("/gallery");
  });
  it.each([
    null,
    { id: "registered", is_active: 0 },
    { id: "registered", is_active: 1 },
  ])("未登録/解除済み/在籍中の分岐 %j", async (member) => {
    const { env, calls, DB } = environment(member);
    jar.set(
      OIDC_COOKIE,
      await sealState(
        {
          state: "state",
          nonce: "nonce",
          expires: Date.now() + 10000,
          return_to: "/gallery",
        },
        secret,
      ),
    );
    vi.stubGlobal("fetch", mockFetch(await token()));
    const r = await handleSlackAuth(
      new Request(
        config.baseUrl + "/api/auth/slack/callback?state=state&code=test",
      ),
      env,
    );
    expect(r.status).toBe(303);
    expect(jar.get(OIDC_COOKIE)).toBe("");
    if (member?.is_active) {
      expect(r.headers.get("location")).toBe("/gallery");
      expect(jar.get("kage_session")).toBeTruthy();
      expect(
        calls.some((c) => c.query.startsWith("INSERT INTO sessions")),
      ).toBe(true);
    } else {
      expect(r.headers.get("location")).toBe("/admin/login?error=unregistered");
      expect(jar.has("kage_session")).toBe(false);
      expect(DB.batch).not.toHaveBeenCalled();
    }
  });
  it("state不正ではfetchもDBも呼ばない", async () => {
    const { env, calls } = environment();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const r = await handleSlackAuth(
      new Request(
        config.baseUrl + "/api/auth/slack/callback?state=bad&code=test",
      ),
      env,
    );
    expect(r.headers.get("location")).toBe("/admin/login?error=slack_auth");
    expect(fetcher).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});
