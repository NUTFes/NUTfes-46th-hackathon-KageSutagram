interface CloudflareEnv {
  SLACK_CLIENT_ID?: string;
  SLACK_CLIENT_SECRET?: string;
  SLACK_TEAM_ID?: string;
  APP_BASE_URL?: string;
  DB: D1Database;
  IMAGES: R2Bucket;
  SESSION_SECRET?: string;
  DEVICE_ID_SECRET?: string;
  DEV_LOGIN?: string;
  APP_ENV?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  STATUS_FRESH_MIN?: string;
  STATUS_STALE_MIN?: string;
}
