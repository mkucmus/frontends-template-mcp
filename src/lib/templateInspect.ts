/**
 * Inspect Shopware Frontends base template `templates/vue-starter-template`.
 *
 * This module fetches key files from GitHub (public endpoints) and returns:
 * - top-level structure (files/dirs)
 * - a parsed summary of nuxt.config.ts (best-effort, regex-based)
 *
 * NOTE: This does not execute the template code. It's static inspection only.
 */

type GitHubContentItem =
  | { type: "file"; name: string; path: string; download_url: string | null }
  | { type: "dir"; name: string; path: string; url: string };

const REPO = "shopware/frontends";

function ghContentsUrl(path: string, ref: string) {
  // GitHub Contents API supports "ref" query
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

export function parseNuxtConfigSummary(nuxtConfigTs: string) {
  const summary: any = {
    extends: null as string | null,
    modules: [] as string[],
    runtimeConfigKeys: [] as string[],
    routeRulesPresent: false,
    nitroPresent: false,
    i18nPresent: false,
    rawHints: [] as string[],
  };

  // extends: ["../something"] or extends: "…"
  const extendsMatch = nuxtConfigTs.match(/extends\s*:\s*(\[[^\]]+\]|["'`][^"'`]+["'`])/m);
  if (extendsMatch) summary.extends = extendsMatch[1].trim();

  // modules: [ "a", "@b/c", ... ]
  const modulesMatch = nuxtConfigTs.match(/modules\s*:\s*\[([\s\S]*?)\]/m);
  if (modulesMatch) {
    const inside = modulesMatch[1];
    const mods = Array.from(inside.matchAll(/["'`]([^"'`]+)["'`]/g), (m) => m[1]);
    summary.modules = Array.from(new Set(mods));
  }

  // runtimeConfig keys (best-effort): runtimeConfig: { ... }
  const rcMatch = nuxtConfigTs.match(/runtimeConfig\s*:\s*\{([\s\S]*?)\}\s*,/m);
  if (rcMatch) {
    const block = rcMatch[1];
    const keys = Array.from(block.matchAll(/\n\s*([a-zA-Z0-9_]+)\s*:/g), (m) => m[1]);
    summary.runtimeConfigKeys = Array.from(new Set(keys)).slice(0, 100);
  }

  summary.routeRulesPresent = /routeRules\s*:/.test(nuxtConfigTs);
  summary.nitroPresent = /nitro\s*:/.test(nuxtConfigTs);
  summary.i18nPresent = /i18n\s*:/.test(nuxtConfigTs) || /@nuxtjs\/i18n/.test(nuxtConfigTs);

  // Helpful raw hints
  if (/experimental\s*:/.test(nuxtConfigTs)) summary.rawHints.push("experimental");
  if (/devtools\s*:/.test(nuxtConfigTs)) summary.rawHints.push("devtools");
  if (/vite\s*:/.test(nuxtConfigTs)) summary.rawHints.push("vite");
  if (/typescript\s*:/.test(nuxtConfigTs)) summary.rawHints.push("typescript");

  return summary;
}

export async function describeBaseTemplate(ref: string = "main") {
  const basePath = "templates/vue-starter-template";

  // 1) list top-level structure
  const top = await fetchJson<GitHubContentItem[]>(ghContentsUrl(basePath, ref));

  const structure = {
    files: top.filter((i) => i.type === "file").map((i) => i.path),
    dirs: top.filter((i) => i.type === "dir").map((i) => i.path),
  };

  // 2) fetch key files (if present)
  const find = (p: string) => top.find((i) => i.path.endsWith(p) && i.type === "file") as any;
  const nuxtItem = find("nuxt.config.ts");
  const pkgItem = find("package.json");
  const readmeItem = find("README.md");

  const nuxtConfig = nuxtItem?.download_url ? await fetchText(nuxtItem.download_url) : null;
  const pkg = pkgItem?.download_url ? JSON.parse(await fetchText(pkgItem.download_url)) : null;
  const readme = readmeItem?.download_url ? await fetchText(readmeItem.download_url) : null;

  const nuxtSummary = nuxtConfig ? parseNuxtConfigSummary(nuxtConfig) : null;

  // 3) minimal "capabilities" inferred from files
  const capabilities: string[] = [];
  if (nuxtSummary?.modules?.length) capabilities.push("Nuxt modules configured");
  if (nuxtSummary?.i18nPresent) capabilities.push("i18n present (or referenced)");
  if (nuxtSummary?.routeRulesPresent) capabilities.push("routeRules present");
  if (nuxtSummary?.nitroPresent) capabilities.push("nitro config present");
  if (structure.dirs.some((d) => d.endsWith("/components"))) capabilities.push("Vue components structure");
  if (structure.dirs.some((d) => d.endsWith("/pages"))) capabilities.push("Nuxt pages routing");
  if (structure.dirs.some((d) => d.endsWith("/composables"))) capabilities.push("Nuxt composables");
  if (structure.dirs.some((d) => d.endsWith("/server"))) capabilities.push("Server routes / Nitro server directory");

  return {
    template: "vue-starter-template",
    ref,
    structure,
    packageJson: pkg ? { name: pkg.name, dependencies: pkg.dependencies, devDependencies: pkg.devDependencies } : null,
    nuxtConfigSummary: nuxtSummary,
    // keep README short-ish to avoid huge payload; first 2000 chars
    readmeExcerpt: readme ? readme.slice(0, 2000) : null,
    capabilities: Array.from(new Set(capabilities)),
    fetchedFiles: {
      nuxtConfig: Boolean(nuxtConfig),
      packageJson: Boolean(pkg),
      readme: Boolean(readme),
    },
  };
}
