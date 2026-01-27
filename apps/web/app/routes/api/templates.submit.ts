import { redirect, data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/templates.submit";
import { getDb, getEnv } from "~/lib/env.server";

const submitSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().min(1, "Description is required").max(1000),
  tags: z.string().optional(),
  schema_xml: z.string().min(1, "Schema XML is required"),
  variables: z.string().optional(),
  author_name: z.string().min(1, "Author name is required").max(100),
  author_email: z.string().email("Invalid email address"),
  author_github: z.string().optional(),
});

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const rawData = Object.fromEntries(formData);

  // Validate form data
  const result = submitSchema.safeParse(rawData);
  if (!result.success) {
    return data(
      { errors: result.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { name, description, tags, schema_xml, variables, author_name, author_email, author_github } = result.data;

  // Parse tags
  const tagsList = tags
    ? tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)
    : [];

  // Parse variables JSON
  let variablesObj: Record<string, string> = {};
  if (variables) {
    try {
      variablesObj = JSON.parse(variables);
    } catch {
      return data(
        { errors: { variables: ["Invalid JSON format"] } },
        { status: 400 }
      );
    }
  }

  // Validate XML structure (basic check)
  if (!schema_xml.includes("<folder") && !schema_xml.includes("<file")) {
    return data(
      { errors: { schema_xml: ["Schema must contain at least one <folder> or <file> element"] } },
      { status: 400 }
    );
  }

  // Generate template ID
  const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`;

  // Get D1 database from context
  const db = getDb(context);

  // Insert into database
  await db
    .prepare(
      `INSERT INTO templates (
        id, name, description, schema_xml, variables, tags,
        author_name, author_email, author_github,
        status, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`
    )
    .bind(
      id,
      name,
      description,
      schema_xml,
      JSON.stringify(variablesObj),
      JSON.stringify(tagsList),
      author_name,
      author_email,
      author_github || null
    )
    .run();

  // Create GitHub PR
  try {
    await createGitHubPR({
      id,
      name,
      description,
      schema_xml,
      variables: variablesObj,
      tags: tagsList,
      author_name,
      author_github,
      context,
    });
  } catch (error) {
    console.error("Failed to create GitHub PR:", error);
    // Continue even if PR creation fails - we have the data in D1
  }

  // Redirect to success page or template detail
  return redirect(`/templates/${id}?submitted=true`);
}

interface CreatePRParams {
  id: string;
  name: string;
  description: string;
  schema_xml: string;
  variables: Record<string, string>;
  tags: string[];
  author_name: string;
  author_github?: string;
  context: Route.ActionArgs["context"];
}

async function createGitHubPR(params: CreatePRParams) {
  const { id, name, description, schema_xml, variables, tags, author_name, author_github, context } = params;
  const env = getEnv(context);

  const token = env.GITHUB_TOKEN;
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;

  if (!token) {
    throw new Error("GITHUB_TOKEN not configured");
  }

  const { Octokit } = await import("@octokit/core");
  const octokit = new Octokit({ auth: token });

  // Get the default branch
  const { data: repoData } = await octokit.request("GET /repos/{owner}/{repo}", {
    owner,
    repo,
  });
  const defaultBranch = repoData.default_branch;

  // Get the latest commit SHA
  const { data: refData } = await octokit.request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
    owner,
    repo,
    ref: `heads/${defaultBranch}`,
  });
  const baseSha = refData.object.sha;

  // Create a new branch
  const branchName = `template/${id}`;
  await octokit.request("POST /repos/{owner}/{repo}/git/refs", {
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: baseSha,
  });

  // Create the template file content
  const templateContent = JSON.stringify(
    {
      name,
      description,
      schema_xml,
      variables,
      tags,
      author_name,
      author_github,
    },
    null,
    2
  );

  // Create/update the file
  await octokit.request("PUT /repos/{owner}/{repo}/contents/{path}", {
    owner,
    repo,
    path: `community-templates/${id}.json`,
    message: `Add community template: ${name}`,
    content: base64Encode(templateContent),
    branch: branchName,
  });

  // Create the pull request
  const { data: prData } = await octokit.request("POST /repos/{owner}/{repo}/pulls", {
    owner,
    repo,
    title: `[Community Template] ${name}`,
    head: branchName,
    base: defaultBranch,
    body: `## New Community Template Submission

**Template Name:** ${name}
**Author:** ${author_github ? `@${author_github}` : author_name}
**Tags:** ${tags.join(", ") || "None"}

### Description
${description}

### Checklist
- [ ] Schema is valid XML
- [ ] Variables are properly defined
- [ ] No sensitive information included
- [ ] Template follows community guidelines

---
*This PR was automatically created via the template submission form.*`,
  });

  // Add labels
  await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/labels", {
    owner,
    repo,
    issue_number: prData.number,
    labels: ["community-template", "needs-review"],
  });

  // Update the database with PR info
  const db = getDb(context);
  await db
    .prepare("UPDATE templates SET github_pr_number = ?, github_pr_url = ? WHERE id = ?")
    .bind(prData.number, prData.html_url, id)
    .run();

  return prData;
}

// Base64 encode that works in edge runtime (handles UTF-8)
function base64Encode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
