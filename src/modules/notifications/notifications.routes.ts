import type { FastifyPluginAsync } from "fastify";
import { requireMongo } from "../core/data";
import crypto from "node:crypto";

const notificationsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (request) => {
    const { employeeId, limit } = request.query as { employeeId?: string; limit?: number };
    if (!employeeId) return { status: "error", message: "Missing employeeId" };
    const mongo = requireMongo(app);
    const col = mongo.collection("employee_notifications");
    const items = await col
      .find({ employeeId })
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit ?? 50) || 50, 200))
      .toArray();

    if (items.length === 0) {
      const seed = [
        { title: "Welcome to Astikan", body: "Your health dashboard is ready.", channel: "system" },
        { title: "Lab slots open", body: "Book a sample pickup in minutes.", channel: "health" },
        { title: "OPD pickup ready", body: "Schedule a ride to the clinic.", channel: "consult" },
      ];
      const now = new Date();
      const insert = seed.map((item, idx) => ({
        _id: crypto.randomUUID(),
        employeeId,
        title: item.title,
        body: item.body,
        channel: item.channel,
        unread: true,
        createdAt: new Date(now.getTime() - idx * 3600_000).toISOString(),
      }));
      await col.insertMany(insert as any[]);
      return { status: "ok", data: insert };
    }

    return { status: "ok", data: items };
  });

  app.get("/unread-count", async (request) => {
    const { employeeId } = request.query as { employeeId?: string };
    if (!employeeId) return { status: "error", message: "Missing employeeId" };
    const mongo = requireMongo(app);
    const col = mongo.collection("employee_notifications");
    const count = await col.countDocuments({ employeeId, unread: true });
    return { status: "ok", data: { count } };
  });

  app.post("/", async (request) => {
    const body = request.body as {
      employeeId?: string;
      title?: string;
      body?: string;
      channel?: string;
      cta?: { label: string; route: string } | null;
      meta?: Record<string, unknown>;
    };
    if (!body.employeeId || !body.title || !body.body) {
      return { status: "error", message: "Missing notification fields" };
    }
    const mongo = requireMongo(app);
    const col = mongo.collection("employee_notifications");
    const item = {
      _id: crypto.randomUUID(),
      employeeId: body.employeeId,
      title: body.title,
      body: body.body,
      channel: body.channel ?? "system",
      cta: body.cta ?? null,
      meta: body.meta ?? null,
      unread: true,
      createdAt: new Date().toISOString(),
    };
    await col.insertOne(item as any);
    return { status: "ok", data: item };
  });

  app.post("/mark-read", async (request) => {
    const body = request.body as { employeeId?: string; ids?: string[] };
    if (!body.employeeId) return { status: "error", message: "Missing employeeId" };
    const mongo = requireMongo(app);
    const col = mongo.collection("employee_notifications");
    if (body.ids && body.ids.length) {
      await col.updateMany({ employeeId: body.employeeId, _id: { $in: body.ids } }, { $set: { unread: false } });
    } else {
      await col.updateMany({ employeeId: body.employeeId }, { $set: { unread: false } });
    }
    return { status: "ok", data: { updated: true } };
  });
};

export default notificationsRoutes;
