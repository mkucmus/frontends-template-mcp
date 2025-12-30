import { z } from "zod";
import { defineEventHandler, getHeader, setResponseHeader, setResponseStatus, send, type H3Event } from "h3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createStoreAndDeploy } from "../../src/tools/createStoreAndDeploy";
import { extractUnoColorTokensFromSource, fetchUnoConfigFromGitHub } from "../../src/lib/unoTokens";
import { describeBaseTemplate } from "../../src/lib/templateInspect";
import { compareTemplates, describeTemplate } from "../../src/lib/templateCompare";
import { describePackages } from "../../src/lib/packagesInspect";

/**
 * Security (MUST):
 * - Require an API key in headers (fail-closed)
 * - Rate limit (best-effort; serverless instances keep in-memory state)
 * - Allowlist GitHub repo owner(s)
 * - Audit logs (structured console logs visible in Vercel logs)
 *
 * ENV:
 *   MCP_AUTH_TOKEN=super-long-random-string                         (required)
 *   MCP_ALLOWED_OWNERS=twoj-org,another-org                          (required)
 *   MCP_RATE_LIMIT_MAX=3                                            (optional; default 3)
 *   MCP_RATE_LIMIT_WINDOW_SEC=3600                                  (optional; default 3600)
 *
 * Client headers:
 *   Authorization: Bearer <MCP_AUTH_TOKEN>
 *   (fallback) X-MCP-Key: <MCP_AUTH_TOKEN>
 */

interface HttpError extends Error {
  statusCode?: number;
  meta?: Record<string, unknown>;
}

function assertAuthorized(event: H3Event) {
  const expected = process.env.MCP_AUTH_TOKEN;
  if (!expected) {
    const err: HttpError = new Error("MCP_AUTH_TOKEN is not set on the server");
    err.statusCode = 500;
    throw err;
  }

  const authHeader = getHeader(event, "authorization");
  const xKey = getHeader(event, "x-mcp-key");

  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : undefined;
  const provided = bearer || xKey?.trim();

  if (!provided || provided !== expected) {
    const err: HttpError = new Error("Unauthorized");
    err.statusCode = 401;
    throw err;
  }

  return { authToken: provided };
}

type RateState = { windowStartMs: number; count: number };

// Best-effort in-memory rate limit (per auth token + client IP)
const RATE: Map<string, RateState> = new Map();

function assertRateLimited(event: H3Event, authToken: string) {
  const max = Number(process.env.MCP_RATE_LIMIT_MAX ?? "100");
  const windowSec = Number(process.env.MCP_RATE_LIMIT_WINDOW_SEC ?? "60");
  const windowMs = Math.max(1, windowSec) * 1000;

  const ip =
    getHeader(event, "x-forwarded-for")?.split(",")[0]?.trim() ||
    getHeader(event, "x-real-ip") ||
    "unknown";

  const key = `${authToken}::${ip}`;
  const now = Date.now();

  const state = RATE.get(key);
  if (!state || now - state.windowStartMs >= windowMs) {
    RATE.set(key, { windowStartMs: now, count: 1 });
    return { ip, remaining: Math.max(0, max - 1), resetInSec: windowSec };
  }

  if (state.count >= max) {
    const err: HttpError = new Error("Rate limit exceeded");
    err.statusCode = 429;
    err.meta = {
      limit: max,
      windowSec,
      retryAfterSec: Math.max(1, Math.ceil((state.windowStartMs + windowMs - now) / 1000)),
    };
    throw err;
  }

  state.count += 1;
  RATE.set(key, state);
  return { ip, remaining: Math.max(0, max - state.count), resetInSec: Math.max(1, Math.ceil((state.windowStartMs + windowMs - now) / 1000)) };
}

function assertOwnerAllowed(owner: string) {
  const raw = process.env.MCP_ALLOWED_OWNERS;
  if (!raw) {
    const err: HttpError = new Error("MCP_ALLOWED_OWNERS is not set on the server");
    err.statusCode = 500;
    throw err;
  }

  const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);

  if (!allowed.includes(owner)) {
    const err: HttpError = new Error(`Owner not allowed: ${owner}`);
    err.statusCode = 403;
    throw err;
  }
}

function auditLog(eventName: string, payload: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: eventName, ...payload }));
}

