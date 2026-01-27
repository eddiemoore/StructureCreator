import type { D1Database } from "@cloudflare/workers-types";

export interface CloudflareEnv {
  DB: D1Database;
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_WEBHOOK_SECRET: string;
}

interface CloudflareContext {
  cloudflare: {
    env: CloudflareEnv;
  };
}

export function getEnv(context: unknown): CloudflareEnv {
  return (context as CloudflareContext).cloudflare.env;
}

export function getDb(context: unknown): D1Database {
  return getEnv(context).DB;
}
