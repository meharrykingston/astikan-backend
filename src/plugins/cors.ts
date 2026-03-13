import type { FastifyPluginAsync } from "fastify";
import cors from "@fastify/cors";

const corsPlugin: FastifyPluginAsync = async (app) => {
  const rawOrigin = app.hasDecorator("config")
    ? app.config.CORS_ORIGIN
    : process.env.CORS_ORIGIN ?? "";
  const configuredOrigins = rawOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const allowPatterns = [/\.vercel\.app$/];
  const allowList = new Set([
    "http://localhost:5173",
    "http://localhost:5174",
    ...configuredOrigins,
  ]);

  await app.register(cors, {
    credentials: false,
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowList.has("*")) return cb(null, true);
      if (allowList.has(origin)) return cb(null, true);
      if (allowPatterns.some((pattern) => pattern.test(origin))) return cb(null, true);
      return cb(null, false);
    },
  });
};

export default corsPlugin;
