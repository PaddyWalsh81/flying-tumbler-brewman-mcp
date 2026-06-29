#!/usr/bin/env node
/**
 * Brewman MCP server entry point.
 *
 * TRANSPORT=http  -> Streamable HTTP (Express) on /mcp  [remote hosting, default for servers]
 * TRANSPORT=stdio -> stdio                              [local clients]
 *
 * Required env: BREWMAN_API_TOKEN, BREWMAN_TENANT_ID
 * Optional env: BREWMAN_BASE_URL, BREWMAN_TENANT_FIELD, PORT, TRANSPORT
 */
import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBrewmanServer } from "./server.js";

function checkEnv(): void {
  if (!process.env.BREWMAN_API_TOKEN) {
    console.error("ERROR: BREWMAN_API_TOKEN environment variable is required.");
    process.exit(1);
  }
  if (!process.env.BREWMAN_TENANT_ID) {
    console.error(
      "WARNING: BREWMAN_TENANT_ID is not set. Most Brewman methods need a tenant id; calls may fail until it is configured."
    );
  }
}

async function runStdio(): Promise<void> {
  checkEnv();
  const server = createBrewmanServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("brewman-mcp-server running via stdio");
}

async function runHttp(): Promise<void> {
  checkEnv();
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true, server: "brewman-mcp-server" });
  });

  // Stateless: a fresh server + transport per request avoids request-id collisions.
  app.post("/mcp", async (req: Request, res: Response) => {
    const server = createBrewmanServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT || "3000", 10);
  app.listen(port, () => {
    console.error(`brewman-mcp-server listening on http://localhost:${port}/mcp`);
  });
}

const transport = process.env.TRANSPORT || "http";
const main = transport === "stdio" ? runStdio : runHttp;
main().catch((error) => {
  console.error("Fatal server error:", error);
  process.exit(1);
});
