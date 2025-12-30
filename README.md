# Shopware Frontends MCP Server

This repository provides a **Model Context Protocol (MCP) server** for working with
the **Shopware Frontends** monorepo.

The server is designed for **AI agents** (ChatGPT, Claude, v0, etc.) to:
- inspect Shopware Frontends packages and templates,
- understand configuration and extension points,
- plan storefront creation,
- optionally scaffold and deploy new storefronts.

The MCP server is **read-only by default** (inspection & planning), with an optional
execution tool for creating repositories and deployments.

---

## What Shopware Frontends Is

- `/packages` – the actual building blocks of the ecosystem  
  (layers, composables, helpers, CMS base, storefront base, etc.).
- `/templates/vue-starter-template` – **reference implementation**  
  (canonical, minimal, production-ready baseline).
- `/templates/vue-starter-template-extended` – **example of extension & branding**  
  (how to build white-label or custom templates on top of the base).

This MCP server reflects that exact mental model.

---

## MCP Tools Overview

### describe_packages
Inspect all packages under `/packages` in `shopware/frontends`.

Returns:
- package list
- `package.json` summary (deps, peerDeps, exports)
- README excerpt (if available)

```json
{ "ref": "main" }
```

---

### describe_template
Describe a specific template under `/templates`.

Supported templates:
- `vue-starter-template`
- `vue-starter-template-extended`

Returns:
- directory structure
- `package.json` summary
- `nuxt.config.ts` summary (best-effort parsing)
- README excerpt
- presence of `uno.config.ts`

```json
{ "ref": "main", "template": "vue-starter-template" }
```

---

### compare_templates
Compare the **reference template** with the **extended template**.

Shows:
- structural differences (files / directories)
- Nuxt configuration differences (`extends`, modules, runtimeConfig keys)
- feature flags (i18n, nitro, routeRules)

```json
{ "ref": "main" }
```

---

### describe_uno_theme
Extract available UnoCSS color tokens from
`templates/vue-starter-template-extended/uno.config.ts`.

```json
{ "ref": "main" }
```

---

### describe_cms_base_layer
Fetch metadata for `@shopware/cms-base-layer` directly from the NPM registry.

Returns:
- latest version
- dependencies / peerDependencies
- repository & homepage
- publish timestamp

```json
{}
```

---

### plan_storefront
Generate an **execution plan** for creating a new storefront.
This tool has **no side effects**.

The plan includes:
- template & package context
- allowed UnoCSS color tokens
- CMS base layer metadata
- recommended execution steps
- a suggested `create_store_and_deploy` call

```json
{
  "ref": "main",
  "storeId": "example-store",
  "template": "vue-starter-template-extended",
  "git": { "owner": "your-org", "repo": "example-storefront", "private": true },
  "vercel": { "projectName": "example-storefront" },
  "brand": { "name": "Example", "colors": { "primary": "#543B95" } }
}
```

---

### create_store_and_deploy
(Optional / execution tool)

Scaffolds a new storefront repository and deploys it (e.g. to Vercel).
This tool **requires explicit authorization** and is intended for controlled use.

---

## Security Model

- Authorization via request headers (`MCP_AUTH_TOKEN`)
- Rate limiting
- GitHub owner allowlist
- Audit logging

The server is safe to expose **only when protected by tokens**.

---

## Deployment

The MCP server can be deployed to:
- Vercel
- Railway
- Fly.io
- any Node-compatible hosting

Required environment variables:
```bash
MCP_AUTH_TOKEN=...
MCP_ALLOWED_OWNERS=your-org
GITHUB_TOKEN=...
VERCEL_TOKEN=...
```

---

## Intended Usage

This server is designed to:
- prevent AI agents from guessing project structure,
- enforce architectural contracts,
- enable repeatable, white-label storefront creation,
- align with the philosophy described in `AGENTS.md` of Shopware Frontends.

---

## Status

This project is **pre-release**, but architecture-complete and safe to deploy
for private or internal use.
