// OpenNextのHTTPハンドラへ日次の削除処理を追加する。
// @ts-ignore OpenNextのビルドで生成する。
import worker from "./.open-next/worker.js";
import { cleanup } from "./src/lib/cleanup";
export default {
  fetch: worker.fetch,
  scheduled(
    _event: ScheduledController,
    env: CloudflareEnv,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(cleanup(env));
  },
};
