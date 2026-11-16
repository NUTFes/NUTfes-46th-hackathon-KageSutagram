import { jstDate, period } from "./domain";
export async function cleanup(
  env: Pick<CloudflareEnv, "DB" | "IMAGES">,
  at = new Date(),
) {
  const rows = await env.DB.prepare("SELECT * FROM settings").all<{
    key: string;
    value: string;
  }>();
  const cfg = Object.fromEntries(rows.results.map((r) => [r.key, r.value]));
  let purged = false;
  if (
    cfg.festival_end &&
    period(cfg.festival_start, cfg.festival_end, at).purged
  ) {
    // R2の削除に失敗した場合はDBを残して次回に再試行する。
    let cursor: string | undefined;
    do {
      const objects = await env.IMAGES!.list({ cursor });
      if (objects.objects.length)
        await env.IMAGES!.delete(objects.objects.map((o) => o.key));
      cursor = objects.truncated ? objects.cursor : undefined;
    } while (cursor);
    await env.DB.batch(
      [
        "hashtags",
        "reports",
        "hearts",
        "replies",
        "posts",
        "judge_tokens",
        "map",
        "daily_usage",
        "rate_limits",
        "devices",
      ].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
    );
    purged = true;
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM judge_tokens WHERE expires_at<=?").bind(
      at.toISOString(),
    ),
    env.DB.prepare("DELETE FROM daily_usage WHERE date<?").bind(
      jstDate(new Date(at.getTime() - 7 * 86400000)),
    ),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(
      at.toISOString(),
    ),
    env.DB.prepare("DELETE FROM rate_limits WHERE window<?").bind(
      Math.floor(at.getTime() / 60000) - 1,
    ),
  ]);
  return { purged };
}
