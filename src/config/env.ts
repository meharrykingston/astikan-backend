export type AppEnv = {
  PORT: string;
};

export const envSchema = {
  type: "object",
  required: ["PORT"],
  properties: {
    PORT: { type: "string", default: "3000" },
  },
} as const;