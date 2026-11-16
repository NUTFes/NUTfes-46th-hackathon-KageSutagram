export const topics = {
  crowd: "混雑・待ち時間",
  status: "売り切れ・状況",
  recommend: "おすすめ・感想",
  tip: "穴場・豆知識",
  daily: "ただの日常",
};
export type Face = { x: number; y: number; w: number; h: number };
export function filterParameters(score: number) {
  const s = Math.max(0.15, Math.min(100, Math.max(0, score)) / 100);
  return {
    s,
    saturation: 1 - 0.8 * s,
    brightness: 1 - 0.35 * s,
    contrast: 1 - 0.2 * s,
    tint: 0.15 * s,
    noise: 12 * s,
    vignette: 0.6 * s,
  };
}
export function popularity(hearts: number, created: string, now = Date.now()) {
  return (
    hearts /
    Math.pow(Math.max(0, (now - Date.parse(created)) / 3600000) + 2, 1.5)
  );
}
export function freshness(
  created: string,
  now = Date.now(),
  fresh = 30,
  stale = 120,
) {
  const min = Math.max(0, (now - Date.parse(created)) / 60000);
  return min <= fresh ? "fresh" : min <= stale ? "stale" : "expired";
}
export function hashtags(text: string) {
  return [
    ...new Set(
      Array.from(
        text
          .normalize("NFKC")
          .toLowerCase()
          .matchAll(/#([\p{L}\p{N}_]+)/gu),
        (m) => m[1],
      ),
    ),
  ];
}
export function jstDate(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
export function period(start: string, end: string, now = new Date()) {
  const day = jstDate(now);
  const add = (n: number) =>
    new Date(Date.parse(end + "T00:00:00Z") + n * 86400000)
      .toISOString()
      .slice(0, 10);
  return {
    before: day < start,
    open: day >= start && day <= add(7),
    purged: day >= add(30),
    post_deadline: add(7),
    purge_at: add(30),
  };
}
export function postingAllowed(open: boolean, count: number) {
  return !open ? "out_of_period" : count >= 10 ? "daily_limit" : null;
}
export function publicPost<
  T extends { device_id: string; heart_count: number },
>(post: T, device: string | null) {
  const { device_id, heart_count, ...rest } = post;
  return {
    ...rest,
    is_owner: device_id === device,
    heart_count: device_id === device ? null : heart_count,
  };
}
export function reportStatus(count: number) {
  return count >= 3 ? "held" : "published";
}
export function validToken(
  t: {
    device_id: string;
    width: number;
    height: number;
    expires_at: string;
    used_at: string | null;
  },
  device: string,
  width: number,
  height: number,
  now = Date.now(),
) {
  return (
    t.device_id === device &&
    !t.used_at &&
    Date.parse(t.expires_at) > now &&
    t.width === width &&
    t.height === height
  );
}
export function parseJudge(raw: unknown) {
  const v = raw as Record<string, unknown>;
  if (
    !v ||
    typeof v.ok !== "boolean" ||
    !Number.isInteger(v.kira_score) ||
    Number(v.kira_score) < 0 ||
    Number(v.kira_score) > 100 ||
    typeof v.kira_reason !== "string" ||
    Array.from(v.kira_reason).length > 20 ||
    !Array.isArray(v.faces)
  )
    throw new Error("判定JSONが不正です");
  for (const f of v.faces as Face[])
    if (
      !f ||
      ![f.x, f.y, f.w, f.h].every(
        (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1,
      ) ||
      f.w <= 0 ||
      f.h <= 0 ||
      f.x + f.w > 1.001 ||
      f.y + f.h > 1.001
    )
      throw new Error("顔の座標が不正です");
  return v as unknown as {
    ok: boolean;
    reject_reason?: string;
    kira_score: number;
    kira_reason: string;
    faces: Face[];
  };
}
export function blocked(text: string) {
  return /殺す|死ね|電話番号|\b\d{3}[- ]\d{4}[- ]\d{4}\b/.test(text);
}
export async function sha256(value: string | ArrayBuffer) {
  return Buffer.from(
    await crypto.subtle.digest(
      "SHA-256",
      typeof value === "string" ? new TextEncoder().encode(value) : value,
    ),
  ).toString("hex");
}
export async function publicId(device: string, secret: string) {
  if (secret.length < 32)
    throw new Error("DEVICE_ID_SECRET は32文字以上必要です");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Buffer.from(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(device)),
  )
    .toString("hex")
    .slice(0, 10);
}
