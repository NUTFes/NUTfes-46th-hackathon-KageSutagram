import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
export const settings = sqliteTable("settings", {
  key: text().primaryKey(),
  value: text().notNull(),
});
export const devices = sqliteTable("devices", {
  device_id: text().primaryKey(),
  public_id: text().notNull().unique(),
  last_nickname: text().notNull(),
  created_at: text().notNull(),
});
export const dailyUsage = sqliteTable(
  "daily_usage",
  {
    device_id: text().notNull(),
    date: text().notNull(),
    post_count: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.device_id, t.date] })],
);
export const places = sqliteTable("places", {
  id: text().primaryKey(),
  name: text().notNull(),
  kind: text().notNull(),
  x: real().notNull(),
  y: real().notNull(),
  description: text(),
  is_active: integer().notNull().default(1),
});
export const map = sqliteTable("map", {
  key: text().primaryKey(),
  image_key: text().notNull(),
  width: integer().notNull(),
  height: integer().notNull(),
});
export const judgeTokens = sqliteTable("judge_tokens", {
  token: text().primaryKey(),
  device_id: text().notNull(),
  width: integer().notNull(),
  height: integer().notNull(),
  image_hash: text().notNull(),
  kira_score: integer().notNull(),
  kira_reason: text().notNull(),
  faces: text().notNull(),
  nickname: text().notNull(),
  caption: text().notNull(),
  expires_at: text().notNull(),
  used_at: text(),
});
export const posts = sqliteTable(
  "posts",
  {
    id: text().primaryKey(),
    device_id: text().notNull(),
    nickname: text().notNull(),
    caption: text().notNull(),
    place_id: text(),
    topic: text().notNull(),
    judge_token: text(),
    image_key: text().notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    kira_score: integer().notNull(),
    kira_reason: text().notNull(),
    heart_count: integer().notNull().default(0),
    reply_count: integer().notNull().default(0),
    report_count: integer().notNull().default(0),
    status: text().notNull().default("published"),
    created_at: text().notNull(),
  },
  (t) => [
    uniqueIndex("post_judge_token").on(t.judge_token),
    index("posts_status_created").on(t.status, t.created_at),
    index("posts_place").on(t.place_id, t.status, t.created_at),
  ],
);
export const replies = sqliteTable("replies", {
  id: text().primaryKey(),
  post_id: text().notNull(),
  device_id: text().notNull(),
  nickname: text().notNull(),
  body: text().notNull(),
  report_count: integer().notNull().default(0),
  status: text().notNull().default("published"),
  created_at: text().notNull(),
});
export const hearts = sqliteTable(
  "hearts",
  {
    post_id: text().notNull(),
    device_id: text().notNull(),
    created_at: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.post_id, t.device_id] })],
);
export const reports = sqliteTable(
  "reports",
  {
    id: text().primaryKey(),
    target_type: text().notNull(),
    target_id: text().notNull(),
    device_id: text().notNull(),
    reason: text().notNull(),
    created_at: text().notNull(),
  },
  (t) => [
    uniqueIndex("report_device").on(t.target_type, t.target_id, t.device_id),
  ],
);
export const hashtags = sqliteTable(
  "hashtags",
  {
    tag: text().notNull(),
    post_id: text(),
    reply_id: text(),
    created_at: text().notNull(),
  },
  (t) => [index("hashtag_tag").on(t.tag)],
);
export const admins = sqliteTable("admins", {
  id: text().primaryKey(),
  slack_user_id: text().notNull(),
  display_name: text().notNull(),
  is_active: integer().notNull().default(1),
});
export const sessions = sqliteTable("sessions", {
  id: text().primaryKey(),
  admin_id: text().notNull(),
  expires_at: text().notNull(),
});
export const rateLimits = sqliteTable("rate_limits", {
  device_id: text().primaryKey(),
  window: integer().notNull(),
  count: integer().notNull(),
});
