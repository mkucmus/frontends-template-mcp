/**
 * Branding application logic
 * Modifies uno.config.ts colors and logo.svg in template files
 */

import type { TemplateFile } from "./template";

export interface BrandingOptions {
  colors: Record<string, string>;
  logoSvg?: string;
}

export interface ApplyBrandingResult {
  modifiedFiles: string[];
  warnings: string[];
}

/**
 * Apply branding to template files in-memory
 * Modifies uno.config.ts to update theme colors and adds/replaces logo.svg
 */
export function applyBranding(
  files: TemplateFile[],
  branding: BrandingOptions
): ApplyBrandingResult {
  const modifiedFiles: string[] = [];
  const warnings: string[] = [];

  // Apply color branding to uno.config.ts
  if (Object.keys(branding.colors).length > 0) {
    const unoConfigIndex = files.findIndex(
      (f) => f.path === "uno.config.ts" || f.path.endsWith("/uno.config.ts")
    );

    if (unoConfigIndex !== -1) {
      const unoFile = files[unoConfigIndex];
      const updatedContent = updateUnoColors(unoFile.content, branding.colors);

      if (updatedContent !== unoFile.content) {
        files[unoConfigIndex] = {
          ...unoFile,
          content: updatedContent,
        };
        modifiedFiles.push(unoFile.path);
      } else {
        warnings.push("uno.config.ts found but no colors were updated - check color token names");
      }
    } else {
      warnings.push("uno.config.ts not found in template - colors not applied");
    }
  }

  // Apply logo branding
  if (branding.logoSvg) {
    const logoPath = "public/logo.svg";
    const logoIndex = files.findIndex(
      (f) => f.path === logoPath || f.path === "logo.svg"
    );

    if (logoIndex !== -1) {
      // Replace existing logo
      files[logoIndex] = {
        path: files[logoIndex].path,
        content: branding.logoSvg,
        encoding: "utf-8",
      };
      modifiedFiles.push(files[logoIndex].path);
    } else {
      // Add new logo file
      files.push({
        path: logoPath,
        content: branding.logoSvg,
        encoding: "utf-8",
      });
      modifiedFiles.push(logoPath);
    }
  }

  return { modifiedFiles, warnings };
}

/**
 * Update color values in uno.config.ts content
 * Replaces color token values while preserving structure
 */
function updateUnoColors(
  content: string,
  colors: Record<string, string>
): string {
  let updatedContent = content;

  // Match the colors object in the theme configuration
  // Pattern: colors: { ... }
  const colorsBlockMatch = content.match(/colors\s*:\s*\{([\s\S]*?)\}\s*,?\s*(?=\w+\s*:|$|\})/m);

  if (!colorsBlockMatch) {
    return content;
  }

  let colorsBlock = colorsBlockMatch[1];

  for (const [token, value] of Object.entries(colors)) {
    // Match patterns like: primary: "#543B95" or primary: '#543B95' or primary: "var(--color)"
    // Also handle nested objects like: primary: { DEFAULT: "#543B95", ... }

    // First try simple value replacement
    const simplePattern = new RegExp(
      `(${escapeRegex(token)}\\s*:\\s*)(['"])([^'"]+)\\2`,
      "g"
    );

    if (simplePattern.test(colorsBlock)) {
      colorsBlock = colorsBlock.replace(simplePattern, `$1"${value}"`);
    } else {
      // Try DEFAULT value in nested object
      const nestedPattern = new RegExp(
        `(${escapeRegex(token)}\\s*:\\s*\\{[^}]*DEFAULT\\s*:\\s*)(['"])([^'"]+)\\2`,
        "g"
      );
      colorsBlock = colorsBlock.replace(nestedPattern, `$1"${value}"`);
    }
  }

  // Replace the colors block in the original content
  updatedContent = content.replace(
    /colors\s*:\s*\{([\s\S]*?)\}\s*,?\s*(?=\w+\s*:|$|\})/m,
    `colors: {${colorsBlock}},`
  );

  return updatedContent;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
