import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);
function channels(variable: string) {
  const hex = css.match(new RegExp(`${variable}:\\s*#([a-f0-9]{6})`, "i"))?.[1];
  if (!hex) throw new Error(`CSS variable missing: ${variable}`);
  return hex.match(/../g)!.map((value) => parseInt(value, 16) / 255);
}
function luminance(rgb: number[]) {
  const linear = rgb.map((s) => {
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function contrast(foreground: number[], background: number[]) {
  const a = luminance(foreground),
    b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
it.each([
  ["--muted-on-surface-2", "--surface-2"],
  ["--heart", "--surface"],
  ["--ink", "--mint-deep"],
])("%s on %s meets WCAG AA for small text", (foreground, background) => {
  expect(
    contrast(channels(foreground), channels(background)),
  ).toBeGreaterThanOrEqual(4.5);
});

it("stale situation text meets WCAG AA after applying opacity", () => {
  const opacity = css.match(
    /\.situation \.stale\s*\{[^}]*opacity:\s*([\d.]+)/,
  )?.[1];
  expect(opacity).toBeDefined();
  const background = channels("--surface-2");
  const foreground = channels("--muted-on-surface-2").map(
    (value, i) =>
      value * Number(opacity) + background[i] * (1 - Number(opacity)),
  );
  expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
});
