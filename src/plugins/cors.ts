import type { FastifyPluginAsync } from "fastify";
import cors from "@fastify/cors";

const corsPlugin: FastifyPluginAsync = async (app) => {
  await app.register(cors, {
    origin: "*",
    credentials: false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
};

export default corsPlugin;
