import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
export async function getDb() {
  return drizzle((await getCloudflareContext({ async: true })).env.DB, {
    schema,
  });
}
