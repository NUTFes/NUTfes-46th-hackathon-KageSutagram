import { it, expect, vi } from "vitest";
import { cleanup } from "../src/lib/cleanup";
function environment(end: string, fail = false) {
  const events: string[] = [];
  const env = {
    DB: {
      prepare: (sql: string) => ({
        bind: () => ({ sql }),
        all: async () => ({
          results: [
            { key: "festival_start", value: "2026-01-01" },
            { key: "festival_end", value: end },
          ],
        }),
        sql,
      }),
      batch: vi.fn(async (statements: any[]) => {
        events.push(...statements.map((s) => s.sql));
      }),
    },
    IMAGES: {
      list: vi.fn(async () => ({
        objects: [{ key: "posts/a.jpg" }],
        truncated: false,
      })),
      delete: vi.fn(async () => {
        events.push("R2削除");
        if (fail) throw new Error("R2失敗");
      }),
    },
  };
  return { env: env as unknown as CloudflareEnv, events };
}
it("削除日前は期限切れトークンと7日より古い使用記録だけを整理", async () => {
  const { env, events } = environment("2026-11-16");
  expect((await cleanup(env, new Date("2026-11-17"))).purged).toBe(false);
  expect(events).toHaveLength(4);
  expect(events.some((e) => e === "DELETE FROM posts")).toBe(false);
});
it("終了30日後にR2→投稿・返信・反応・個人データの順で削除", async () => {
  const { env, events } = environment("2026-01-02");
  expect((await cleanup(env, new Date("2026-11-17"))).purged).toBe(true);
  expect(events[0]).toBe("R2削除");
  for (const name of [
    "posts",
    "replies",
    "hearts",
    "reports",
    "hashtags",
    "judge_tokens",
    "devices",
  ])
    expect(events).toContain("DELETE FROM " + name);
});
it("R2で失敗したらDBの本文を残し次回へ再試行", async () => {
  const { env, events } = environment("2026-01-02", true);
  await expect(cleanup(env, new Date("2026-11-17"))).rejects.toThrow("R2失敗");
  expect(events).toEqual(["R2削除"]);
});
