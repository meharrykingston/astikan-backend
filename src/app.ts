import Fastify from "fastify"
import cors from "@fastify/cors"
import routes from "./routes"

export function buildApp() {
  const app = Fastify({
    logger: true
  })

  app.register(cors, {
    origin: ["http://localhost:5173"], // Vite default
    credentials: true
  })

  app.register(routes, { prefix: "/api" })

  return app
}