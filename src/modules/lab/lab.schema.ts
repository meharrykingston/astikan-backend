export const labCreateSchema = {
  body: {
    type: "object",
    properties: {
      name: { type: "string" },
    },
    required: ["name"],
  },
} as const;