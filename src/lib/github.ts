/**
 * GitHub repository creation and file pushing
 * Uses GitHub REST API to create repos and commit files
 */

import type { TemplateFile } from "./template";

const GITHUB_API = "https://api.github.com";

export interface GitHubRepoOptions {
  owner: string;
  repo: string;
  private?: boolean;
  description?: string;
}

export interface EnsureRepoResult {
  repoUrl: string;
  cloneUrl: string;
  created: boolean;
}

export interface PushFilesResult {
  commitSha: string;
  commitUrl: string;
  filesCommitted: number;
}

export interface EnsureRepoAndPushResult {
  repo: EnsureRepoResult;
  push: PushFilesResult;
}

// GitHub API response types
interface GitHubUser {
  login: string;
}

interface GitHubRepo {
  html_url: string;
  clone_url: string;
}

interface GitHubRef {
  object: { sha: string };
}

interface GitHubCommit {
  sha: string;
  html_url: string;
  tree: { sha: string };
}

interface GitHubBlob {
  sha: string;
}

interface GitHubTree {
  sha: string;
}

function getGitHubToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN environment variable is required");
  }
  return token;
}

function getGitHubHeaders(): Record<string, string> {
  const token = getGitHubToken();
  // Classic PATs start with ghp_, use "token" prefix
  // Fine-grained tokens and GitHub App tokens use "Bearer"
  const authPrefix = token.startsWith("ghp_") ? "token" : "Bearer";
  return {
    Accept: "application/vnd.github.v3+json",
    Authorization: `${authPrefix} ${token}`,
    "User-Agent": "frontends-mcp-server",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/**
 * Check if a repository exists
 */
async function repoExists(owner: string, repo: string): Promise<boolean> {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers: getGitHubHeaders(),
  });
  return res.ok;
}

/**
 * Create a new repository (user or organization)
 */
async function createRepo(options: GitHubRepoOptions): Promise<EnsureRepoResult> {
  const { owner, repo, private: isPrivate = true, description } = options;

  // Check if creating for user or org
  const userRes = await fetch(`${GITHUB_API}/user`, {
    headers: getGitHubHeaders(),
  });

  if (!userRes.ok) {
    throw new Error(`Failed to get authenticated user: ${userRes.status}`);
  }

  const user = (await userRes.json()) as GitHubUser;
  const isUserRepo = user.login === owner;

  const endpoint = isUserRepo
    ? `${GITHUB_API}/user/repos`
    : `${GITHUB_API}/orgs/${owner}/repos`;

  const body = {
    name: repo,
    description: description ?? "Shopware Frontends storefront",
    private: isPrivate,
    auto_init: true, // Initialize with README so Git Data API works
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...getGitHubHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to create repository: ${res.status} - ${error}`);
  }

  const repoData = (await res.json()) as GitHubRepo;

  return {
    repoUrl: repoData.html_url,
    cloneUrl: repoData.clone_url,
    created: true,
  };
}

/**
 * Ensure a repository exists (create if not)
 */
async function ensureRepo(options: GitHubRepoOptions): Promise<EnsureRepoResult> {
  const { owner, repo } = options;

  const exists = await repoExists(owner, repo);

  if (exists) {
    return {
      repoUrl: `https://github.com/${owner}/${repo}`,
      cloneUrl: `https://github.com/${owner}/${repo}.git`,
      created: false,
    };
  }

  return createRepo(options);
}

/**
 * Push files to a repository using the Git Data API
 * This creates a commit with all files in a single operation
 */
async function pushFiles(
  owner: string,
  repo: string,
  files: TemplateFile[],
  commitMessage: string,
  branch = "main"
): Promise<PushFilesResult> {
  const headers = getGitHubHeaders();
  const baseUrl = `${GITHUB_API}/repos/${owner}/${repo}`;

  // Step 1: Get the current commit SHA for the branch (or create initial commit)
  let baseSha: string | null = null;
  let baseTreeSha: string | null = null;

  try {
    const refRes = await fetch(`${baseUrl}/git/ref/heads/${branch}`, { headers });
    if (refRes.ok) {
      const refData = (await refRes.json()) as GitHubRef;
      baseSha = refData.object.sha;

      // Get the tree SHA
      const commitRes = await fetch(`${baseUrl}/git/commits/${baseSha}`, { headers });
      if (commitRes.ok) {
        const commitData = (await commitRes.json()) as GitHubCommit;
        baseTreeSha = commitData.tree.sha;
      }
    }
  } catch {
    // Branch doesn't exist, will create initial commit
  }

  // Step 2: Create blobs for each file
  const treeItems: Array<{
    path: string;
    mode: "100644";
    type: "blob";
    sha: string;
  }> = [];

  for (const file of files) {
    const blobRes = await fetch(`${baseUrl}/git/blobs`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: file.content,
        encoding: file.encoding === "base64" ? "base64" : "utf-8",
      }),
    });

    if (!blobRes.ok) {
      const error = await blobRes.text();
      throw new Error(`Failed to create blob for ${file.path}: ${blobRes.status} - ${error}`);
    }

    const blobData = (await blobRes.json()) as GitHubBlob;
    treeItems.push({
      path: file.path,
      mode: "100644",
      type: "blob",
      sha: blobData.sha,
    });
  }

  // Step 3: Create a new tree
  const treeBody: { tree: typeof treeItems; base_tree?: string } = {
    tree: treeItems,
  };

  if (baseTreeSha) {
    treeBody.base_tree = baseTreeSha;
  }

  const treeRes = await fetch(`${baseUrl}/git/trees`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(treeBody),
  });

  if (!treeRes.ok) {
    const error = await treeRes.text();
    throw new Error(`Failed to create tree: ${treeRes.status} - ${error}`);
  }

  const treeData = (await treeRes.json()) as GitHubTree;

  // Step 4: Create a new commit
  const commitBody: { message: string; tree: string; parents?: string[] } = {
    message: commitMessage,
    tree: treeData.sha,
  };

  if (baseSha) {
    commitBody.parents = [baseSha];
  }

  const commitRes = await fetch(`${baseUrl}/git/commits`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commitBody),
  });

  if (!commitRes.ok) {
    const error = await commitRes.text();
    throw new Error(`Failed to create commit: ${commitRes.status} - ${error}`);
  }

  const commitData = (await commitRes.json()) as GitHubCommit;

  // Step 5: Update the branch reference (or create it)
  const refEndpoint = baseSha
    ? `${baseUrl}/git/refs/heads/${branch}`
    : `${baseUrl}/git/refs`;

  const refBody = baseSha
    ? { sha: commitData.sha, force: false }
    : { ref: `refs/heads/${branch}`, sha: commitData.sha };

  const refRes = await fetch(refEndpoint, {
    method: baseSha ? "PATCH" : "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(refBody),
  });

  if (!refRes.ok) {
    const error = await refRes.text();
    throw new Error(`Failed to update ref: ${refRes.status} - ${error}`);
  }

  return {
    commitSha: commitData.sha,
    commitUrl: commitData.html_url,
    filesCommitted: files.length,
  };
}

/**
 * Main function: ensure repo exists and push all files
 */
export async function ensureRepoAndPush(
  options: GitHubRepoOptions,
  files: TemplateFile[],
  commitMessage = "Initial commit: Shopware Frontends storefront"
): Promise<EnsureRepoAndPushResult> {
  const repo = await ensureRepo(options);
  const push = await pushFiles(options.owner, options.repo, files, commitMessage);

  return { repo, push };
}
