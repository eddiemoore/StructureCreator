import type { D1Database } from "@cloudflare/workers-types";

export interface Template {
  id: string;
  name: string;
  description: string | null;
  schema_xml: string;
  variables: string; // JSON
  tags: string; // JSON array
  wizard_config: string | null; // JSON
  author_name: string;
  author_email: string;
  author_github: string | null;
  status: "pending" | "approved" | "rejected";
  github_pr_number: number | null;
  github_pr_url: string | null;
  submitted_at: string;
  approved_at: string | null;
  download_count: number;
}

export interface ParsedTemplate extends Omit<Template, "variables" | "tags" | "wizard_config"> {
  variables: Record<string, string>;
  tags: string[];
  wizard_config: Record<string, unknown> | null;
}

export function parseTemplate(template: Template): ParsedTemplate {
  return {
    ...template,
    variables: JSON.parse(template.variables || "{}"),
    tags: JSON.parse(template.tags || "[]"),
    wizard_config: template.wizard_config ? JSON.parse(template.wizard_config) : null,
  };
}

export async function getApprovedTemplates(db: D1Database): Promise<ParsedTemplate[]> {
  const result = await db
    .prepare("SELECT * FROM templates WHERE status = 'approved' ORDER BY submitted_at DESC")
    .all<Template>();

  return result.results.map(parseTemplate);
}

export async function getTemplateById(db: D1Database, id: string): Promise<ParsedTemplate | null> {
  const result = await db
    .prepare("SELECT * FROM templates WHERE id = ?")
    .bind(id)
    .first<Template>();

  return result ? parseTemplate(result) : null;
}

export async function incrementDownloadCount(db: D1Database, id: string): Promise<void> {
  await db
    .prepare("UPDATE templates SET download_count = download_count + 1 WHERE id = ?")
    .bind(id)
    .run();
}

export async function getTemplatesByTag(db: D1Database, tag: string): Promise<ParsedTemplate[]> {
  // SQLite doesn't have native JSON array search, so we use LIKE with JSON format
  const result = await db
    .prepare("SELECT * FROM templates WHERE status = 'approved' AND tags LIKE ? ORDER BY submitted_at DESC")
    .bind(`%"${tag}"%`)
    .all<Template>();

  return result.results.map(parseTemplate);
}

export async function searchTemplates(db: D1Database, query: string): Promise<ParsedTemplate[]> {
  const result = await db
    .prepare(
      `SELECT * FROM templates
       WHERE status = 'approved'
       AND (name LIKE ? OR description LIKE ?)
       ORDER BY submitted_at DESC`
    )
    .bind(`%${query}%`, `%${query}%`)
    .all<Template>();

  return result.results.map(parseTemplate);
}
