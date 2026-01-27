import { Octokit } from "@octokit/core";
import { base64Encode } from "./encoding.server";

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
}

export interface CreatePROptions {
  branchName: string;
  filePath: string;
  fileContent: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
  labels?: string[];
}

export async function createPullRequest(
  config: GitHubConfig,
  options: CreatePROptions
): Promise<{ number: number; url: string }> {
  const octokit = new Octokit({ auth: config.token });
  const { owner, repo } = config;
  const { branchName, filePath, fileContent, commitMessage, prTitle, prBody, labels } = options;

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
  await octokit.request("POST /repos/{owner}/{repo}/git/refs", {
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: baseSha,
  });

  // Create/update the file
  await octokit.request("PUT /repos/{owner}/{repo}/contents/{path}", {
    owner,
    repo,
    path: filePath,
    message: commitMessage,
    content: base64Encode(fileContent),
    branch: branchName,
  });

  // Create the pull request
  const { data: prData } = await octokit.request("POST /repos/{owner}/{repo}/pulls", {
    owner,
    repo,
    title: prTitle,
    head: branchName,
    base: defaultBranch,
    body: prBody,
  });

  // Add labels if provided
  if (labels && labels.length > 0) {
    await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/labels", {
      owner,
      repo,
      issue_number: prData.number,
      labels,
    });
  }

  return {
    number: prData.number,
    url: prData.html_url,
  };
}

export async function getPullRequest(
  config: GitHubConfig,
  prNumber: number
): Promise<{
  number: number;
  state: string;
  merged: boolean;
  url: string;
}> {
  const octokit = new Octokit({ auth: config.token });
  const { owner, repo } = config;

  const { data } = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
    owner,
    repo,
    pull_number: prNumber,
  });

  return {
    number: data.number,
    state: data.state,
    merged: data.merged,
    url: data.html_url,
  };
}
