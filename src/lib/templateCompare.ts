/**
 * Compare Shopware Frontends templates:
 * - templates/vue-starter-template (reference implementation)
 * - templates/vue-starter-template-extended (example of extending / branding)
 *
 * Uses GitHub Contents API + raw download_url. Static inspection only.
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

  const extendsMatch = nuxtConfigTs.match(/extends\s*:\s*(\[[^\]]+\]|["'`][^"'`]+["'`])/m);
  if (extendsMatch) summary.extends = extendsMatch[1].trim();

  const modulesMatch = nuxtConfigTs.match(/modules\s*:\s*\[([\s\S]*?)\]/m);
  if (modulesMatch) {
    const inside = modulesMatch[1];
    const mods = Array.from(inside.matchAll(/["'`]([^"'`]+)["'`]/g), (m) => m[1]);
    summary.modules = Array.from(new Set(mods));
  }

  const rcMatch = nuxtConfigTs.match(/runtimeConfig\s*:\s*\{([\s\S]*?)\}\s*,/m);
  if (rcMatch) {
    const block = rcMatch[1];
    const keys = Array.from(block.matchAll(/\n\s*([a-zA-Z0-9_]+)\s*:/g), (m) => m[1]);
    summary.runtimeConfigKeys = Array.from(new Set(keys)).slice(0, 200);
  }

  summary.routeRulesPresent = /routeRules\s*:/.test(nuxtConfigTs);
  summary.nitroPresent = /nitro\s*:/.test(nuxtConfigTs);
  summary.i18nPresent = /i18n\s*:/.test(nuxtConfigTs) || /@nuxtjs\/i18n/.test(nuxtConfigTs);

  if (/experimental\s*:/.test(nuxtConfigTs)) summary.rawHints.push("experimental");
  if (/devtools\s*:/.test(nuxtConfigTs)) summary.rawHints.push("devtools");
  if (/vite\s*:/.test(nuxtConfigTs)) summary.rawHints.push("vite");
  if (/typescript\s*:/.test(nuxtConfigTs)) summary.rawHints.push("typescript");

  return summary;
}

function summarizePackageJson(pkg: any) {
  return {
    name: pkg?.name ?? null,
    version: pkg?.version ?? null,
    description: pkg?.description ?? null,
    dependencies: pkg?.dependencies ?? null,
    devDependencies: pkg?.devDependencies ?? null,
    peerDependencies: pkg?.peerDependencies ?? null,
  };
}

async function listTopLevel(templatePath: string, ref: string) {
  const items = await fetchJson<GitHubContentItem[]>(ghContentsUrl(templatePath, ref));
  return {
    files: items.filter((i) => i.type === "file").map((i) => i.path),
    dirs: items.filter((i) => i.type === "dir").map((i) => i.path),
    items,
  };
}

async function readKeyFiles(items: GitHubContentItem[]) {
  const file = (name: string) => items.find((i) => i.type === "file" && i.name === name) as any;
  const nuxtItem = file("nuxt.config.ts");
  const pkgItem = file("package.json");
  const readmeItem = items.find((i) => i.type === "file" && i.name.toLowerCase() === "readme.md") as any;
  const unoItem = file("uno.config.ts");

  const nuxtConfig = nuxtItem?.download_url ? await fetchText(nuxtItem.download_url) : null;
  const pkg = pkgItem?.download_url ? JSON.parse(await fetchText(pkgItem.download_url)) : null;
  const readme = readmeItem?.download_url ? await fetchText(readmeItem.download_url) : null;
  const uno = unoItem?.download_url ? await fetchText(unoItem.download_url) : null;

  return {
    nuxtConfig,
    packageJson: pkg,
    readme,
    unoConfig: uno,
    fetchedFiles: {
      nuxtConfig: Boolean(nuxtConfig),
      packageJson: Boolean(pkg),
      readme: Boolean(readme),
      unoConfig: Boolean(uno),
    },
  };
}

export async function describeTemplate(template: "vue-starter-template" | "vue-starter-template-extended", ref: string = "main") {
  const templatePath = `templates/${template}`;
  const top = await listTopLevel(templatePath, ref);
  const key = await readKeyFiles(top.items);

  return {
    template,
    ref,
    structure: { files: top.files, dirs: top.dirs },
    packageJson: key.packageJson ? summarizePackageJson(key.packageJson) : null,
    nuxtConfigSummary: key.nuxtConfig ? parseNuxtConfigSummary(key.nuxtConfig) : null,
    // Keep excerpts short-ish
    readmeExcerpt: key.readme ? key.readme.slice(0, 2000) : null,
    unoConfigPresent: Boolean(key.unoConfig),
    fetchedFiles: key.fetchedFiles,
  };
}

function setDiff(a: string[], b: string[]) {
  const A = new Set(a);
  const B = new Set(b);
  return {
    onlyInA: a.filter((x) => !B.has(x)),
    onlyInB: b.filter((x) => !A.has(x)),
    inBoth: a.filter((x) => B.has(x)),
  };
}

export async function compareTemplates(ref: string = "main") {
  const base = await describeTemplate("vue-starter-template", ref);
  const ext = await describeTemplate("vue-starter-template-extended", ref);

  const baseDirs = base.structure.dirs ?? [];
  const extDirs = ext.structure.dirs ?? [];

  const baseFiles = base.structure.files ?? [];
  const extFiles = ext.structure.files ?? [];

  const modulesBase = base.nuxtConfigSummary?.modules ?? [];
  const modulesExt = ext.nuxtConfigSummary?.modules ?? [];

  const runtimeBase = base.nuxtConfigSummary?.runtimeConfigKeys ?? [];
  const runtimeExt = ext.nuxtConfigSummary?.runtimeConfigKeys ?? [];

  return {
    ref,
    base,
    extended: ext,
    diff: {
      dirs: setDiff(baseDirs, extDirs),
      files: setDiff(baseFiles, extFiles),
      nuxt: {
        extends: { base: base.nuxtConfigSummary?.extends ?? null, extended: ext.nuxtConfigSummary?.extends ?? null },
        modules: setDiff(modulesBase, modulesExt),
        runtimeConfigKeys: setDiff(runtimeBase, runtimeExt),
        flags: {
          base: {
            i18nPresent: base.nuxtConfigSummary?.i18nPresent ?? false,
            nitroPresent: base.nuxtConfigSummary?.nitroPresent ?? false,
            routeRulesPresent: base.nuxtConfigSummary?.routeRulesPresent ?? false,
          },
          extended: {
            i18nPresent: ext.nuxtConfigSummary?.i18nPresent ?? false,
            nitroPresent: ext.nuxtConfigSummary?.nitroPresent ?? false,
            routeRulesPresent: ext.nuxtConfigSummary?.routeRulesPresent ?? false,
          },
        },
      },
      uno: {
        baseUnoConfigPresent: base.unoConfigPresent,
        extendedUnoConfigPresent: ext.unoConfigPresent,
      },
    },
  };
}
