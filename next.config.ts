import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

if (process.env.NODE_ENV === "development") {
  initOpenNextCloudflareForDev();
}

const config: NextConfig = {
  // Cloudflare のバインディングはリクエストごとに取得する。
  serverExternalPackages: ["@opennextjs/cloudflare"],
};
export default config;
