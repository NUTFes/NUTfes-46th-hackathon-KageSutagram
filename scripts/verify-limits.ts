import assert from "node:assert/strict";
import { getPlatformProxy } from "wrangler";
import jpeg from "jpeg-js";
import { sha256, jstDate } from "../src/lib/domain";
const base = process.env.KAGE_URL || "http://localhost:3300";
const { env, dispose } = await getPlatformProxy<CloudflareEnv>({
  persist: { path: ".wrangler/state/v3" },
});
const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "hex",
  ),
  device = await sha256(secret);
const headers = { "X-Device-Secret": secret, Origin: base };
const bytes = jpeg.encode(
  { width: 100, height: 80, data: Buffer.alloc(100 * 80 * 4, 180) },
  80,
).data;
const hash = await sha256(
  bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer,
);
const run = (sql: string, ...args: (string | number | null)[]) =>
  env.DB.prepare(sql)
    .bind(...args)
    .run();
const settings = await env.DB.prepare("SELECT * FROM settings").all<{
  key: string;
  value: string;
}>();
const postBody = (token: string, dimensions = false) => {
  const f = new FormData();
  f.set("token", token);
  f.set("image_hash", hash);
  f.set("topic", "daily");
  f.set(
    "image",
    new Blob(
      [
        new Uint8Array(
          dimensions
            ? jpeg.encode(
                { width: 90, height: 80, data: Buffer.alloc(90 * 80 * 4, 100) },
                80,
              ).data
            : bytes,
        ),
      ],
      { type: "image/jpeg" },
    ),
    "test.jpg",
  );
  return f;
};
const submit = (token: string, dimensions = false) =>
  fetch(base + "/api/posts", {
    method: "POST",
    headers,
    body: postBody(token, dimensions),
  });
async function token() {
  const id = crypto.randomUUID();
  await run(
    "INSERT INTO judge_tokens VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)",
    id,
    device,
    100,
    80,
    hash,
    50,
    "ほどよい陰です",
    "[]",
    "検証",
    "検証",
    new Date(Date.now() + 600000).toISOString(),
  );
  return id;
}
try {
  assert.equal((await fetch(base + "/api/me", { headers })).status, 200);
  const f = () => {
    const form = new FormData();
    form.set(
      "image",
      new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }),
      "test.jpg",
    );
    form.set("image_hash", hash);
    form.set("nickname", "検証");
    form.set("caption", "検証");
    return form;
  };
  for (let i = 0; i < 3; i++)
    assert.equal(
      (await fetch(base + "/api/judge", { method: "POST", headers, body: f() }))
        .status,
      200,
    );
  assert.equal(
    (await fetch(base + "/api/judge", { method: "POST", headers, body: f() }))
      .status,
    429,
  );
  const t = await token();
  assert.equal((await submit(t, true)).status, 409);
  await run(
    "UPDATE judge_tokens SET expires_at=? WHERE token=?",
    new Date(Date.now() - 1000).toISOString(),
    t,
  );
  assert.equal((await submit(t)).status, 409);
  await run(
    "UPDATE judge_tokens SET expires_at=? WHERE token=?",
    new Date(Date.now() + 600000).toISOString(),
    t,
  );
  const same = await Promise.all([submit(t), submit(t)]);
  assert.deepEqual(same.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await submit(t)).status, 409);
  await run(
    "UPDATE daily_usage SET post_count=9 WHERE device_id=? AND date=?",
    device,
    jstDate(),
  );
  const a = await token(),
    b = await token();
  const concurrent = await Promise.all([submit(a), submit(b)]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [201, 429]);
  const usage = await env.DB.prepare(
    "SELECT post_count FROM daily_usage WHERE device_id=? AND date=?",
  )
    .bind(device, jstDate())
    .first<{ post_count: number }>();
  assert.equal(usage?.post_count, 10);
  assert.equal(
    (await fetch(base + "/api/judge", { method: "POST", headers, body: f() }))
      .status,
    429,
  );
  await run(
    "UPDATE settings SET value='2099-01-01' WHERE key='festival_start'",
  );
  assert.equal((await submit(await token())).status, 403);
  console.log(
    "成功：判定レート制限、寸法違い、期限切れ、トークンの同時利用・再利用、日次残り1枚で同時投稿、期間外403",
  );
} finally {
  for (const row of settings.results)
    await run(
      "INSERT OR REPLACE INTO settings VALUES (?,?)",
      row.key,
      row.value,
    );
  const posts = await env.DB.prepare(
    "SELECT id,image_key FROM posts WHERE device_id=?",
  )
    .bind(device)
    .all<{ id: string; image_key: string }>();
  for (const p of posts.results) {
    await env.IMAGES.delete(p.image_key);
    await run("DELETE FROM hashtags WHERE post_id=?", p.id);
  }
  await run("DELETE FROM posts WHERE device_id=?", device);
  for (const table of ["judge_tokens", "daily_usage", "rate_limits", "devices"])
    await run(`DELETE FROM ${table} WHERE device_id=?`, device);
  await dispose();
}
