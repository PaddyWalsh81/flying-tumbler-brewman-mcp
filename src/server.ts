import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools.js";

/** Build a fully-configured Brewman MCP server instance. */
export function createBrewmanServer(): McpServer {
  const server = new McpServer({
    name: "brewman-mcp-server",
    version: "1.0.0",
  });
  registerTools(server);
  return server;
}
