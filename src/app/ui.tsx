"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { topics, hashtags } from "@/lib/domain";
import { resize, imageHash, kageFilter } from "@/lib/canvas";
type Row = Record<string, any>;
function KiraScore({ score }: { score: number }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const ratio = Math.min(1, (now - start) / 900);
      setCount(Math.round(score * ratio));
      if (ratio < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [score]);
  return <h2>キラキラ度 {count} / 100</h2>;
}

// 写真は端末のメモリだけに保持し、画面遷移後も判定結果を引き継ぐ。
let postDraft: { original: Blob; filtered: Blob; judge: Row } | null = null;
export default function App() {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const [me, setMe] = useState<Row | null>(null),
    [data, setData] = useState<Row>({}),
    [places, setPlaces] = useState<Row[]>([]),
    [map, setMap] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [mapPlace, setMapPlace] = useState<Row | null>(null),
    [postPlace, setPostPlace] = useState(""),
    [placeSearch, setPlaceSearch] = useState(""),
    [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  const request = useCallback(
    async (path: string, method = "GET", body?: unknown) => {
      let secret = localStorage.getItem("device_secret");
      if (!secret) {
        secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
          n.toString(16).padStart(2, "0"),
        ).join("");
        localStorage.setItem("device_secret", secret);
      }
      const headers: Record<string, string> = { "X-Device-Secret": secret };
      if (body && !(body instanceof FormData))
        headers["Content-Type"] = "application/json";
      const r = await fetch("/api/" + path, {
        method,
        headers,
        body:
          body instanceof FormData
            ? body
            : body
              ? JSON.stringify(body)
              : undefined,
      });
      const result = (await r.json()) as Row;
      if (!r.ok) throw new Error(result.error?.message || "処理に失敗しました");
      return result;
    },
    [],
  );
  useEffect(() => {
    let active = true;
    setData({});
    setError("");
    (async () => {
      const [m, p, mp] = await Promise.all([
        request("me"),
        request("places"),
        request("map"),
      ]);
      if (!active) return;
      setMe(m);
      setPlaces(p.places);
      setMap(mp);
      let value: Row = {};
      if (pathname === "/") value = await request("posts?" + params.toString());
      else if (pathname.startsWith("/p/"))
        value = await request("posts/" + pathname.split("/")[2]);
      else if (pathname.startsWith("/places/"))
        value = await request("places/" + pathname.split("/")[2]);
      else if (pathname.startsWith("/tags/"))
        value = await request(
          "posts?tag=" +
            encodeURIComponent(decodeURIComponent(pathname.split("/")[2])),
        );
      else if (pathname.startsWith("/u/"))
        value = await request("users/" + pathname.split("/")[2]);
      else if (pathname === "/me")
        value = await request("users/" + m.public_id);
      else if (pathname.startsWith("/admin/") && pathname !== "/admin/login")
        value = await request(pathname.slice(1));
      if (active) setData(value);
    })().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [pathname, params, request, version]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function tagText(value: string) {
    return value.split(/([#＃][\p{L}\p{N}_]+)/gu).map((part, i) =>
      /^[#＃]/.test(part) ? (
        <Link
          key={i}
          href={
            "/tags/" + encodeURIComponent(hashtags(part)[0] || part.slice(1))
          }
        >
          {part}
        </Link>
      ) : (
        part
      ),
    );
  }
  function Card({ post: p }: { post: Row }) {
    return (
      <article className="card">
        <Link href={"/p/" + p.id}>
          <img
            className="photo"
            src={"/api/images/" + p.image_key}
            alt={p.caption || "陰にした技大祭の写真"}
          />
        </Link>
        <div className="card-body">
          <Link href={"/u/" + p.public_id}>{p.nickname}</Link>
          <span className="badge">
            {topics[p.topic as keyof typeof topics]}
          </span>
          <p>{tagText(p.caption)}</p>
          {p.place_id && (
            <Link href={"/places/" + p.place_id}>
              {places.find((x) => x.id === p.place_id)?.name || "場所を見る"}
            </Link>
          )}
          <p className="muted">
            キラキラ度 {p.kira_score} / 100 · {p.kira_reason}
          </p>
          <meter min="0" max="100" value={p.kira_score} />
          <div className="actions">
            {p.is_owner ? (
              <span>♡ 数は見えません</span>
            ) : (
              <>
                <button
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await request("posts/" + p.id + "/heart", "POST");
                      refresh();
                    })
                  }
                >
                  ♡ {p.heart_count}
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await request("posts/" + p.id + "/heart", "DELETE");
                      refresh();
                    })
                  }
                >
                  ハートを外す
                </button>
              </>
            )}
            <Link href={"/p/" + p.id}>返信 {p.reply_count}</Link>
          </div>
          <small>{new Date(p.created_at).toLocaleString("ja-JP")}</small>
        </div>
      </article>
    );
  }
  function Report({ type, id }: { type: string; id: string }) {
    return (
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          action(async () => {
            await request("reports", "POST", {
              target_type: type,
              target_id: id,
              reason: f.get("reason"),
            });
            refresh();
          });
        }}
      >
        <select name="reason" aria-label="通報理由">
          <option value="inappropriate">不適切</option>
          <option value="face">顔のぼかし漏れ</option>
          <option value="spam">迷惑投稿</option>
          <option value="other">その他</option>
        </select>
        <button disabled={busy}>通報する</button>
      </form>
    );
  }
  function MapView({
    choose,
    onPlace,
  }: {
    choose?: (x: number, y: number) => void;
    onPlace?: (id: string) => void;
  }) {
    return map ? (
      <div className="map-scroll">
        <div
          className="map-stage"
          onClick={
            choose
              ? (e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  choose(
                    (e.clientX - r.left) / r.width,
                    (e.clientY - r.top) / r.height,
                  );
                }
              : undefined
          }
        >
          <img src={map.url} alt="技大祭 会場マップ" />
          {places.map((p, i) => (
            <Link
              className={
                "pin " +
                (p.situation?.topic || "") +
                " " +
                (p.situation?.freshness || "")
              }
              style={{ left: p.x * 100 + "%", top: p.y * 100 + "%" }}
              href={"/places/" + p.id}
              key={p.id}
              onClick={(e) => {
                if (choose) {
                  e.preventDefault();
                  e.stopPropagation();
                  choose(p.x, p.y);
                } else {
                  e.preventDefault();
                  if (onPlace) onPlace(p.id);
                  else setMapPlace(p);
                }
              }}
              aria-label={p.name}
            >
              {i + 1}
              <small>{p.post_count}</small>
            </Link>
          ))}
        </div>
      </div>
    ) : (
      <p>マップを読み込み中…</p>
    );
  }
  const [selected, setSelected] = useState<Blob | null>(
      postDraft?.original || null,
    ),
    [judged, setJudged] = useState<Row | null>(postDraft?.judge || null),
    [filtered, setFiltered] = useState<Blob | null>(
      postDraft?.filtered || null,
    ),
    [preview, setPreview] = useState(""),
    [beforePreview, setBeforePreview] = useState(""),
    [stage, setStage] = useState(postDraft ? "陰化が完了しました" : ""),
    [xy, setXy] = useState({ x: 0.5, y: 0.5 });
  useEffect(() => {
    if (!selected) return;
    const u = URL.createObjectURL(selected);
    setBeforePreview(u);
    return () => URL.revokeObjectURL(u);
  }, [selected]);
  useEffect(() => {
    if (!filtered && !selected) return;
    const u = URL.createObjectURL(filtered || selected!);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [filtered, selected]);
  const isPost = pathname === "/post" || pathname === "/post/result";
  const isAdmin = pathname.startsWith("/admin/");
  return (
    <>
      <header>
        <Link href="/" className="brand">
          陰スタグラム <small>KageSutagram</small>
        </Link>
        <p>キラキラは、ぜんぶ陰にする。</p>
      </header>
      <main>
        <div role="alert" className={error ? "error" : ""}>
          {error}
        </div>
        {me?.period.purged && <h2>今年の陰スタグラムは終了しました</h2>}
        {!me?.period.open && !me?.period.purged && me && (
          <p className="notice">
            投稿期間外です。投稿締切：{me.period.post_deadline}
          </p>
        )}
        {pathname === "/" && (
          <>
            <h1>会場の、飾らない一コマ</h1>
            <form
              className="filters"
              onChange={(e) =>
                router.push(
                  "/?" +
                    new URLSearchParams(
                      Object.fromEntries(new FormData(e.currentTarget) as any),
                    ).toString(),
                )
              }
            >
              <label>
                並び順
                <select name="sort" defaultValue={params.get("sort") || "new"}>
                  <option value="new">新しい順</option>
                  <option value="popular">人気順</option>
                  <option value="kage">陰度順</option>
                </select>
              </label>
              <label>
                情報の種類
                <select
                  aria-label="情報の種類"
                  name="topic"
                  defaultValue={params.get("topic") || ""}
                >
                  <option value="">すべて</option>
                  {Object.entries(topics).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </form>
          </>
        )}
        {isPost && (
          <>
            <h1>{judged ? "判定結果" : "写真を投稿する"}</h1>
            <p>今日の残り {me?.remaining ?? "…"} / 10 枚</p>
            <p className="notice">
              写真は判定と加工のため
              AI（Gemini）に送られます。顔はすべてぼかされます。元の写真は保存されません。
              {me?.offline &&
                "現在はオフラインのダミー判定です。顔枠もダミーです。"}
            </p>
            <p className="muted">
              合言葉はこのブラウザに保存します。ブラウザを変えると自分の投稿を削除できません。
            </p>
            {!judged ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  action(async () => {
                    if (!selected) throw new Error("写真を選んでください");
                    setStage("キラキラ度を測っています…");
                    f.set("image", selected, "resized.jpg");
                    f.set("image_hash", await imageHash(selected));
                    const result = await request("judge", "POST", f);
                    setStage("陰にしています…");
                    setJudged({
                      ...result,
                      hash: await imageHash(selected),
                      place: f.get("place_id"),
                      topic: f.get("topic"),
                    });
                    localStorage.setItem("nickname", String(f.get("nickname")));
                    const after = await kageFilter(
                      selected,
                      result.kira_score,
                      result.faces,
                    );
                    setFiltered(after);
                    postDraft = {
                      original: selected,
                      filtered: after,
                      judge: {
                        ...result,
                        hash: await imageHash(selected),
                        place: f.get("place_id"),
                        topic: f.get("topic"),
                      },
                    };
                    setStage("陰化が完了しました");
                    router.push("/post/result");
                  });
                }}
              >
                <label>
                  ニックネーム
                  <input
                    name="nickname"
                    maxLength={20}
                    required
                    defaultValue={
                      me?.last_nickname === "名無しの陰"
                        ? ""
                        : me?.last_nickname
                    }
                  />
                </label>
                <label>
                  写真を選ぶ
                  <input
                    type="file"
                    accept="image/*"
                    required
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f)
                        action(async () => {
                          setSelected(await resize(f));
                          setFiltered(null);
                        });
                    }}
                  />
                </label>
                <label>
                  一言（40字まで）
                  <textarea
                    name="caption"
                    maxLength={40}
                    onChange={(e) =>
                      setStage(Array.from(e.target.value).length + " / 40 字")
                    }
                  />
                </label>
                <label>
                  場所（任意）
                  <select
                    name="place_id"
                    value={postPlace}
                    onChange={(e) => setPostPlace(e.target.value)}
                  >
                    <option value="">場所なし</option>
                    {places
                      .filter(
                        (p) =>
                          p.id === postPlace || p.name.includes(placeSearch),
                      )
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  場所名を検索
                  <input
                    value={placeSearch}
                    onChange={(e) => setPlaceSearch(e.target.value)}
                  />
                </label>
                <details>
                  <summary>マップから場所を選ぶ</summary>
                  <MapView onPlace={setPostPlace} />
                </details>
                <label>
                  情報の種類
                  <select aria-label="情報の種類" name="topic">
                    {Object.entries(topics).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  disabled={
                    busy || !selected || !me?.period.open || me?.remaining === 0
                  }
                >
                  判定する
                </button>
              </form>
            ) : (
              <section>
                <KiraScore score={judged.kira_score} />
                <p>{judged.kira_reason}</p>
                <button
                  disabled={busy || !filtered}
                  onClick={() =>
                    action(async () => {
                      const f = new FormData();
                      f.set("image", filtered!, "kage.jpg");
                      f.set("image_hash", judged.hash);
                      f.set("token", judged.token);
                      f.set("place_id", judged.place || "");
                      f.set("topic", judged.topic);
                      const p = await request("posts", "POST", f);
                      postDraft = null;
                      setSelected(null);
                      setFiltered(null);
                      setJudged(null);
                      router.push("/p/" + p.id);
                    })
                  }
                >
                  投稿する
                </button>
                <button
                  onClick={() => {
                    postDraft = null;
                    setJudged(null);
                    setFiltered(null);
                    setStage("");
                    router.push("/post");
                  }}
                >
                  やめる
                </button>
              </section>
            )}
            <p aria-live="polite">{stage}</p>
            {preview && (
              <div className="result-image">
                <img className="photo" src={preview} alt="端末内のプレビュー" />
                {filtered && beforePreview && (
                  <motion.img
                    key={preview}
                    className="photo before-image"
                    src={beforePreview}
                    alt="陰化前の写真（端末内のみ）"
                    initial={{ opacity: 1 }}
                    animate={{ opacity: 0 }}
                    transition={{ duration: 1.5 }}
                  />
                )}
              </div>
            )}
          </>
        )}
        {pathname === "/map" && (
          <>
            <h1>会場マップ</h1>
            <p>
              地図はピンチで拡大できます。混雑は赤、状況は灰色。30分を過ぎた情報は薄く、2時間を過ぎると地図から外します。
            </p>
            <MapView />
            {mapPlace && (
              <aside className="notice" aria-label="場所の要約">
                <h2>{mapPlace.name}</h2>
                <p>{mapPlace.description}</p>
                <p>{mapPlace.post_count}件の投稿</p>
                {mapPlace.situation && (
                  <p className={mapPlace.situation.freshness}>
                    {mapPlace.situation.caption} ·{" "}
                    {Math.floor(
                      (Date.now() - Date.parse(mapPlace.situation.created_at)) /
                        60000,
                    )}
                    分前
                  </p>
                )}
                <Link href={"/places/" + mapPlace.id}>
                  この場所の投稿を見る
                </Link>
                <button onClick={() => setMapPlace(null)}>閉じる</button>
              </aside>
            )}
            {places.map((p) => (
              <p key={p.id}>
                <Link href={"/places/" + p.id}>
                  {p.name} · {p.post_count}件
                </Link>
                {p.situation && (
                  <span className={p.situation.freshness}>
                    {p.situation.caption}（
                    {Math.floor(
                      (Date.now() - Date.parse(p.situation.created_at)) / 60000,
                    )}
                    分前）
                  </span>
                )}
              </p>
            ))}
          </>
        )}
        {pathname.startsWith("/places/") && data.place && (
          <>
            <h1>{data.place.name}</h1>
            <p>{data.place.description}</p>
            {data.place.situation && (
              <p className={data.place.situation.freshness}>
                {data.place.situation.caption} ·{" "}
                {Math.floor(
                  (Date.now() - Date.parse(data.place.situation.created_at)) /
                    60000,
                )}
                分前
              </p>
            )}
          </>
        )}
        {pathname.startsWith("/tags/") && (
          <h1>#{decodeURIComponent(pathname.split("/")[2])}</h1>
        )}
        {(pathname.startsWith("/u/") || pathname === "/me") && (
          <>
            <h1>
              {pathname === "/me" ? "自分の投稿" : data.user?.last_nickname}
            </h1>
            <p>公開ID：{data.user?.public_id}</p>
          </>
        )}
        {data.posts && (
          <>
            <div className="feed">
              {data.posts.map((p: Row) => (
                <Card key={p.id} post={p} />
              ))}
            </div>
            {data.posts.length === 0 && <p>まだ投稿がありません。</p>}
            {data.cursor && (
              <button
                onClick={() =>
                  action(async () => {
                    const q = new URLSearchParams(params);
                    q.set("cursor", data.cursor);
                    const next = await request("posts?" + q);
                    setData({ ...next, posts: [...data.posts, ...next.posts] });
                  })
                }
              >
                もっと見る
              </button>
            )}
          </>
        )}
        {data.post && (
          <>
            <Card post={data.post} />
            {data.post.is_owner ? (
              <button
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await request("posts/" + data.post.id, "DELETE");
                    router.push("/me");
                  })
                }
              >
                自分の投稿を削除
              </button>
            ) : (
              <Report type="post" id={data.post.id} />
            )}
            <h2>返信</h2>
            {data.replies.map((r: Row) => (
              <article className="reply" key={r.id}>
                <Link href={"/u/" + r.public_id}>{r.nickname}</Link>
                <p>{tagText(r.body)}</p>
                {r.is_owner ? (
                  <button
                    onClick={() =>
                      action(async () => {
                        await request("replies/" + r.id, "DELETE");
                        refresh();
                      })
                    }
                  >
                    自分の返信を削除
                  </button>
                ) : (
                  <Report type="reply" id={r.id} />
                )}
              </article>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                action(async () => {
                  await request(
                    "posts/" + data.post.id + "/replies",
                    "POST",
                    Object.fromEntries(f),
                  );
                  refresh();
                });
              }}
            >
              <label>
                ニックネーム
                <input
                  name="nickname"
                  maxLength={20}
                  required
                  defaultValue={me?.last_nickname}
                />
              </label>
              <label>
                返信（40字まで・AIチェックあり）
                <textarea name="body" maxLength={40} required />
              </label>
              <button disabled={busy || !me?.period.open}>返信する</button>
            </form>
          </>
        )}
        {isAdmin && (
          <>
            <h1>運営</h1>
            <nav>
              <Link href="/admin/reports">通報</Link>
              <Link href="/admin/places">場所・マップ</Link>
              <Link href="/admin/settings">開催期間</Link>
              <Link href="/admin/login">ログイン</Link>
            </nav>
            {pathname === "/admin/login" && (
              <>
                <form action="/api/auth/dev-login" method="post">
                  <button>開発ログイン</button>
                </form>
                <a href="/api/auth/slack/login">Slackでログイン（準備中）</a>
              </>
            )}
            {pathname === "/admin/reports" &&
              data.reports?.map((r: Row) => (
                <article className="card card-body" key={r.target_id}>
                  <p>
                    {r.target_type === "post" ? "投稿" : "返信"} · 通報{" "}
                    {r.count}件 · {r.target.status}
                  </p>
                  <p>{r.target.caption || r.target.body}</p>
                  {r.target.image_key && (
                    <img
                      className="photo"
                      src={"/api/images/" + r.target.image_key}
                      alt="通報対象の写真"
                    />
                  )}
                  {["hide", "restore"].map((a) => (
                    <button
                      key={a}
                      disabled={busy}
                      onClick={() =>
                        action(async () => {
                          await request(
                            `admin/${r.target_type === "post" ? "posts" : "replies"}/${r.target_id}/${a}`,
                            "POST",
                            {},
                          );
                          refresh();
                        })
                      }
                    >
                      {a === "hide" ? "非公開にする" : "公開に戻す"}
                    </button>
                  ))}
                </article>
              ))}
            {pathname === "/admin/settings" && data.festival_start && (
              <>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    action(async () => {
                      await request(
                        "admin/settings",
                        "PATCH",
                        Object.fromEntries(f),
                      );
                      refresh();
                    });
                  }}
                >
                  <label>
                    開始日
                    <input
                      type="date"
                      name="festival_start"
                      defaultValue={data.festival_start}
                      required
                    />
                  </label>
                  <label>
                    終了日
                    <input
                      type="date"
                      name="festival_end"
                      defaultValue={data.festival_end}
                      required
                    />
                  </label>
                  <p>
                    投稿締切：{data.post_deadline} / 全削除：{data.purge_at}
                  </p>
                  <button disabled={busy}>開催期間を保存</button>
                </form>
                <p>運営：{data.admin?.display_name}</p>
              </>
            )}
            {pathname === "/admin/places" && (
              <>
                <h2>会場マップ</h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    action(async () => {
                      const image = f.get("image") as File;
                      f.set("image", await resize(image), "map.jpg");
                      await request("admin/map", "POST", f);
                      refresh();
                    });
                  }}
                >
                  <label>
                    マップ画像
                    <input type="file" name="image" accept="image/*" required />
                  </label>
                  <button disabled={busy}>マップをアップロード</button>
                </form>
                <h2>場所を登録・編集</h2>
                <p>地図をクリックしてピン位置を選んでください。</p>
                <MapView choose={(x, y) => setXy({ x, y })} />
                <form
                  key={data.edit?.id || "new"}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    action(async () => {
                      await request(
                        "admin/places",
                        data.edit ? "PATCH" : "POST",
                        {
                          ...Object.fromEntries(f),
                          ...xy,
                          is_active: f.get("is_active") === "on",
                        },
                      );
                      refresh();
                    });
                  }}
                >
                  <input type="hidden" name="id" value={data.edit?.id || ""} />
                  <label>
                    場所名
                    <input
                      name="name"
                      required
                      defaultValue={data.edit?.name}
                    />
                  </label>
                  <label>
                    種類
                    <select
                      name="kind"
                      defaultValue={data.edit?.kind || "stall"}
                    >
                      <option value="stall">模擬店</option>
                      <option value="event">企画</option>
                      <option value="area">エリア</option>
                      <option value="facility">設備</option>
                    </select>
                  </label>
                  <label>
                    説明
                    <textarea
                      name="description"
                      defaultValue={data.edit?.description}
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      name="is_active"
                      defaultChecked={data.edit ? !!data.edit.is_active : true}
                    />
                    公開する
                  </label>
                  <p>
                    座標：{xy.x.toFixed(3)}, {xy.y.toFixed(3)}
                  </p>
                  <button disabled={busy}>場所を保存</button>
                </form>
                <button onClick={() => setData({ ...data, edit: null })}>
                  新規登録
                </button>
                {data.places?.map((p: Row) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setData({ ...data, edit: p });
                      setXy({ x: p.x, y: p.y });
                    }}
                  >
                    {p.name}を編集
                  </button>
                ))}
              </>
            )}
            <form action="/api/auth/logout" method="post">
              <button>ログアウト</button>
            </form>
          </>
        )}
      </main>
      <footer>
        <Link href="/admin/login">運営ログイン</Link>
        <p>技大祭期間限定の、映えないSNS。</p>
      </footer>
      <nav className="bottom">
        <Link href="/">タイムライン</Link>
        <Link href="/map">マップ</Link>
        <Link href="/post" aria-disabled={!!me && !me.period.open}>
          ＋投稿
        </Link>
        <Link href="/me">自分</Link>
      </nav>
    </>
  );
}
