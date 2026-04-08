import fastifyEnv from "@fastify/env";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

export type AppEnv = {
  PORT: number;
  CORS_ORIGIN: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPERADMIN_SEED_USERNAME: string;
  SUPERADMIN_SEED_PASSWORD: string;
  SUPERADMIN_SEED_EMAIL: string;
  MONGODB_URI: string;
  MONGODB_DB_NAME: string;
  REDIS_URL: string;
  REDIS_TTL_SECONDS: number;
  OPENAQ_API_KEY: string;
  NIRAMAYA_PROD_URL: string;
  NIRAMAYA_PINCODE_URL: string;
  NIRAMAYA_AUTH: string;
  NIRAMAYA_ALLOW_INSECURE_TLS: boolean;
  GROK_API_KEY: string;
  GROK_BASE_URL: string;
  GROK_MODEL: string;
  TURN_URLS: string;
  TURN_USERNAME: string;
  TURN_CREDENTIAL: string;
  MAPBOX_TOKEN: string;
  PUBLIC_BASE_URL: string;
};

const envSchema = {
  type: "object",
  required: ["PORT", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
  properties: {
    PORT: { type: "number", default: 4000 },
    CORS_ORIGIN: { type: "string", default: "*" },
    SUPABASE_URL: { type: "string", default: "" },
    SUPABASE_SERVICE_ROLE_KEY: { type: "string", default: "" },
    SUPERADMIN_SEED_USERNAME: { type: "string", default: "superadmin" },
    SUPERADMIN_SEED_PASSWORD: { type: "string", default: "Astikan@2026" },
    SUPERADMIN_SEED_EMAIL: { type: "string", default: "astikanworld@gmail.com" },
    MONGODB_URI: { type: "string", default: "" },
    MONGODB_DB_NAME: { type: "string", default: "astikan" },
    REDIS_URL: { type: "string", default: "" },
    REDIS_TTL_SECONDS: { type: "number", default: 600 },
    OPENAQ_API_KEY: { type: "string", default: "" },
    NIRAMAYA_PROD_URL: {
      type: "string",
      default: "https://www.niramayahealthcare.com/api",
    },
    NIRAMAYA_PINCODE_URL: {
      type: "string",
      default: "https://www.niramayahealthcare.com/api",
    },
    NIRAMAYA_AUTH: { type: "string", minLength: 1 },
    NIRAMAYA_ALLOW_INSECURE_TLS: { type: "boolean", default: false },
    GROK_API_KEY: { type: "string", default: "" },
    GROK_BASE_URL: { type: "string", default: "https://api.x.ai/v1" },
    GROK_MODEL: { type: "string", default: "grok-4-1-fast-reasoning" },
    TURN_URLS: { type: "string", default: "" },
    TURN_USERNAME: { type: "string", default: "" },
    TURN_CREDENTIAL: { type: "string", default: "" },
    MAPBOX_TOKEN: { type: "string", default: "" },
    PUBLIC_BASE_URL: { type: "string", default: "" },
  },
  additionalProperties: true,
} as const;

const envPlugin: FastifyPluginAsync = async (app) => {
  await app.register(fastifyEnv, {
    confKey: "config",
    schema: envSchema,
    dotenv: true,
    data: process.env,
  });
};

export default fp(envPlugin);
