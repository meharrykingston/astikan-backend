import type { FastifyPluginAsync } from "fastify";

import { labCreateSchema } from "./lab.schema";
import { createLab } from "./lab.service";

const labRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/labs",
    {
      schema: labCreateSchema,
    },
    async (request) => {
      const body = request.body as { name: string };
      return createLab(body.name);
    }
  );
};

export default labRoutes;