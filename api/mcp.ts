/**
 * Vercel serverless entry point for the Brewman MCP server.
 *
 * Deploy this repo to Vercel; the MCP endpoint will be https://<your-app>.vercel.app/api/mcp
 * (add a rewrite in vercel.json to also serve it at /mcp). Set the env vars
 * BREWMAN_API_TOKEN and BREWMAN_TENANT_ID in the Vercel project settings.
 *
 * Note: this file is compiled by Vercel's own build (not by `npm run build`/tsc,
 * which only compiles src/). For non-Vercel hosting use `npm start` (src/index.ts).
 */
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createBrewmanServer } from "../src/server.js";

export const config = { runtime: "nodejs" };

export default async function handler(req: any, res: any): Promise<void> {
  if (req.method === "GET") {
    res.status(200).json({ ok: true, server: "brewman-mcp-server" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

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
}
