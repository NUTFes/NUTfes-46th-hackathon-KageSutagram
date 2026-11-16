import { getPlatformProxy } from "wrangler";
import { cleanup } from "../src/lib/cleanup";
const { env, dispose } = await getPlatformProxy<CloudflareEnv>({
  persist: { path: ".wrangler/state/v3" },
});
try {
  console.log(await cleanup(env));
} finally {
  await dispose();
}
