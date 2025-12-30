import { defineEventHandler } from "h3";

export default defineEventHandler(() => {
  return {
    name: "Frontends MCP Server",
    version: "0.2.0",
    description: "MCP server for Shopware Frontends template customization",
    endpoint: "/mcp",
    documentation: "Use MCP client to connect to /mcp endpoint with Authorization header",
  };
});
