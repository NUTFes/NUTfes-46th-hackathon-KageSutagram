import { safeReturnTo } from "./session";
export const OIDC_COOKIE = "kage_oidc";
export type OidcState = {
  state: string;
  nonce: string;
  return_to: string;
  expires: number;
};
const enc = new TextEncoder();
async function key(secret: string) {
  if (secret.length < 32)
    throw new Error(
      "Slack 認証を確認できません。ログインからやり直してください。",
    );
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function sealState(value: OidcState, secret: string) {
  const data = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${data}.${Buffer.from(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(data))).toString("base64url")}`;
}
export async function openState(
  cookie: string | undefined,
  state: string | null,
  secret: string,
): Promise<OidcState> {
  if (!cookie || !state)
    throw new Error(
      "Slack 認証を確認できません。ログインからやり直してください。",
    );
  const [data, sig, ...extra] = cookie.split(".");
  if (
    extra.length ||
    !sig ||
    !(await crypto.subtle.verify(
      "HMAC",
      await key(secret),
      Buffer.from(sig, "base64url"),
      enc.encode(data),
    ))
  )
    throw new Error(
      "Slack 認証を確認できません。ログインからやり直してください。",
    );
  const v = JSON.parse(Buffer.from(data, "base64url").toString()) as OidcState;
  if (
    v.state !== state ||
    v.expires < Date.now() ||
    typeof v.expires !== "number" ||
    !Number.isFinite(v.expires) ||
    typeof v.nonce !== "string" ||
    !v.nonce
  )
    throw new Error(
      "Slack 認証を確認できません。ログインからやり直してください。",
    );
  return { ...v, return_to: safeReturnTo(v.return_to) };
}
export type SlackConfig = {
  clientId: string;
  clientSecret: string;
  teamId: string;
  baseUrl: string;
};
export async function exchangeSlack(
  code: string,
  nonce: string,
  config: SlackConfig,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher("https://slack.com/api/openid.connect.token", {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: `${config.baseUrl}/api/auth/slack/callback`,
    }),
  });
  const token = (await response.json()) as { ok?: boolean; id_token?: string };
  if (!response.ok || token.ok === false || !token.id_token)
    throw new Error(
      "Slack 認証を確認できません。ログインからやり直してください。",
    );
  const parts = token.id_token.split(".");
  if (parts.length !== 3)
    throw new Error(
      "Slack 認証を確認できません。ログインからやり直してください。",
    );
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
  if (header.alg !== "RS256" || typeof header.kid !== "string")
    throw new Error(
      "Slack 認証を確認できません。ログインからやり直してください。",
    );
  const jwksResponse = await fetcher("https://slack.com/openid/connect/keys", {
    signal: AbortSignal.timeout(15000),
  });
  if (!jwksResponse.ok)
    throw new Error(
      "Slack 認証を確認できません。ログインからやり直してください。",
    );
  const jwks = (await jwksResponse.json()) as {
    keys: (JsonWebKey & { kid?: string })[];
  };
  const jwk = jwks.keys.find(
    (k) =>
      k.kid === header.kid &&
      k.kty === "RSA" &&
      (!k.use || k.use === "sig") &&
      (!k.alg || k.alg === "RS256"),
  );
  if (!jwk)
    throw new Error(
      "Slack 認証を確認できません。ログインからやり直してください。",
    );
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  if (
    !(await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      Buffer.from(parts[2], "base64url"),
      enc.encode(`${parts[0]}.${parts[1]}`),
    ))
  )
    throw new Error(
      "Slack 認証を確認できません。ログインからやり直してください。",
    );
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  const now = Date.now() / 1000;
  if (
    claims.iss !== "https://slack.com" ||
    !(Array.isArray(claims.aud)
      ? claims.aud.includes(config.clientId)
      : claims.aud === config.clientId) ||
    (Array.isArray(claims.aud) &&
      claims.aud.length > 1 &&
      claims.azp !== config.clientId) ||
    typeof claims.exp !== "number" ||
    !Number.isFinite(claims.exp) ||
    claims.exp <= now ||
    typeof claims.iat !== "number" ||
    !Number.isFinite(claims.iat) ||
    claims.iat > now + 60 ||
    (claims.nbf !== undefined &&
      (typeof claims.nbf !== "number" ||
        !Number.isFinite(claims.nbf) ||
        claims.nbf > now)) ||
    claims.nonce !== nonce ||
    claims["https://slack.com/team_id"] !== config.teamId ||
    typeof claims.sub !== "string" ||
    !claims.sub
  )
    throw new Error(
      "Slack 認証を確認できません。ログインからやり直してください。",
    );
  const userId = claims["https://slack.com/user_id"] ?? claims.sub;
  if (typeof userId !== "string" || !/^[UW][A-Z0-9]{2,30}$/.test(userId))
    throw new Error(
      "Slack 認証を確認できません。ログインからやり直してください。",
    );
  return {
    slack_user_id: userId,
    display_name:
      typeof claims.name === "string" ? claims.name.slice(0, 80) : claims.sub,
    avatar_url: typeof claims.picture === "string" ? claims.picture : null,
  };
}
