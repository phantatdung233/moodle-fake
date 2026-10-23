import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

const SERVER_KEY = Symbol.for("moodleFakeTestMongoServer");

type TestGlobal = typeof globalThis & { [SERVER_KEY]?: MongoMemoryServer | null };

/**
 * Starts an in-memory MongoDB for a test file and connects Mongoose to it.
 * Each test file can pass its own database name so unique indexes do not leak
 * between files. `mongodb-memory-server` downloads a `mongod` binary on first
 * use, then caches it in node_modules/.cache.
 *
 * Vitest runs several test files one after another in one worker process, and
 * `mongoose.connect()` refuses a second URI on an open connection. Later files
 * therefore switch database on the same server, and `stopTestDatabase` keeps
 * that shared server running for the next file (`getUri(name)` re-points it).
 */
export async function startTestDatabase(
  databaseName = "moodle_quiz_test",
): Promise<MongoMemoryServer> {
  const shared = (globalThis as TestGlobal)[SERVER_KEY] ?? null;
  const server = shared ?? (await MongoMemoryServer.create());
  await connectToDatabase(server.getUri(databaseName));
  (globalThis as TestGlobal)[SERVER_KEY] = server;
  return server;
}

export async function stopTestDatabase(server: MongoMemoryServer): Promise<void> {
  await mongoose.disconnect();
  // Only the file that created the server stops it; a shared one outlives this
  // file because the next file's connection points at the same process.
  if ((globalThis as TestGlobal)[SERVER_KEY] === server && server.instanceInfo) {
    (globalThis as TestGlobal)[SERVER_KEY] = null;
    await server.stop();
  }
}

async function connectToDatabase(uri: string): Promise<void> {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  await mongoose.connect(uri);
  await reviveIndexBuilds();
}

/** Empties every collection between tests. */
export async function clearTestDatabase(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) return;
  const collections = await db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
  await reviveIndexBuilds();
}

/**
 * Mongoose builds a Model's indexes once per process: `Model.init()` caches its
 * promise, and an index build still running when a test file finishes can fail
 * against the database that file dropped. Every later `Model.create()` then
 * skips indexes entirely ("killed by Singularity"), and a unique index that
 * should have rejected a duplicate silently accepts it. Dropping that cache
 * makes the next `Model.init()` build the indexes on the connection in use.
 */
export async function reviveIndexBuilds(): Promise<void> {
  for (const model of Object.values(mongoose.models)) {
    delete (model as { $init?: unknown }).$init;
    delete (model as { $caught?: unknown }).$caught;
  }
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}
