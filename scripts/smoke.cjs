const { chromium } = require("../../.tools/node_modules/playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const base = process.env.KAGE_URL || "http://localhost:3300";
const out = path.resolve(__dirname, "../.wrangler/verification");
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  try {
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
      }),
      page = await context.newPage();
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    console.log("投稿画面");
    await page.goto(base + "/post");
    await page
      .getByText("現在はオフラインのダミー判定です。", { exact: false })
      .waitFor();
    console.log("画像生成");
    const image = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 420;
      const x = c.getContext("2d");
      x.fillStyle = "#dba86a";
      x.fillRect(0, 0, 640, 420);
      x.fillStyle = "#234a65";
      x.fillRect(180, 80, 200, 190);
      return c.toDataURL("image/jpeg").split(",")[1];
    });
    console.log("入力開始");
    await page.getByLabel("ニックネーム", { exact: true }).fill("検証の木陰");
    await page.getByLabel("一言（40字まで）").fill("ここは静か #ＳＭＯＫＥ");
    console.log("写真選択");
    await page
      .getByLabel("写真を選ぶ")
      .setInputFiles({
        name: "sample.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.from(image, "base64"),
      });
    console.log("場所選択");
    await page.getByLabel("場所（任意）").selectOption("place-1");
    console.log("種類選択");
    await page.getByLabel("情報の種類", { exact: true }).selectOption("crowd");
    console.log("判定開始");
    await page.getByRole("button", { name: "判定する", exact: true }).click();
    console.log("結果待ち");
    await page.waitForURL("**/post/result");
    await page.getByText("陰化が完了しました").waitFor();
    await page.waitForTimeout(1800);
    await page.screenshot({
      path: path.join(out, "result-mobile.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "投稿する", exact: true }).click();
    await page.waitForURL("**/p/**");
    const id = new URL(page.url()).pathname.split("/").pop();
    await page.getByText("♡ 数は見えません", { exact: true }).waitFor();
    const secret = await page.evaluate(() =>
      localStorage.getItem("device_secret"),
    );
    const ownerHeaders = { "X-Device-Secret": secret, Origin: base };
    let response = await context.request.get(base + "/api/posts/" + id, {
      headers: ownerHeaders,
    });
    let detail = await response.json();
    assert.equal(detail.post.heart_count, null);
    assert.equal(detail.post.device_id, undefined);
    const publicId = detail.post.public_id,
      imageKey = detail.post.image_key;
    assert.equal(
      (
        await context.request.post(base + "/api/posts/" + id + "/heart", {
          headers: ownerHeaders,
          data: {},
        })
      ).status(),
      400,
    );
    const other = await browser.newContext(),
      otherPage = await other.newPage();
    await otherPage.goto(base + "/p/" + id);
    await otherPage.getByRole("button", { name: "♡ 0", exact: true }).waitFor();
    const otherSecret = await otherPage.evaluate(() =>
      localStorage.getItem("device_secret"),
    );
    const headers = { "X-Device-Secret": otherSecret, Origin: base };
    await otherPage.getByRole("button", { name: "♡ 0", exact: true }).click();
    await otherPage.getByRole("button", { name: "♡ 1", exact: true }).waitFor();
    assert.equal(
      (
        await other.request.post(base + "/api/posts/" + id + "/heart", {
          headers,
          data: {},
        })
      ).status(),
      200,
    );
    assert.equal(
      (
        await (
          await other.request.get(base + "/api/posts/" + id, { headers })
        ).json()
      ).post.heart_count,
      1,
    );
    await otherPage
      .getByLabel("ニックネーム", { exact: true })
      .fill("別の来場者");
    await otherPage
      .getByLabel("返信（40字まで・AIチェックあり）")
      .fill("ありがとう #返信タグ");
    await otherPage
      .getByRole("button", { name: "返信する", exact: true })
      .click();
    await otherPage
      .getByText("ありがとう #返信タグ", { exact: false })
      .waitFor();
    assert.equal(
      (
        await other.request.post(base + "/api/posts/" + id + "/replies", {
          headers,
          data: { nickname: "検証", body: "死ね" },
        })
      ).status(),
      422,
    );
    const reply = (
      await (
        await other.request.get(base + "/api/posts/" + id, { headers })
      ).json()
    ).replies[0];
    assert.equal(
      (
        await context.request.delete(base + "/api/replies/" + reply.id, {
          headers: ownerHeaders,
        })
      ).status(),
      403,
    );
    for (const route of [
      "/map",
      "/places/place-1",
      "/tags/smoke",
      "/tags/返信タグ",
      "/u/" + publicId,
      "/?sort=popular",
      "/?sort=kage&topic=crowd",
    ]) {
      await page.goto(base + route);
      await page.waitForLoadState("networkidle");
      assert.equal(await page.locator("main [role=alert]").innerText(), "");
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    }
    await page.goto(base + "/map");
    await page.screenshot({
      path: path.join(out, "map-mobile.png"),
      fullPage: true,
    });
    for (let i = 0; i < 3; i++) {
      const reportHeaders = {
        "X-Device-Secret": (i + 1).toString(16).repeat(64),
        Origin: base,
      };
      assert.equal(
        (
          await other.request.post(base + "/api/reports", {
            headers: reportHeaders,
            data: { target_type: "post", target_id: id, reason: "face" },
          })
        ).status(),
        200,
      );
      if (i === 0)
        assert.equal(
          (
            await other.request.post(base + "/api/reports", {
              headers: reportHeaders,
              data: { target_type: "post", target_id: id, reason: "face" },
            })
          ).status(),
          200,
        );
    }
    assert.equal(
      (await other.request.get(base + "/api/posts/" + id)).status(),
      404,
    );
    assert.equal(
      (await other.request.get(base + "/api/images/" + imageKey)).status(),
      404,
    );
    assert.equal(
      (await other.request.get(base + "/api/admin/reports")).status(),
      401,
    );
    await page.goto(base + "/admin/login");
    await page
      .getByRole("button", { name: "開発ログイン", exact: true })
      .click();
    await page.waitForURL("**/admin/reports");
    const reports = await (
      await context.request.get(base + "/api/admin/reports")
    ).json();
    const target = reports.reports.find((r) => r.target_id === id);
    assert.equal(target.count, 3);
    assert.equal(target.target.status, "held");
    assert.equal(target.target.heart_count, undefined);
    assert.equal(
      (
        await context.request.post(
          base + "/api/admin/posts/" + id + "/restore",
          { headers: { Origin: base }, data: {} },
        )
      ).status(),
      200,
    );
    assert.equal(
      (await other.request.get(base + "/api/posts/" + id)).status(),
      200,
    );
    await page.goto(base + "/admin/places");
    await page
      .getByText("地図をクリックしてピン位置を選んでください。")
      .waitFor();
    await page.locator(".map-stage").click({ position: { x: 80, y: 110 } });
    await page.getByLabel("場所名", { exact: true }).fill("検証の休憩所");
    await page.getByRole("button", { name: "場所を保存", exact: true }).click();
    await page.getByRole("button", { name: "検証の休憩所を編集" }).waitFor();
    const fixtureMap = Buffer.from(image, "base64");
    await page
      .getByLabel("マップ画像", { exact: true })
      .setInputFiles({
        name: "map.jpg",
        mimeType: "image/jpeg",
        buffer: fixtureMap,
      });
    await page
      .getByRole("button", { name: "マップをアップロード", exact: true })
      .click();
    await page.waitForLoadState("networkidle");
    await page.goto(base + "/admin/settings");
    await page
      .getByRole("button", { name: "開催期間を保存", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "開催期間を保存", exact: true })
      .click();
    await page.waitForLoadState("networkidle");
    assert.equal(
      (
        await context.request.post(base + "/api/admin/posts/" + id + "/hide", {
          headers: { Origin: "https://invalid.example" },
          data: {},
        })
      ).status(),
      403,
    );
    assert.equal(
      (await context.request.get(base + "/api/auth/slack/login")).status(),
      501,
    );
    await page.goto(base + "/");
    await page.waitForLoadState("networkidle");
    await page.screenshot({
      path: path.join(out, "timeline-mobile.png"),
      fullPage: true,
    });
    assert.equal(
      (
        await other.request.delete(base + "/api/posts/" + id, { headers })
      ).status(),
      403,
    );
    assert.equal(
      (
        await context.request.delete(base + "/api/posts/" + id, {
          headers: ownerHeaders,
        })
      ).status(),
      200,
    );
    assert.equal(
      (await other.request.get(base + "/api/images/" + imageKey)).status(),
      404,
    );
    assert.deepEqual(errors, []);
    console.log(
      "成功：写真の判定→陰化→投稿、本人のハート数非表示、別端末のハート・返信、タグ、地図、場所、公開ユーザー、通報held、運営復帰・場所編集・マップ・期間、本人削除、モバイル表示",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
