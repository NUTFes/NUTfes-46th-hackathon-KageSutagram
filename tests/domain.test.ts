import { describe, it, expect } from "vitest";
import {
  filterParameters,
  popularity,
  freshness,
  hashtags,
  publicPost,
  reportStatus,
  validToken,
  period,
  postingAllowed,
  parseJudge,
  publicId,
  sha256,
} from "../src/lib/domain";
describe("陰フィルター", () => {
  it("最低強度15%と設計のパラメータを使う", () => {
    expect(filterParameters(0).s).toBe(0.15);
    expect(filterParameters(100)).toEqual({
      s: 1,
      saturation: expect.closeTo(0.2),
      brightness: 0.65,
      contrast: 0.8,
      tint: 0.15,
      noise: 12,
      vignette: 0.6,
    });
    expect(filterParameters(50).saturation).toBe(0.6);
  });
});
describe("人気と鮮度", () => {
  const now = Date.parse("2026-11-16T12:00:00Z");
  it("ハート数と経過時間の式", () => {
    expect(popularity(10, new Date(now).toISOString(), now)).toBeCloseTo(
      10 / 2 ** 1.5,
    );
    expect(
      popularity(10, new Date(now - 3600000).toISOString(), now),
    ).toBeCloseTo(10 / 3 ** 1.5);
  });
  it.each([
    [0, "fresh"],
    [30, "fresh"],
    [31, "stale"],
    [120, "stale"],
    [121, "expired"],
  ])("%i分後は%s", (min, result) => {
    expect(
      freshness(new Date(now - Number(min) * 60000).toISOString(), now),
    ).toBe(result);
  });
  it("鮮度の設定値を使える", () => {
    expect(freshness(new Date(now - 600000).toISOString(), now, 5, 15)).toBe(
      "stale",
    );
  });
});
it("タグの全半角・大文字・重複・日本語を正規化", () => {
  expect(hashtags("＃ＴＥＳＴ #test #技大祭 #A_B #技大祭")).toEqual([
    "test",
    "技大祭",
    "a_b",
  ]);
});
it("本人の数と秘密IDは返さない", () => {
  const row = { id: "p", device_id: "owner", heart_count: 23 };
  expect(publicPost(row, "owner")).toEqual({
    id: "p",
    heart_count: null,
    is_owner: true,
  });
  expect(publicPost(row, "other").heart_count).toBe(23);
  expect(publicPost(row, null)).not.toHaveProperty("device_id");
});
it.each([
  [0, "published"],
  [2, "published"],
  [3, "held"],
  [4, "held"],
])("通報%i件で%s", (n, status) => expect(reportStatus(Number(n))).toBe(status));
describe("判定トークン", () => {
  const now = Date.now();
  const token = {
    device_id: "a",
    width: 100,
    height: 80,
    expires_at: new Date(now + 600000).toISOString(),
    used_at: null,
  };
  it("本人・寸法・有効期限・未使用を確認", () =>
    expect(validToken(token, "a", 100, 80, now)).toBe(true));
  it.each([
    { used_at: "used" },
    { expires_at: new Date(now).toISOString() },
    { width: 101 },
    { height: 81 },
    { device_id: "b" },
  ])("変更されたトークンを拒否 %o", (change) => {
    expect(validToken({ ...token, ...change }, "a", 100, 80, now)).toBe(false);
  });
});
describe("期間と上限", () => {
  it.each([
    ["2026-11-14T15:00:00Z", false],
    ["2026-11-15T15:00:00Z", true],
    ["2026-11-24T14:59:59Z", true],
    ["2026-11-24T15:00:00Z", false],
  ])("JSTの境界 %s", (now, open) => {
    expect(period("2026-11-16", "2026-11-17", new Date(now)).open).toBe(open);
  });
  it("終了から30日で全削除", () => {
    expect(
      period("2026-11-16", "2026-11-17", new Date("2026-12-16T15:00:00Z"))
        .purged,
    ).toBe(true);
  });
  it("日次上限は10枚", () => {
    expect(postingAllowed(true, 9)).toBeNull();
    expect(postingAllowed(true, 10)).toBe("daily_limit");
    expect(postingAllowed(false, 0)).toBe("out_of_period");
  });
});
describe("Gemini JSON", () => {
  const valid = {
    ok: true,
    kira_score: 50,
    kira_reason: "眩しすぎる",
    faces: [{ x: 0.2, y: 0.2, w: 0.2, h: 0.3 }],
  };
  it("構造を検証", () => expect(parseJudge(valid)).toEqual(valid));
  it.each([
    null,
    {},
    { ...valid, ok: 1 },
    { ...valid, kira_score: 101 },
    { ...valid, kira_score: 1.5 },
    { ...valid, kira_reason: "あ".repeat(21) },
    { ...valid, faces: [{ x: 0.9, y: 0, w: 0.2, h: 0.2 }] },
    { ...valid, faces: [{ x: 0, y: 0, w: NaN, h: 0.2 }] },
    { ...valid, faces: [] },
  ])("不正な型や範囲を拒否（空顔枠は許可） %o", (value) => {
    if (
      value &&
      "faces" in value &&
      Array.isArray(value.faces) &&
      value.faces.length === 0
    )
      expect(parseJudge(value)).toEqual(value);
    else expect(() => parseJudge(value)).toThrow();
  });
});
it("公開IDはHMACで秘密と分離される", async () => {
  const device = await sha256("sample");
  const id = await publicId(device, "a".repeat(32));
  expect(id).toMatch(/^[a-f0-9]{10}$/);
  expect(await publicId(device, "a".repeat(32))).toBe(id);
  expect(await publicId(device, "b".repeat(32))).not.toBe(id);
});
