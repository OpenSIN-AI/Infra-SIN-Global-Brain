/**
 * HTTP transport — fallback for clients that can't speak NATS (browsers,
 * curl, CI). Same handlers as the neural bus, just routed differently.
 */

import Fastify from "fastify";

export async function startHttpServer({ port, host, handlers }) {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ ok: true, ts: new Date().toISOString() }));

  app.get("/stats", async () => handlers.stats());

  app.post("/ask", async (req, reply) => {
    try {
      return { ok: true, result: await handlers.ask(req.body ?? {}) };
    } catch (err) {
      reply.code(400);
      return { ok: false, error: err.message };
    }
  });

  app.post("/attach", async (req, reply) => {
    try {
      return { ok: true, result: await handlers.attach(req.body ?? {}) };
    } catch (err) {
      reply.code(400);
      return { ok: false, error: err.message };
    }
  });

  app.get("/rules", async (req, reply) => {
    try {
      return { ok: true, result: await handlers.rules(req.query ?? {}) };
    } catch (err) {
      reply.code(400);
      return { ok: false, error: err.message };
    }
  });

  app.post("/ingest", async (req, reply) => {
    try {
      return { ok: true, result: await handlers.ingest(req.body ?? {}) };
    } catch (err) {
      reply.code(400);
      return { ok: false, error: err.message };
    }
  });

  app.post("/session/end", async (req, reply) => {
    try {
      return { ok: true, result: await handlers.sessionEnd(req.body ?? {}) };
    } catch (err) {
      reply.code(400);
      return { ok: false, error: err.message };
    }
  });

  app.post("/admin/tick", async (req, reply) => {
    try {
      return { ok: true, result: await handlers.adminTick() };
    } catch (err) {
      reply.code(400);
      return { ok: false, error: err.message };
    }
  });

  await app.listen({ port, host });
  return app;
}
