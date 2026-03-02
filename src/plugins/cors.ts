import type { FastifyPluginAsync } from "fastify";
import cors from "@fastify/cors";

const corsPlugin: FastifyPluginAsync = async (app) => {
  await app.register(cors, {
    origin: true,
  });
};

export default corsPlugin;