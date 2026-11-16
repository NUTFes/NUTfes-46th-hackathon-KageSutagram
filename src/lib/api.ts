import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  canUseDevLogin,
  signSession,
  verifySession,
  SESSION_SECONDS,
} from "./session";
import {
  sha256,
  publicId,
  publicPost,
  period,
  jstDate,
  postingAllowed,
  validToken,
  hashtags,
  topics,
  popularity,
  freshness,
} from "./domain";
import { decodeImage } from "./image";
import { judge, checkReply } from "./gemini";
type Row = Record<string, any>;
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
function fail(status: number, code: string, message: string): never {
  throw new ApiError(status, code, message);
}
function text(value: unknown, max: number, required = true) {
  if (
    typeof value !== "string" ||
    Array.from(value).length > max ||
    (required && !value.trim())
  )
    fail(400, "invalid", "入力内容を確認してください");
  return value.trim();
}
export async function api(request: Request) {
  try {
    return await handle(request);
  } catch (e) {
    if (e instanceof ApiError)
      return json({ error: { code: e.code, message: e.message } }, e.status);
    console.error(e);
    return json(
      {
        error: {
          code: "internal_error",
          message: "処理に失敗しました。もう一度お試しください。",
        },
      },
      500,
    );
  }
}
async function handle(req: Request): Promise<Response> {
  const { env } = await getCloudflareContext({ async: true });
  const db = env.DB;
  const url = new URL(req.url),
    path = decodeURIComponent(url.pathname).split("/").filter(Boolean).slice(1),
    method = req.method,
    now = new Date().toISOString();
  const run = (sql: string, ...args: any[]) =>
    db
      .prepare(sql)
      .bind(...args)
      .run();
  const all = async (sql: string, ...args: any[]) =>
    (
      await db
        .prepare(sql)
        .bind(...args)
        .all<Row>()
    ).results;
  const one = (sql: string, ...args: any[]) =>
    db
      .prepare(sql)
      .bind(...args)
      .first<Row>();
  if (
    !["GET", "HEAD"].includes(method) &&
    req.headers.get("origin") !== url.origin
  )
    fail(403, "origin", "同じサイトから操作してください");
  const secret = req.headers.get("X-Device-Secret");
  if (secret && !/^[a-f0-9]{64}$/.test(secret))
    fail(400, "device", "端末の合言葉が不正です");
  const device = secret ? await sha256(secret) : null;
  const requireDevice = async () => {
    if (!device) fail(401, "device_required", "端末の合言葉が必要です");
    await run(
      "INSERT OR IGNORE INTO devices VALUES (?,?,?,?)",
      device,
      await publicId(device, env.DEVICE_ID_SECRET || ""),
      "名無しの陰",
      now,
    );
    return device;
  };
  const config = Object.fromEntries(
    (await all("SELECT * FROM settings")).map((r) => [r.key, r.value]),
  );
  const state = period(
    config.festival_start || "9999-01-01",
    config.festival_end || "9999-01-01",
  );
  const usage = async () =>
    Number(
      (
        await one(
          "SELECT post_count FROM daily_usage WHERE device_id=? AND date=?",
          device,
          jstDate(),
        )
      )?.post_count || 0,
    );
  const checkPosting = async () => {
    const code = postingAllowed(state.open, await usage());
    if (code)
      fail(
        code === "out_of_period" ? 403 : 429,
        code,
        code === "daily_limit" ? "今日は10枚までです" : "投稿期間外です",
      );
  };
  const sessionValue = req.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("kage_session="))
    ?.slice(13);
  const session = await verifySession(sessionValue, env.SESSION_SECRET || "");
  const admin = session
    ? await one(
        "SELECT admins.* FROM sessions JOIN admins ON admins.id=sessions.admin_id WHERE sessions.id=? AND expires_at>? AND is_active=1",
        session,
        now,
      )
    : null;
  const serialize = (p: Row) => {
    const { judge_token, ...safe } = p;
    return publicPost(
      safe as Row & { device_id: string; heart_count: number },
      device,
    );
  };
  async function visiblePost(id: string) {
    const p = await one(
      "SELECT posts.*,devices.public_id FROM posts JOIN devices USING(device_id) WHERE posts.id=? AND status='published'",
      id,
    );
    if (!p || state.purged) fail(404, "not_found", "投稿が見つかりません");
    return p;
  }
  async function listPosts() {
    if (state.purged) return [];
    let rows = await all(
      "SELECT posts.*,devices.public_id FROM posts JOIN devices USING(device_id) WHERE status='published'",
    );
    for (const [param, key] of [
      ["topic", "topic"],
      ["place", "place_id"],
      ["user", "public_id"],
    ]) {
      const v = url.searchParams.get(param);
      if (v) rows = rows.filter((r) => r[key] === v);
    }
    const tag = url.searchParams.get("tag");
    if (tag) {
      const ids = new Set(
        (
          await all(
            "SELECT DISTINCT COALESCE(hashtags.post_id,replies.post_id) AS id FROM hashtags LEFT JOIN replies ON replies.id=hashtags.reply_id AND replies.status='published' WHERE tag=?",
            tag.normalize("NFKC").toLowerCase(),
          )
        ).map((r) => r.id),
      );
      rows = rows.filter((r) => ids.has(r.id));
    }
    rows.sort((a, b) =>
      url.searchParams.get("sort") === "popular"
        ? popularity(b.heart_count, b.created_at) -
          popularity(a.heart_count, a.created_at)
        : url.searchParams.get("sort") === "kage"
          ? b.kira_score - a.kira_score ||
            b.created_at.localeCompare(a.created_at)
          : b.created_at.localeCompare(a.created_at),
    );
    const cursor = url.searchParams.get("cursor");
    if (cursor) rows = rows.slice(rows.findIndex((r) => r.id === cursor) + 1);
    return rows;
  }
  async function addTags(
    value: string,
    post: string | null,
    reply: string | null,
  ) {
    for (const tag of hashtags(value))
      await run("INSERT INTO hashtags VALUES (?,?,?,?)", tag, post, reply, now);
  }
  if (path[0] === "auth") {
    if (path[1] === "slack")
      return json(
        {
          error: { code: "not_implemented", message: "Slack OIDCは準備中です" },
        },
        501,
      );
    if (path[1] === "dev-login" && method === "POST") {
      if (!canUseDevLogin(process.env.NODE_ENV, env.APP_ENV, env.DEV_LOGIN))
        fail(404, "not_found", "利用できません");
      const id = crypto.randomUUID();
      const a = await one("SELECT * FROM admins WHERE is_active=1 LIMIT 1");
      if (!a) fail(401, "admin", "運営が未登録です");
      await run(
        "INSERT INTO sessions VALUES (?,?,?)",
        id,
        a.id,
        new Date(Date.now() + SESSION_SECONDS * 1000).toISOString(),
      );
      return new Response(null, {
        status: 303,
        headers: {
          Location: "/admin/reports",
          "Set-Cookie": `kage_session=${await signSession(id, env.SESSION_SECRET || "")}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`,
        },
      });
    }
    if (path[1] === "logout" && method === "POST") {
      if (session) await run("DELETE FROM sessions WHERE id=?", session);
      return new Response(null, {
        status: 303,
        headers: {
          Location: "/",
          "Set-Cookie":
            "kage_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
        },
      });
    }
  }
  if (path[0] === "me") {
    await requireDevice();
    return json({
      ...(await one(
        "SELECT public_id,last_nickname FROM devices WHERE device_id=?",
        device,
      )),
      remaining: Math.max(0, 10 - (await usage())),
      period: state,
      offline: !env.GEMINI_API_KEY,
    });
  }
  if (path[0] === "images" && method === "GET") {
    const key = path.slice(1).join("/");
    if (state.purged) fail(410, "expired", "公開期間は終了しました");
    if (
      key.startsWith("posts/") &&
      !(await one(
        "SELECT id FROM posts WHERE image_key=? AND status='published'",
        key,
      )) &&
      !admin
    )
      fail(404, "not_found", "画像が見つかりません");
    if (
      !key.startsWith("posts/") &&
      !(await one("SELECT key FROM map WHERE image_key=?", key))
    )
      fail(404, "not_found", "画像が見つかりません");
    const object = await env.IMAGES.get(key);
    if (!object) fail(404, "not_found", "画像が見つかりません");
    return new Response(object.body, {
      headers: {
        "Content-Type": object.httpMetadata?.contentType || "image/jpeg",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (path[0] === "judge" && method === "POST") {
    await requireDevice();
    await checkPosting();
    const minute = Math.floor(Date.now() / 60000);
    const rate = await db
      .prepare(
        "INSERT INTO rate_limits VALUES (?,?,1) ON CONFLICT(device_id) DO UPDATE SET window=excluded.window,count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END WHERE window!=excluded.window OR count<3 RETURNING count",
      )
      .bind(device, minute)
      .first();
    if (!rate) fail(429, "rate_limit", "判定は1分に3回までです");
    const f = await req.formData();
    const nickname = text(f.get("nickname"), 20),
      caption = text(f.get("caption") ?? "", 40, false);
    const file = f.get("image");
    if (!(file instanceof File)) fail(400, "image", "写真が必要です");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let image;
    try {
      image = decodeImage(bytes);
    } catch {
      fail(400, "image", "長辺1600px・5MB以下のJPEG/PNGが必要です");
    }
    const hash = await sha256(bytes.buffer as ArrayBuffer);
    if (f.get("image_hash") !== hash)
      fail(400, "hash", "写真のハッシュが一致しません");
    const result = await judge(env, image, bytes, file.type, caption, nickname);
    if (!result.ok) fail(422, "rejected", "写真や文を変更してお試しください");
    const token = crypto.randomUUID();
    await run(
      "INSERT INTO judge_tokens VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)",
      token,
      device,
      image.width,
      image.height,
      hash,
      result.kira_score,
      result.kira_reason,
      JSON.stringify(result.faces),
      nickname,
      caption,
      new Date(Date.now() + 600000).toISOString(),
    );
    return json({ token, ...result, width: image.width, height: image.height });
  }
  if (path[0] === "posts") {
    if (path.length === 1 && method === "GET") {
      const rows = await listPosts();
      return json({
        posts: rows.slice(0, 30).map(serialize),
        cursor: rows.length > 30 ? rows[29].id : null,
      });
    }
    if (path.length === 1 && method === "POST") {
      await requireDevice();
      await checkPosting();
      const f = await req.formData();
      const token = await one(
        "SELECT * FROM judge_tokens WHERE token=?",
        String(f.get("token")),
      );
      const file = f.get("image");
      if (!(file instanceof File)) fail(400, "image", "写真が必要です");
      let image;
      const bytes = new Uint8Array(await file.arrayBuffer());
      try {
        image = decodeImage(bytes);
      } catch {
        fail(400, "image", "写真の形式が不正です");
      }
      if (
        !token ||
        !validToken(token as any, device!, image.width, image.height)
      )
        fail(
          409,
          "invalid_token",
          "判定が期限切れ・使用済み、または寸法が違います",
        );
      if (f.get("image_hash") !== token.image_hash)
        fail(409, "hash", "判定元の写真が違います");
      const topic = String(f.get("topic"));
      if (!(topic in topics)) fail(400, "topic", "種類を選んでください");
      const place = String(f.get("place_id") || "") || null;
      if (
        place &&
        !(await one("SELECT id FROM places WHERE id=? AND is_active=1", place))
      )
        fail(400, "place", "場所が無効です");
      const id = crypto.randomUUID(),
        key = `posts/${id}.jpg`;
      await env.IMAGES.put(key, bytes, {
        httpMetadata: { contentType: file.type },
      });
      try {
        const inserted = await db
          .prepare(
            "INSERT INTO posts(id,device_id,nickname,caption,place_id,topic,image_key,width,height,kira_score,kira_reason,created_at,judge_token) SELECT ?,device_id,nickname,caption,?,?,?,width,height,kira_score,kira_reason,?,token FROM judge_tokens WHERE token=? AND device_id=? AND used_at IS NULL AND expires_at>? AND COALESCE((SELECT post_count FROM daily_usage WHERE device_id=? AND date=?),0)<10 RETURNING id",
          )
          .bind(
            id,
            place,
            topic,
            key,
            now,
            token.token,
            device,
            now,
            device,
            jstDate(),
          )
          .first();
        if (!inserted) {
          await env.IMAGES.delete(key);
          await checkPosting();
          fail(409, "invalid_token", "使用済みの判定です");
        }
        await run(
          "UPDATE devices SET last_nickname=? WHERE device_id=?",
          token.nickname,
          device,
        );
        await addTags(token.caption, id, null);
        return json({ id }, 201);
      } catch (e) {
        if (!(await one("SELECT id FROM posts WHERE id=?", id)))
          await env.IMAGES.delete(key);
        throw e;
      }
    }
    const id = path[1];
    if (path.length === 2 && method === "GET") {
      const p = await visiblePost(id);
      const replies = await all(
        "SELECT replies.*,devices.public_id FROM replies JOIN devices USING(device_id) WHERE post_id=? AND status='published' ORDER BY created_at",
        id,
      );
      return json({
        post: serialize(p),
        replies: replies.map(({ device_id, ...r }) => ({
          ...r,
          is_owner: device_id === device,
        })),
      });
    }
    if (path.length === 2 && method === "DELETE") {
      await requireDevice();
      const p = await one(
        "SELECT * FROM posts WHERE id=? AND device_id=? AND status!='deleted'",
        id,
        device,
      );
      if (!p) fail(403, "forbidden", "自分の投稿だけ削除できます");
      await run("UPDATE posts SET status='deleted' WHERE id=?", id);
      await env.IMAGES.delete(p.image_key);
      return json({ ok: true });
    }
    if (path[2] === "heart" && ["POST", "DELETE"].includes(method)) {
      await requireDevice();
      const p = await visiblePost(id);
      if (p.device_id === device)
        fail(400, "own_post", "自分の投稿には付けられません");
      if (method === "POST")
        await run(
          "INSERT OR IGNORE INTO hearts VALUES (?,?,?)",
          id,
          device,
          now,
        );
      else
        await run(
          "DELETE FROM hearts WHERE post_id=? AND device_id=?",
          id,
          device,
        );
      return json({
        heart_count: (await one(
          "SELECT heart_count FROM posts WHERE id=?",
          id,
        ))!.heart_count,
      });
    }
    if (path[2] === "replies" && method === "POST") {
      await requireDevice();
      await visiblePost(id);
      if (!state.open) fail(403, "out_of_period", "返信期間外です");
      const body = (await req.json()) as Row;
      const nickname = text(body.nickname, 20),
        value = text(body.body, 40);
      if (!(await checkReply(env, nickname + " " + value)))
        fail(422, "rejected", "文を変更してお試しください");
      const reply = crypto.randomUUID();
      await run(
        "INSERT INTO replies(id,post_id,device_id,nickname,body,created_at) VALUES (?,?,?,?,?,?)",
        reply,
        id,
        device,
        nickname,
        value,
        now,
      );
      await addTags(value, null, reply);
      await run(
        "UPDATE devices SET last_nickname=? WHERE device_id=?",
        nickname,
        device,
      );
      return json({ id: reply }, 201);
    }
  }
  if (path[0] === "replies" && method === "DELETE") {
    await requireDevice();
    const result = await run(
      "UPDATE replies SET status='deleted' WHERE id=? AND device_id=? AND status!='deleted'",
      path[1],
      device,
    );
    if (!result.meta.changes)
      fail(403, "forbidden", "自分の返信だけ削除できます");
    return json({ ok: true });
  }
  if (path[0] === "reports" && method === "POST") {
    await requireDevice();
    const b = (await req.json()) as Row;
    const table =
      b.target_type === "post"
        ? "posts"
        : b.target_type === "reply"
          ? "replies"
          : null;
    if (
      !table ||
      !["inappropriate", "face", "spam", "other"].includes(b.reason)
    )
      fail(400, "invalid", "通報内容が不正です");
    if (
      !(await one(
        `SELECT id FROM ${table} WHERE id=? AND status='published'`,
        b.target_id,
      ))
    )
      fail(404, "not_found", "対象が見つかりません");
    await run(
      "INSERT OR IGNORE INTO reports VALUES (?,?,?,?,?,?)",
      crypto.randomUUID(),
      b.target_type,
      b.target_id,
      device,
      b.reason,
      now,
    );
    return json({ ok: true });
  }
  if (path[0] === "map" && method === "GET") {
    const m = await one("SELECT * FROM map WHERE key='current'");
    return json(m ? { ...m, url: "/api/images/" + m.image_key } : null);
  }
  if (path[0] === "places" && method === "GET") {
    const places = await all("SELECT * FROM places WHERE is_active=1");
    const out: Row[] = [];
    for (const p of places) {
      const latest = state.purged
        ? null
        : await one(
            "SELECT id,caption,topic,created_at FROM posts WHERE place_id=? AND status='published' AND topic IN ('crowd','status') ORDER BY created_at DESC LIMIT 1",
            p.id,
          );
      const age = latest
        ? freshness(
            latest.created_at,
            Date.now(),
            Number(env.STATUS_FRESH_MIN || 30),
            Number(env.STATUS_STALE_MIN || 120),
          )
        : "expired";
      out.push({
        ...p,
        post_count: state.purged
          ? 0
          : (await one(
              "SELECT count(*) AS n FROM posts WHERE place_id=? AND status='published'",
              p.id,
            ))!.n,
        situation: age === "expired" ? null : { ...latest, freshness: age },
      });
    }
    if (path[1]) {
      const place = out.find((p) => p.id === path[1]);
      if (!place) fail(404, "not_found", "場所が見つかりません");
      url.searchParams.set("place", path[1]);
      return json({ place, posts: (await listPosts()).map(serialize) });
    }
    return json({ places: out });
  }
  if (path[0] === "users" && method === "GET") {
    const user = await one(
      "SELECT public_id,last_nickname FROM devices WHERE public_id=?",
      path[1],
    );
    if (!user) fail(404, "not_found", "投稿者が見つかりません");
    url.searchParams.set("user", path[1]);
    return json({ user, posts: (await listPosts()).map(serialize) });
  }
  if (path[0] === "admin") {
    if (!admin) fail(401, "unauthorized", "運営ログインが必要です");
    if (path[1] === "reports" && method === "GET") {
      const reports = await all(
        "SELECT target_type,target_id,count(*) AS count FROM reports GROUP BY target_type,target_id ORDER BY count DESC",
      );
      const targets = [];
      for (const r of reports) {
        const target = await one(
          `SELECT * FROM ${r.target_type === "post" ? "posts" : "replies"} WHERE id=?`,
          r.target_id,
        );
        if (target) {
          const { device_id, heart_count, judge_token, ...safe } = target;
          targets.push({ ...r, target: safe });
        }
      }
      return json({ reports: targets });
    }
    if (
      ["posts", "replies"].includes(path[1]) &&
      ["hide", "restore"].includes(path[3]) &&
      method === "POST"
    ) {
      await run(
        `UPDATE ${path[1]} SET status=? WHERE id=? AND status!='deleted'`,
        path[3] === "hide" ? "hidden" : "published",
        path[2],
      );
      return json({ ok: true });
    }
    if (path[1] === "settings") {
      if (method === "GET") return json({ ...config, ...state, admin });
      if (method === "PATCH") {
        const b = (await req.json()) as Row;
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(b.festival_start) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(b.festival_end) ||
          !Number.isFinite(Date.parse(b.festival_start)) ||
          !Number.isFinite(Date.parse(b.festival_end)) ||
          b.festival_start > b.festival_end
        )
          fail(400, "date", "開催期間が不正です");
        await db.batch(
          ["festival_start", "festival_end"].map((key) =>
            db
              .prepare("INSERT OR REPLACE INTO settings VALUES (?,?)")
              .bind(key, b[key]),
          ),
        );
        return json({ ok: true });
      }
    }
    if (path[1] === "places") {
      if (method === "GET")
        return json({ places: await all("SELECT * FROM places") });
      if (["POST", "PATCH"].includes(method)) {
        const b = (await req.json()) as Row;
        if (
          !["stall", "event", "area", "facility"].includes(b.kind) ||
          ![b.x, b.y].every(
            (n) =>
              typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1,
          )
        )
          fail(400, "place", "場所の種類・座標を確認してください");
        const id = method === "PATCH" ? text(b.id, 100) : crypto.randomUUID();
        await run(
          "INSERT INTO places VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,x=excluded.x,y=excluded.y,description=excluded.description,is_active=excluded.is_active",
          id,
          text(b.name, 60),
          b.kind,
          b.x,
          b.y,
          text(b.description || "", 200, false),
          b.is_active === false ? 0 : 1,
        );
        return json({ id });
      }
    }
    if (path[1] === "map" && ["POST", "PATCH"].includes(method)) {
      const f = await req.formData();
      const file = f.get("image");
      if (!(file instanceof File)) fail(400, "image", "画像が必要です");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let image;
      try {
        image = decodeImage(bytes);
      } catch {
        fail(400, "image", "長辺1600px以下のJPEG/PNGを選んでください");
      }
      const old = await one("SELECT image_key FROM map WHERE key='current'");
      const key = `map/${crypto.randomUUID()}.png`;
      await env.IMAGES.put(key, bytes, {
        httpMetadata: { contentType: file.type },
      });
      await run(
        "INSERT OR REPLACE INTO map VALUES ('current',?,?,?)",
        key,
        image.width,
        image.height,
      );
      if (old) await env.IMAGES.delete(old.image_key);
      return json({ ok: true });
    }
  }
  return json({ error: { code: "not_found", message: "見つかりません" } }, 404);
}
