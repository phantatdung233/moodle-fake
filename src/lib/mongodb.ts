/**
 * Helpers shared by every repository module, so the connect guard and the
 * unique-index check live in one place instead of being copied per file.
 */
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db";

/**
 * Tests connect Mongoose to mongodb-memory-server themselves, so a live
 * connection is reused as-is; only a cold process reads MONGODB_URI.
 */
export async function ensureConnection(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;
  await connectToDatabase();
}

/**
 * True for MongoDB's duplicate-key error (code 11000). The unique index on
 * `Quiz.slug` — or the partial one on an open Attempt — is the source of truth,
 * so callers catch this instead of racing an existence check.
 */
export function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: number }).code === 11000;
}
