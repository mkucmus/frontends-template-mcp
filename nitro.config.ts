import { defineNitroConfig } from "nitropack/config";

export default defineNitroConfig({
  preset: "vercel",
  compatibilityDate: "2024-12-30",
  routeRules: {
    "/mcp/**": { cors: true },
  },
});
