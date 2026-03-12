import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { requireMongoBucket } from "./data";

export async function uploadBase64ToGridFs(
  app: FastifyInstance,
  input: {
    fileName: string;
    mimeType: string;
    fileBase64: string;
    metadata?: Record<string, unknown>;
  }
) {
  const bucket = requireMongoBucket(app);
  const base64 = input.fileBase64.includes(",")
    ? input.fileBase64.split(",").pop() ?? ""
    : input.fileBase64;
  const buffer = Buffer.from(base64, "base64");

  const uploadStream = bucket.openUploadStream(input.fileName, {
    metadata: {
      ...(input.metadata ?? {}),
      mimeType: input.mimeType,
    },
  });

  await new Promise<void>((resolve, reject) => {
    Readable.from(buffer)
      .pipe(uploadStream)
      .on("error", reject)
      .on("finish", () => resolve());
  });

  const fileId = uploadStream.id instanceof ObjectId ? uploadStream.id.toHexString() : String(uploadStream.id);
  return {
    fileId,
    sizeBytes: buffer.byteLength,
  };
}
