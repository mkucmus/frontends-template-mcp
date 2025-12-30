/**
 * Inspect Shopware Frontends packages (monorepo `/packages`).
 *
 * Fetches directory listing from GitHub Contents API and returns:
 * - list of package directories
 * - for each package: package.json summary (if available) + README excerpt (if available)
 *
 * Static inspection only (no code execution).
 */
type GitHubContentItem =
  | { type: "file"; name: string; path: string; download_url: string | null }
  | { type: "dir"; name: string; path: string; url: string };

const REPO = "shopware/frontends";

function ghContentsUrl(path: string, ref: string) {
  return `https://api.github.com/repos/${REPO}/contents/${path}?ref=${encodeURIComponent(ref)}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "frontends-mcp-store-factory"
    }
  });
  if (!res.ok) throw new Error(`GitHub API request failed (${res.status}) for ${url}`);
  return (await res.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`Failed to fetch text (${res.status}) for ${url}`);
  return await res.text();
}

function summarizePackageJson(pkg: any) {
  return {
    name: pkg?.name ?? null,
    version: pkg?.version ?? null,
    description: pkg?.description ?? null,
    type: pkg?.type ?? null,
    exports: pkg?.exports ?? null,
    dependencies: pkg?.dependencies ?? null,
    devDependencies: pkg?.devDependencies ?? null,
    peerDependencies: pkg?.peerDependencies ?? null,
  };
}

export async function describePackages(ref: string = "main") {
  const root = await fetchJson<GitHubContentItem[]>(ghContentsUrl("packages", ref));
  const packageDirs = root.filter((i) => i.type === "dir").map((i) => i.path);

  const packages: any[] = [];
  for (const pkgPath of packageDirs) {
    try {
      const listing = await fetchJson<GitHubContentItem[]>(ghContentsUrl(pkgPath, ref));
      const pkgItem = listing.find((i) => i.type === "file" && i.name === "package.json") as any;
      const readmeItem = listing.find((i) => i.type === "file" && i.name.toLowerCase() === "readme.md") as any;

      const pkg = pkgItem?.download_url ? JSON.parse(await fetchText(pkgItem.download_url)) : null;
      const readme = readmeItem?.download_url ? await fetchText(readmeItem.download_url) : null;

      packages.push({
        path: pkgPath,
        dirName: pkgPath.split("/").pop(),
        packageJson: pkg ? summarizePackageJson(pkg) : null,
        readmeExcerpt: readme ? readme.slice(0, 2000) : null,
        fetchedFiles: { packageJson: Boolean(pkg), readme: Boolean(readme) },
      });
    } catch (e: any) {
      packages.push({
        path: pkgPath,
        dirName: pkgPath.split("/").pop(),
        error: e?.message ?? String(e),
      });
    }
  }

  return {
    ref,
    packageCount: packages.length,
    packages,
  };
}
