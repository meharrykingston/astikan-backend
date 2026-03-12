import type { FastifyPluginAsync } from "fastify";
import { requireMongo } from "../core/data";

const logsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (request) => {
    const query = request.query as {
      service?: string;
      module?: string;
      severity?: string;
      search?: string;
      limit?: number;
    };

    const mongo = requireMongo(app);
    const limit = Math.min(Number(query.limit ?? 100) || 100, 500);
    const filter: Record<string, unknown> = {};

    if (query.service) filter.service = query.service;
    if (query.module) filter.module = query.module;
    if (query.severity) filter.severity = query.severity;
    if (query.search?.trim()) {
      filter.$or = [
        { message: { $regex: query.search.trim(), $options: "i" } },
        { stack: { $regex: query.search.trim(), $options: "i" } },
      ];
    }

    const rows = await mongo
      .collection("system_error_logs")
      .find(filter)
      .sort({ eventAt: -1 })
      .limit(limit)
      .toArray();

    return { status: "ok", data: rows };
  });

  app.post("/", async (request) => {
    const body = request.body as {
      service: string;
      module: string;
      severity: "info" | "warning" | "error" | "critical";
      message: string;
      stack?: string;
      context?: Record<string, unknown>;
    };

    const mongo = requireMongo(app);
    const now = new Date().toISOString();
    const inserted = await mongo.collection("system_error_logs").insertOne({
      service: body.service,
      module: body.module,
      severity: body.severity,
      message: body.message,
      stack: body.stack ?? null,
      context: body.context ?? {},
      eventAt: now,
      schemaVersion: 1,
    });

    return { status: "ok", data: { logId: inserted.insertedId.toString() } };
  });
};

export default logsRoutes;
