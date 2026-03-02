import { FastifyInstance } from "fastify"
import healthRoutes from "./modules/health/health.routes"
import labRoutes from "./modules/lab/lab.routes"

export default async function routes(app: FastifyInstance) {
  app.register(healthRoutes, { prefix: "/health" })
  app.register(labRoutes, { prefix: "/lab" })
}