import { getPlatformProxy } from "wrangler";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { demoSeed } from "./demo-seed";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { sha256, publicId, jstDate } from "../src/lib/domain";
const demo = process.argv.includes("--demo-sql") ? demoSeed() : undefined;
const platform = demo ? undefined : await getPlatformProxy<CloudflareEnv>({
  persist: { path: ".wrangler/state/v3" },
});
const manifest: string[] = [];
async function put(key: string, bytes: Buffer, contentType: string) {
  if (platform) {
    await platform.env.IMAGES.put(key, bytes, { httpMetadata: { contentType } });
  } else {
    const file = "demo/r2/" + key;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
    manifest.push([key, file, contentType].join("\t"));
  }
}
try {
  const run = async (sql: string, ...args: (string | number | null)[]) => {
    if (demo) demo.add(sql, args);
    else await platform!.env.DB.prepare(sql).bind(...args).run();
  };
  const now = new Date();
  const date = (d: number) => jstDate(new Date(now.getTime() + d * 86400000));
  await run(
    "INSERT OR IGNORE INTO settings VALUES (?,?)",
    "festival_start",
    date(-1),
  );
  await run(
    "INSERT OR IGNORE INTO settings VALUES (?,?)",
    "festival_end",
    date(2),
  );
  await run(
    "INSERT OR IGNORE INTO admins VALUES ('sample-admin','FAKE_ADMIN','架空・運営あおい',1)",
  );
  const map = new PNG({ width: 1000, height: 750 });
  for (let y = 0; y < 750; y++)
    for (let x = 0; x < 1000; x++) {
      const i = (y * 1000 + x) * 4;
      const road = x % 250 < 45 || y % 230 < 45;
      map.data[i] = road ? 220 : 153;
      map.data[i + 1] = road ? 227 : 175;
      map.data[i + 2] = road ? 231 : 179;
      map.data[i + 3] = 255;
    }
  await put("map/sample.png", PNG.sync.write(map), "image/png");
  await run(
    "INSERT OR IGNORE INTO map VALUES ('current','map/sample.png',1000,750)",
  );
  const names = [
    "機械系 焼きそば",
    "架空のたこ焼き",
    "情報のカフェ",
    "電気のわたあめ",
    "化学のクレープ",
    "野外ステージ",
    "展示ホール",
    "ものづくり体験",
    "休憩エリア",
    "中庭",
    "案内所",
    "お手洗い",
  ];
  for (let i = 0; i < 12; i++)
    await run(
      "INSERT OR IGNORE INTO places VALUES (?,?,?,?,?,?,1)",
      `place-${i + 1}`,
      names[i],
      i < 5 ? "stall" : i < 8 ? "event" : i < 10 ? "area" : "facility",
      0.14 + (i % 4) * 0.24,
      0.16 + Math.floor(i / 4) * 0.32,
      "架空の技大祭サンプルです",
    );
  for (let i = 0; i < 4; i++) {
    const device = await sha256(`sample-device-${i}`);
    await run(
      "INSERT OR IGNORE INTO devices VALUES (?,?,?,?)",
      device,
      await publicId(device, demo ? "seed-fixture-device-ids-not-a-secret" : platform!.env.DEVICE_ID_SECRET || ""),
      ["木陰", "すみっこ", "灰色", "夕暮れ"][i],
      now.toISOString(),
    );
  }
  const kinds = ["crowd", "status", "recommend", "tip", "daily"];
  const captions = [
    "少し並んでいます #技大祭",
    "まだ販売中です #屋台",
    "落ち着く味でした #おすすめ",
    "ここは静かです #穴場",
    "ただ座っています #技大祭",
  ];
  for (let i = 0; i < 20; i++) {
    const id = `sample-post-${i + 1}`,
      key = `posts/${id}.jpg`;
    const image = {
      width: 640,
      height: 420,
      data: Buffer.alloc(640 * 420 * 4),
    };
    for (let y = 0; y < 420; y++)
      for (let x = 0; x < 640; x++) {
        const p = (y * 640 + x) * 4;
        const v = 35 + ((x * 3 + y + i * 17) % 45);
        image.data[p] = v;
        image.data[p + 1] = v + 12;
        image.data[p + 2] = v + 17;
        image.data[p + 3] = 255;
      }
    await put(key, jpeg.encode(image, 80).data, "image/jpeg");
    await run(
      "INSERT OR IGNORE INTO posts(id,device_id,nickname,caption,place_id,topic,image_key,width,height,kira_score,kira_reason,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      id,
      await sha256(`sample-device-${i % 4}`),
      ["木陰", "すみっこ", "灰色", "夕暮れ"][i % 4],
      captions[i % 5],
      `place-${(i % 12) + 1}`,
      kinds[i % 5],
      key,
      640,
      420,
      (i * 13) % 101,
      "その彩り、陰には贅沢",
      new Date(now.getTime() - i * 9 * 60000).toISOString(),
    );
    const tag = ["技大祭", "屋台", "おすすめ", "穴場", "技大祭"][i % 5];
    await run(
      "INSERT OR IGNORE INTO hashtags SELECT ?,?,NULL,? WHERE NOT EXISTS(SELECT 1 FROM hashtags WHERE tag=? AND post_id=?)",
      tag,
      id,
      now.toISOString(),
      tag,
      id,
    );
  }
  for (let i = 0; i < 3; i++) {
    const device = await sha256(`sample-device-${i + 1}`);
    await run(
      "INSERT OR IGNORE INTO hearts VALUES (?,?,?)",
      "sample-post-1",
      device,
      now.toISOString(),
    );
    await run(
      "INSERT OR IGNORE INTO replies(id,post_id,device_id,nickname,body,created_at) VALUES (?,?,?,?,?,?)",
      `sample-reply-${i}`,
      "sample-post-1",
      device,
      "架空の来場者",
      "静かでよかったです #穴場",
      now.toISOString(),
    );
    await run(
      "INSERT OR IGNORE INTO reports VALUES (?,?,?,?,?,?)",
      `sample-report-${i}`,
      "post",
      "sample-post-20",
      device,
      "other",
      now.toISOString(),
    );
  }
  if (demo) {
    await demo.write();
    await writeFile("demo/r2-manifest.txt", manifest.join("\n") + "\n");
  }
  console.log(
    "架空の場所12件、陰化済み写真20件、返信・ハート・通報、開催期間、運営を用意しました",
  );
} finally {
  await platform?.dispose();
}
