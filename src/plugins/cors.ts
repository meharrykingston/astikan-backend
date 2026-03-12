import type { FastifyPluginAsync } from "fastify";
import cors from "@fastify/cors";

const corsPlugin: FastifyPluginAsync = async (app) => {
  const rawOrigin = app.hasDecorator("config")
    ? app.config.CORS_ORIGIN
    : process.env.CORS_ORIGIN ?? "";
  const trimmed = rawOrigin.trim();
  const fallback = "*";
  const configuredOrigins = (trimmed || fallback).split(",").map((origin) => origin.trim()).filter(Boolean);
  const hasWildcard = configuredOrigins.some((origin) => origin === "*" || origin.includes("*"));
  const origin = hasWildcard ? true : configuredOrigins;

  await app.register(cors, {
    origin,
    credentials: true,
  });
};

export default corsPlugin;
