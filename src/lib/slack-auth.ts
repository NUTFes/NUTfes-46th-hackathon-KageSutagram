import { cookies } from "next/headers";
import {
  OIDC_COOKIE,
  sealState,
  openState,
  exchangeSlack,
  type SlackConfig,
} from "./slack-oidc";
import {
  SESSION_COOKIE,
  SESSION_SECONDS,
  sessionCookieOptions,
  signSession,
  verifySession,
  safeReturnTo,
} from "./session";

export async function handleSlackAuth(request: Request, env: CloudflareEnv) {
  const jar = await cookies();
  const url = new URL(request.url);
  const secret = env.SESSION_SECRET ?? process.env.SESSION_SECRET ?? "";
  const value = (
    name:
      | "SLACK_CLIENT_ID"
      | "SLACK_CLIENT_SECRET"
      | "SLACK_TEAM_ID"
      | "APP_BASE_URL",
  ) => env[name] ?? process.env[name] ?? "";
  const config: SlackConfig = {
    clientId: value("SLACK_CLIENT_ID"),
    clientSecret: value("SLACK_CLIENT_SECRET"),
    teamId: value("SLACK_TEAM_ID"),
    baseUrl: value("APP_BASE_URL").replace(/\/$/, ""),
  };
  const go = (location: string) =>
    new Response(null, {
      status: 303,
      headers: {
        Location: location,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  try {
    if (!Object.values(config).every(Boolean) || secret.length < 32)
      return go("/admin/login?error=slack_config");
    const base = new URL(config.baseUrl);
    if (
      base.origin !== config.baseUrl ||
      (base.protocol !== "https:" &&
        !(
          base.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(base.hostname)
        ))
    )
      throw new Error("Invalid base URL");
    if (url.pathname.endsWith("/login")) {
      const state = {
        state: crypto.randomUUID(),
        nonce: crypto.randomUUID(),
        return_to: safeReturnTo(url.searchParams.get("return_to")),
        expires: Date.now() + 600_000,
      };
      jar.set(OIDC_COOKIE, await sealState(state, secret), {
        ...sessionCookieOptions(),
        maxAge: 600,
      });
      const target = new URL("https://slack.com/openid/connect/authorize");
      target.search = new URLSearchParams({
        client_id: config.clientId,
        scope: "openid profile email",
        redirect_uri: `${config.baseUrl}/api/auth/slack/callback`,
        state: state.state,
        nonce: state.nonce,
        team: config.teamId,
      }).toString();
      return go(target.toString());
    }
    const stateCookie = jar.get(OIDC_COOKIE)?.value;
    jar.set(OIDC_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
    const state = await openState(
      stateCookie,
      url.searchParams.get("state"),
      secret,
    );
    const code = url.searchParams.get("code");
    if (url.searchParams.has("error") || !code)
      throw new Error("Authorization denied");
    const profile = await exchangeSlack(code, state.nonce, config);
    const member = await env.DB.prepare(
      "SELECT id,is_active FROM admins WHERE slack_user_id=?",
    )
      .bind(profile.slack_user_id)
      .first<{ id: string; is_active: number }>();
    if (!member?.is_active) {
      // SlackのユーザーIDをリダイレクト先のURLに含めない。
      return go("/admin/login?error=unregistered");
    }
    const sessionId = crypto.randomUUID();
    const old = await verifySession(jar.get(SESSION_COOKIE)?.value, secret);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(old ?? ""),
      env.DB.prepare(
        "INSERT INTO sessions(id,admin_id,expires_at) VALUES(?,?,?)",
      ).bind(
        sessionId,
        member.id,
        new Date(Date.now() + SESSION_SECONDS * 1000).toISOString(),
      ),
    ]);
    jar.set(
      SESSION_COOKIE,
      await signSession(sessionId, secret),
      sessionCookieOptions(),
    );
    return go(state.return_to);
  } catch {
    jar.set(OIDC_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
    return go("/admin/login?error=slack_auth");
  }
}