export default defineEventHandler(async (event) => {
  const requestId =
    getHeader(event, "x-request-id") ||
    getHeader(event, "x-vercel-id") ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  try {
    const { authToken } = assertAuthorized(event);
    const rate = assertRateLimited(event, authToken);

    auditLog("mcp.request.accepted", {
      requestId,
      ip: rate.ip,
      remaining: rate.remaining,
      resetInSec: rate.resetInSec,
      path: event.path,
      method: event.method,
    });
  } catch (e: unknown) {
    const err = e as HttpError;
    const status = err?.statusCode ?? 401;
    if (status === 429) {
      const retryAfter = (err?.meta?.retryAfterSec as number) ?? 60;
      setResponseHeader(event, "Retry-After", String(retryAfter));
    }
    auditLog("mcp.request.denied", {
      requestId,
      status,
      message: err?.message ?? "Unauthorized",
      meta: err?.meta,
    });
    setResponseStatus(event, status);
    return send(event, err?.message ?? "Unauthorized");
  }

  const server = new McpServer({
    name: "frontends-store-factory",
    version: "0.2.0",
  });

  const InputSchema = {
    storeId: z.string().min(2),
    templateRef: z.string().default("main"),
    brand: z.object({
      name: z.string().min(1),
      colors: z.record(z.string(), z.string()).default({}),
      logoSvg: z.string().optional(),
    }),
    git: z.object({
      owner: z.string().min(1),
      repo: z.string().min(1),
      private: z.boolean().default(true),
    }),
    vercel: z.object({
      projectName: z.string().min(1),
    }),
  };

  type InputType = {
    storeId: string;
    templateRef: string;
    brand: { name: string; colors: Record<string, string>; logoSvg?: string };
    git: { owner: string; repo: string; private: boolean };
    vercel: { projectName: string };
  };

  // --- Helper tool: expose available UnoCSS color tokens
  const DescribeUnoSchema = {
    ref: z.string().default("main"),
  };

  server.tool(
    "describe_uno_theme",
    "Return available UnoCSS color tokens from templates/vue-starter-template-extended/uno.config.ts (fetched from GitHub).",
    DescribeUnoSchema,
    async ({ ref }: { ref: string }) => {
      const src = await fetchUnoConfigFromGitHub(ref);
      const colorTokens = extractUnoColorTokensFromSource(src);
      return {
        content: [{ type: "text", text: JSON.stringify({ ref, colorTokens }, null, 2) }],
      };
    }
  );

  // --- Helper tool: inspect base template
  const DescribeBaseTemplateSchema = {
    ref: z.string().default("main"),
  };

  server.tool(
    "describe_base_template",
    "Inspect the base template `templates/vue-starter-template`: structure, package.json deps and a best-effort summary of nuxt.config.ts.",
    DescribeBaseTemplateSchema,
    async ({ ref }: { ref: string }) => {
      const info = await describeBaseTemplate(ref);
      return {
        content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
      };
    }
  );

  // --- Helper tool: inspect all monorepo packages
  const DescribePackagesSchema = {
    ref: z.string().default("main"),
  };

  server.tool(
    "describe_packages",
    "Inspect Shopware Frontends monorepo packages under `/packages`: list packages and summarize each package's package.json/README (fetched from GitHub).",
    DescribePackagesSchema,
    async ({ ref }: { ref: string }) => {
      const info = await describePackages(ref);
      return {
        content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
      };
    }
  );

  // --- Helper tool: describe a specific template
  const DescribeTemplateSchema = {
    ref: z.string().default("main"),
    template: z.enum(["vue-starter-template", "vue-starter-template-extended"]),
  };

  server.tool(
    "describe_template",
    "Describe a Shopware Frontends template under /templates: structure, package.json, nuxt.config.ts summary, README excerpt.",
    DescribeTemplateSchema,
    async ({ ref, template }: { ref: string; template: "vue-starter-template" | "vue-starter-template-extended" }) => {
      const info = await describeTemplate(template, ref);
      return {
        content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
      };
    }
  );

  // --- Helper tool: compare templates
  const CompareTemplatesSchema = {
    ref: z.string().default("main"),
  };

  server.tool(
    "compare_templates",
    "Compare templates/vue-starter-template vs templates/vue-starter-template-extended: structure and nuxt config differences (best-effort).",
    CompareTemplatesSchema,
    async ({ ref }: { ref: string }) => {
      const info = await compareTemplates(ref);
      return {
        content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
      };
    }
  );

  // --- Planner tool
  const PlanStorefrontSchema = {
    ref: z.string().default("main"),
    storeId: z.string().min(2),
    template: z.enum(["vue-starter-template", "vue-starter-template-extended"]).default("vue-starter-template-extended"),
    git: z.object({
      owner: z.string().min(1),
      repo: z.string().min(1),
      private: z.boolean().default(true),
    }),
    vercel: z.object({
      projectName: z.string().min(1),
    }),
    brand: z.object({
      name: z.string().min(1),
      colors: z.record(z.string(), z.string()).default({}),
      logoSvg: z.string().optional(),
    }).default({ name: "Brand", colors: {} }),
    i18n: z.object({
      locales: z.array(z.string()).default([]),
      domains: z.record(z.string(), z.string()).default({}),
    }).optional(),
  };

  type PlanStorefrontInput = {
    ref: string;
    storeId: string;
    template: "vue-starter-template" | "vue-starter-template-extended";
    git: { owner: string; repo: string; private: boolean };
    vercel: { projectName: string };
    brand: { name: string; colors: Record<string, string>; logoSvg?: string };
    i18n?: { locales: string[]; domains: Record<string, string> };
  };

  server.tool(
    "plan_storefront",
    "Return a plan for creating a storefront (repo per store) using Shopware Frontends templates and packages. No repo/deploy happens here.",
    PlanStorefrontSchema,
    async (input: PlanStorefrontInput) => {
      assertOwnerAllowed(input.git.owner);

      const [baseTemplate, packages, uno] = await Promise.all([
        describeBaseTemplate(input.ref),
        describePackages(input.ref),
        fetchUnoConfigFromGitHub(input.ref).then((src) => ({
          colorTokens: extractUnoColorTokensFromSource(src),
          unoConfigRef: input.ref,
        })),
      ]);

      const suggestedColorTokens = uno.colorTokens;

      const steps = [
        {
          id: "inspect",
          title: "Inspect templates and packages",
          details: [
            "Use describe_base_template to understand base structure and nuxt config defaults.",
            "Use describe_packages to see available packages (including Nuxt layers like cms-base-layer) and their package.json/README.",
            "Use describe_uno_theme to get allowed UnoCSS color tokens.",
          ],
        },
        {
          id: "prepare-branding",
          title: "Prepare branding inputs",
          details: [
            "Provide brand colors only using allowed UnoCSS tokens.",
            "Provide logoSvg (optional) that will be written to public/logo.svg.",
          ],
          allowedColorTokens: suggestedColorTokens,
        },
        {
          id: "execute",
          title: "Execute store creation + deploy",
          details: [
            "Call create_store_and_deploy with the prepared inputs.",
            "Server will scaffold project, push to GitHub and deploy to Vercel.",
          ],
          toolCall: {
            tool: "create_store_and_deploy",
            arguments: {
              storeId: input.storeId,
              templateRef: input.ref,
              brand: input.brand,
              git: input.git,
              vercel: input.vercel,
            },
          },
        },
        {
          id: "verify",
          title: "Verify outputs",
          details: [
            "Confirm repo exists and Vercel deployment is reachable.",
            "Run local install/build in generated repo if needed.",
          ],
        },
      ];

      const warnings: string[] = [];
      if (input.i18n && (input.i18n.locales.length === 0 || Object.keys(input.i18n.domains).length === 0)) {
        warnings.push("i18n provided but locales/domains are empty; multi-domain config is not implemented in this MVP.");
      }
      if (!suggestedColorTokens.length) {
        warnings.push("Could not extract UnoCSS color tokens from template; check GitHub fetch/ref or parsing logic.");
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ok: true,
            ref: input.ref,
            storeId: input.storeId,
            template: input.template,
            baseTemplateSummary: {
              capabilities: baseTemplate.capabilities,
              nuxtConfigSummary: baseTemplate.nuxtConfigSummary,
            },
            packagesSummary: {
              packageCount: packages.packageCount,
              packageNames: packages.packages.map((p: { packageJson?: { name?: string }; dirName: string }) => p.packageJson?.name || p.dirName).slice(0, 200),
            },
            unoTheme: uno,
            steps,
            warnings,
          }, null, 2),
        }],
      };
    }
  );

  // --- Main tool: create store and deploy
  server.tool(
    "create_store_and_deploy",
    "Generate a new store from shopware/frontends vue-starter-template-extended, apply branding (colors+logo), push to GitHub and deploy on Vercel.",
    InputSchema,
    async (input: InputType) => {
      assertOwnerAllowed(input.git.owner);

      auditLog("mcp.tool.start", {
        requestId,
        tool: "create_store_and_deploy",
        storeId: input.storeId,
        owner: input.git.owner,
        repo: input.git.repo,
        projectName: input.vercel.projectName,
        templateRef: input.templateRef,
      });

      try {
        const result = await createStoreAndDeploy(input);

        auditLog("mcp.tool.success", {
          requestId,
          tool: "create_store_and_deploy",
          storeId: input.storeId,
          owner: input.git.owner,
          repo: input.git.repo,
        });

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: unknown) {
        const err = e as Error;
        auditLog("mcp.tool.error", {
          requestId,
          tool: "create_store_and_deploy",
          storeId: input.storeId,
          owner: input.git.owner,
          repo: input.git.repo,
          error: err?.message ?? String(err),
        });
        throw err;
      }
    }
  );

  // Create transport for this request (stateless mode for serverless)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  // Connect server to transport
  await server.connect(transport);

  // Handle the HTTP request using raw Node.js objects
  await transport.handleRequest(event.node.req, event.node.res);
});
