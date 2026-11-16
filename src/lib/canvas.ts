import { filterParameters, type Face } from "./domain";
const blob = (c: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("画像の変換に失敗しました"))),
      "image/jpeg",
      0.88,
    ),
  );
export async function resize(file: Blob) {
  const image = await createImageBitmap(file);
  const ratio = Math.min(1, 1600 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * ratio));
  canvas.height = Math.max(1, Math.round(image.height * ratio));
  canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  return blob(canvas);
}
export async function imageHash(file: Blob) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
export async function kageFilter(file: Blob, score: number, faces: Face[]) {
  const image = await createImageBitmap(file);
  const c = document.createElement("canvas");
  c.width = image.width;
  c.height = image.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(image, 0, 0);
  image.close();
  const p = filterParameters(score);
  const pixels = ctx.getImageData(0, 0, c.width, c.height);
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      const gray =
        pixels.data[i] * 0.2126 +
        pixels.data[i + 1] * 0.7152 +
        pixels.data[i + 2] * 0.0722;
      const radius = Math.min(
        1,
        Math.hypot(
          (x - c.width / 2) / (c.width / 2),
          (y - c.height / 2) / (c.height / 2),
        ) / Math.SQRT2,
      );
      const noise = (Math.random() * 2 - 1) * p.noise;
      for (let ch = 0; ch < 3; ch++) {
        let v =
          (gray + (pixels.data[i + ch] - gray) * p.saturation) * p.brightness;
        v = (v - 128) * p.contrast + 128;
        v = v * (1 - p.tint) + [35, 65, 70][ch] * p.tint;
        pixels.data[i + ch] = v * (1 - p.vignette * radius * radius) + noise;
      }
    }
  ctx.putImageData(pixels, 0, 0);
  // 顔枠を1.2倍に広げて縮小・拡大し、その領域へぼかしを重ねる。
  for (const f of faces) {
    const x = Math.max(0, (f.x - f.w * 0.1) * c.width),
      y = Math.max(0, (f.y - f.h * 0.1) * c.height),
      w = Math.min(c.width - x, f.w * 1.2 * c.width),
      h = Math.min(c.height - y, f.h * 1.2 * c.height);
    const tiny = document.createElement("canvas");
    tiny.width = Math.max(1, Math.round(w / 18));
    tiny.height = Math.max(1, Math.round(h / 18));
    tiny
      .getContext("2d")!
      .drawImage(c, x, y, w, h, 0, 0, tiny.width, tiny.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.filter = "blur(6px)";
    ctx.drawImage(tiny, x - 6, y - 6, w + 12, h + 12);
    ctx.restore();
  }
  return blob(c);
}
