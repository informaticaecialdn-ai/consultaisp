/**
 * Spec 008.5 Batch 3 — Rotas MCP Express.
 *
 * Monta:
 *   POST /mcp/erp   — handler MCP Streamable HTTP (todas as requests
 *                     JSON-RPC: initialize, tools/list, tools/call, ...)
 *   GET /mcp/erp/health — health check público (sem auth)
 *
 * Auth + rate limit aplicados apenas no POST /mcp/erp. Health é público
 * pra Anthropic Platform verificar conectividade sem credencial.
 */

import express, { type Router, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireMcpAuth } from "../mcp/auth-middleware";
import { rateLimitByProvider } from "../mcp/rate-limit";
import { createMcpErpServer } from "../mcp/erp-server";
import { logger } from "../logger";

export function registerMcpErpRoutes(): Router {
  const router = express.Router();

  // Health endpoint — sem auth, sem rate limit
  router.get("/mcp/erp/health", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: "provedor-ai-mcp-erp",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    });
  });

  // Streamable HTTP requires raw body for MCP protocol — usar express.json()
  // local em vez de global pra garantir parsing correto.
  const jsonParser = express.json({ limit: "1mb" });

  router.post(
    "/mcp/erp",
    jsonParser,
    requireMcpAuth,
    rateLimitByProvider({ limit: 300 }),
    async (req: Request, res: Response) => {
      const ctx = req.mcpAuth;
      if (!ctx) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Missing mcpAuth context" },
        });
        return;
      }

      try {
        // Stateless mode — sessão por request
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        const server = createMcpErpServer(ctx);

        // Cleanup quando request fecha
        res.on("close", () => {
          void transport.close().catch(() => {});
          void server.close().catch(() => {});
        });

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (err) {
        logger.error(
          { err, providerId: ctx.providerId, tokenPrefix: ctx.tokenPrefix },
          "[mcp.routes] error handling MCP request",
        );
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
          });
        }
      }
    },
  );

  return router;
}
