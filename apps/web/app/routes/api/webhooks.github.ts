import { data } from "react-router";
import type { Route } from "./+types/webhooks.github";

export async function action({ request, context }: Route.ActionArgs) {
  const env = (context.cloudflare as { env: Record<string, string | D1Database> }).env;

  // Verify webhook signature
  const signature = request.headers.get("x-hub-signature-256");
  const secret = env.GITHUB_WEBHOOK_SECRET as string;

  if (!signature || !secret) {
    return data({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.text();

  // Verify signature
  const isValid = await verifySignature(body, signature, secret);
  if (!isValid) {
    return data({ error: "Invalid signature" }, { status: 401 });
  }

  // Parse the webhook payload
  const payload = JSON.parse(body);
  const event = request.headers.get("x-github-event");

  // Handle pull request events
  if (event === "pull_request") {
    await handlePullRequestEvent(payload, env.DB as D1Database);
  }

  return data({ success: true });
}

async function verifySignature(body: string, signature: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expectedSignature = `sha256=${Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;

  return signature === expectedSignature;
}

interface PullRequestPayload {
  action: string;
  pull_request: {
    number: number;
    merged: boolean;
    labels: Array<{ name: string }>;
  };
}

async function handlePullRequestEvent(payload: PullRequestPayload, db: D1Database) {
  const { action, pull_request } = payload;

  // Check if this is a community template PR
  const isTemplatePR = pull_request.labels.some((l) => l.name === "community-template");
  if (!isTemplatePR) {
    return;
  }

  const prNumber = pull_request.number;

  if (action === "closed" && pull_request.merged) {
    // PR was merged - approve the template
    await db
      .prepare(
        "UPDATE templates SET status = 'approved', approved_at = datetime('now') WHERE github_pr_number = ?"
      )
      .bind(prNumber)
      .run();
  } else if (action === "closed" && !pull_request.merged) {
    // PR was closed without merging - reject the template
    await db
      .prepare("UPDATE templates SET status = 'rejected' WHERE github_pr_number = ?")
      .bind(prNumber)
      .run();
  }
}
