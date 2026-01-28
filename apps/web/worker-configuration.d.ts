interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_WEBHOOK_SECRET: string;
}
