import { blocked, parseJudge } from "./domain";
// 秘密の値の前後に付いた BOM・空白・改行を取り除く（PowerShell の Get-Clipboard 経由で登録すると BOM が付くため）
export const geminiKey = (env: { GEMINI_API_KEY?: string }) =>
  (env.GEMINI_API_KEY ?? "").replace(/^﻿/, "").trim();
export async function judge(
  env: CloudflareEnv,
  image: { data: Uint8Array },
  bytes: Uint8Array,
  mime: string,
  caption: string,
  nickname: string,
) {
  if (!env.GEMINI_API_KEY) {
    let brightness = 0,
      saturation = 0;
    for (let i = 0; i < image.data.length; i += 4) {
      const rgb = [image.data[i], image.data[i + 1], image.data[i + 2]];
      brightness += (rgb[0] + rgb[1] + rgb[2]) / 765;
      saturation += (Math.max(...rgb) - Math.min(...rgb)) / 255;
    }
    const n = image.data.length / 4;
    const score = Math.round(
      100 * ((brightness / n) * 0.55 + (saturation / n) * 0.45),
    );
    return parseJudge({
      ok: !blocked(caption + nickname),
      kira_score: score,
      kira_reason: [
        "眩しさは控えめにどうぞ",
        "その彩り、陰には贅沢",
        "青春の光量が多すぎる",
      ][score % 3],
      faces: [{ x: 0.35, y: 0.2, w: 0.2, h: 0.25 }],
    });
  }
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL || "gemini-2.5-flash"}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiKey(env),
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `技大祭SNSの写真・文の安全確認。公序良俗に反する、個人情報（名札・連絡先）、他人への攻撃はok=false。キラキラ度0〜100（自撮り・ピース・加工感・スイーツ・夜景・集合写真）。理由は20字以内、陰キャ目線の悪意のない皮肉、容姿への言及は禁止。全員の顔を0〜1の座標x,y,w,hで返す。nickname=${nickname} caption=${caption}`,
              },
              {
                inlineData: {
                  mimeType: mime,
                  data: Buffer.from(bytes).toString("base64"),
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            required: ["ok", "kira_score", "kira_reason", "faces"],
            properties: {
              ok: { type: "BOOLEAN" },
              reject_reason: { type: "STRING" },
              kira_score: { type: "INTEGER" },
              kira_reason: { type: "STRING" },
              faces: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  required: ["x", "y", "w", "h"],
                  properties: {
                    x: { type: "NUMBER" },
                    y: { type: "NUMBER" },
                    w: { type: "NUMBER" },
                    h: { type: "NUMBER" },
                  },
                },
              },
            },
          },
        },
      }),
    },
  );
  if (!response.ok) throw new Error("AI判定に失敗しました");
  const data = (await response.json()) as {
    candidates?: { content: { parts: { text?: string }[] } }[];
  };
  return parseJudge(
    JSON.parse(
      data.candidates?.[0]?.content.parts.map((p) => p.text || "").join("") ||
        "",
    ),
  );
}
export async function checkReply(env: CloudflareEnv, text: string) {
  if (!env.GEMINI_API_KEY) return !blocked(text);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL || "gemini-2.5-flash"}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiKey(env),
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `技大祭SNS。公序良俗、個人情報、攻撃のある文は拒否。次の文の安全性を確認: ${text}`,
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            required: ["ok"],
            properties: { ok: { type: "BOOLEAN" } },
          },
        },
      }),
    },
  );
  if (!response.ok) throw new Error("AI確認に失敗しました");
  const data = (await response.json()) as {
    candidates: { content: { parts: { text: string }[] } }[];
  };
  const v = JSON.parse(data.candidates[0].content.parts[0].text);
  if (typeof v.ok !== "boolean") throw new Error("AI応答が不正です");
  return v.ok;
}
