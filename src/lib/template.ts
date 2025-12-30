/**
 * Template fetching from GitHub
 * Fetches the Shopware Frontends template recursively using GitHub API
 */

const GITHUB_API = "https://api.github.com";
const REPO_OWNER = "shopware";
const REPO_NAME = "frontends";

export interface TemplateFile {
  path: string;
  content: string;
  encoding: "utf-8" | "base64";
}

export interface FetchTemplateOptions {
  template?: "vue-starter-template" | "vue-starter-template-extended";
  ref?: string;
}

export interface FetchTemplateResult {
  files: TemplateFile[];
  template: string;
  ref: string;
}

interface GitHubContentItem {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
  content?: string;
  encoding?: string;
}

function getGitHubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "frontends-mcp-server",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function githubFetchDirectory(path: string, ref: string): Promise<GitHubContentItem[]> {
  const url = `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}?ref=${ref}`;
  const res = await fetch(url, { headers: getGitHubHeaders() });

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText} for ${path}`);
  }

  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error(`Expected directory at ${path}, got file`);
  }
  return data as GitHubContentItem[];
}

async function githubFetchFile(path: string, ref: string): Promise<GitHubContentItem> {
  const url = `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}?ref=${ref}`;
  const res = await fetch(url, { headers: getGitHubHeaders() });

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText} for ${path}`);
  }

  return res.json() as Promise<GitHubContentItem>;
}

async function fetchFileContent(path: string, ref: string): Promise<string> {
  const data = await githubFetchFile(path, ref);

  if (data.encoding === "base64" && data.content) {
    return Buffer.from(data.content, "base64").toString("utf-8");
  }

  // For larger files, fetch via download_url
  if (data.download_url) {
    const res = await fetch(data.download_url);
    if (!res.ok) {
      throw new Error(`Failed to download ${path}: ${res.status}`);
    }
    return res.text();
  }

  throw new Error(`Cannot fetch content for ${path}`);
}

async function fetchDirectoryRecursive(
  basePath: string,
  ref: string,
  relativePath = ""
): Promise<TemplateFile[]> {
  const fullPath = relativePath ? `${basePath}/${relativePath}` : basePath;
  const contents = await githubFetchDirectory(fullPath, ref);

  const files: TemplateFile[] = [];

  for (const item of contents) {
    const itemRelativePath = relativePath ? `${relativePath}/${item.name}` : item.name;

    if (item.type === "file") {
      // Skip binary files that we can't handle as text
      const binaryExtensions = [".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".eot"];
      const isBinary = binaryExtensions.some((ext) => item.name.toLowerCase().endsWith(ext));

      if (isBinary && item.download_url) {
        // For binary files, fetch raw content as base64
        try {
          const res = await fetch(item.download_url, { headers: getGitHubHeaders() });
          if (res.ok) {
            const buffer = await res.arrayBuffer();
            files.push({
              path: itemRelativePath,
              content: Buffer.from(buffer).toString("base64"),
              encoding: "base64",
            });
          }
        } catch {
          // Skip binary files that fail to fetch
        }
      } else if (!isBinary) {
        try {
          const content = await fetchFileContent(`${basePath}/${itemRelativePath}`, ref);
          files.push({
            path: itemRelativePath,
            content,
            encoding: "utf-8",
          });
        } catch {
          // Skip files that fail to fetch
        }
      }
    } else if (item.type === "dir") {
      const subFiles = await fetchDirectoryRecursive(basePath, ref, itemRelativePath);
      files.push(...subFiles);
    }
  }

  return files;
}

/**
 * Fetch a Shopware Frontends template from GitHub
 * Returns all files as an array with path and content
 */
export async function fetchTemplate(
  options: FetchTemplateOptions = {}
): Promise<FetchTemplateResult> {
  const template = options.template ?? "vue-starter-template-extended";
  const ref = options.ref ?? "main";
  const templatePath = `templates/${template}`;

  const files = await fetchDirectoryRecursive(templatePath, ref);

  return {
    files,
    template,
    ref,
  };
}
