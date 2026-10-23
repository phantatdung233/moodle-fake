import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

/**
 * Starts an in-memory MongoDB for a test file and connects Mongoose to it.
 * Each test file can pass its own database name so unique indexes do not leak
 * between files. `mongodb-memory-server` downloads a `mongod` binary on first
 * use, then caches it in node_modules/.cache.
 */
export async function startTestDatabase(
  databaseName = "moodle_quiz_test",
): Promise<MongoMemoryServer> {
  const server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri(databaseName));
  return server;
}

export async function stopTestDatabase(server: MongoMemoryServer): Promise<void> {
  await mongoose.disconnect();
  await server.stop();
}

/** Empties every collection between tests. */
export async function clearTestDatabase(): Promise<void> {
  const collections = await mongoose.connection.db?.collections();
  await Promise.all(collections?.map((collection) => collection.deleteMany({})) ?? []);
}
