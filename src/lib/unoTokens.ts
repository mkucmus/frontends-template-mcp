/**
 * Extract UnoCSS color token keys from an `uno.config.ts` source.
 * This does NOT execute code. It does a best-effort parse of the `colors: { ... }` block.
 */
export function extractUnoColorTokensFromSource(src: string): string[] {
  // Find the first occurrence of: colors: { ... }
  const m = src.match(/colors\s*:\s*\{([\s\S]*?)\}\s*,?/m);
  if (!m) return [];

  const block = m[1];

  // Extract keys like: primary: , "primary": , 'primary': , primary_color:
  const tokens = Array.from(block.matchAll(/["']?([a-zA-Z0-9_-]+)["']?\s*:/g), (mm) => mm[1]);

  return Array.from(new Set(tokens));
}

/**
 * Fetch `uno.config.ts` for the Shopware Frontends template `vue-starter-template-extended`
 * directly from GitHub at a given ref (branch/tag/sha).
 */
export async function fetchUnoConfigFromGitHub(ref: string = "main"): Promise<string> {
  const url = `https://raw.githubusercontent.com/shopware/frontends/${encodeURIComponent(ref)}/templates/vue-starter-template-extended/uno.config.ts`;
  const res = await fetch(url, { method: "GET" });

  if (!res.ok) {
    throw new Error(`Failed to fetch uno.config.ts from GitHub (status ${res.status})`);
  }

  return await res.text();
}
