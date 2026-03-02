export const healthResponseSchema = {
  type: "object",
  properties: {
    status: { type: "string" },
  },
  required: ["status"],
} as const;