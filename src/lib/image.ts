import jpeg from "jpeg-js";
import { PNG } from "pngjs";
export function decodeImage(bytes: Uint8Array) {
  if (bytes.length > 5 * 1024 * 1024) throw new Error("画像は5MBまでです");
  let image: { width: number; height: number; data: Uint8Array };
  if (bytes[0] === 255 && bytes[1] === 216)
    image = jpeg.decode(bytes, {
      useTArray: true,
      maxMemoryUsageInMB: 64,
      maxResolutionInMP: 4,
    });
  else if (
    Buffer.from(bytes.slice(0, 8)).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(16) * view.getUint32(20) > 2560000)
      throw new Error("画像が大きすぎます");
    image = PNG.sync.read(Buffer.from(bytes));
  } else throw new Error("JPEG/PNGを選んでください");
  if (
    image.width > 1600 ||
    image.height > 1600 ||
    !image.width ||
    !image.height
  )
    throw new Error("画像の長辺は1600pxまでです");
  return image;
}
