/**
 * Shared data-layer helpers. These are the two things every repository module
 * used to copy-paste: "make sure Mongoose is connected" and "is this a unique
 * index violation". Both are observable without reaching into a caller.
 */
import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { isDuplicateKeyError } from "./mongodb";
import { startTestDatabase, stopTestDatabase } from "@/test/mongo";

describe("isDuplicateKeyError", () => {
  it("nhận ra lỗi trùng unique index của MongoDB driver", () => {
    expect(isDuplicateKeyError(Object.assign(new Error("E11000 duplicate key"), { code: 11000 }))).toBe(true);
    expect(isDuplicateKeyError({ code: 11000, keyValue: { slug: "python-co-ban" } })).toBe(true);
  });

  it("bỏ qua lỗi khác và giá trị không phải object", () => {
    expect(isDuplicateKeyError(new Error("mất mạng"))).toBe(false);
    expect(isDuplicateKeyError({ code: 121 })).toBe(false);
    expect(isDuplicateKeyError(null)).toBe(false);
    expect(isDuplicateKeyError("E11000")).toBe(false);
  });
});

describe("ensureConnection", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startTestDatabase("moodle_quiz_mongodb_helper_test");
  });
  afterAll(async () => {
    await stopTestDatabase(server);
  });

  it("không mở lại kết nối khi Mongoose đang kết nối", async () => {
    const { ensureConnection } = await import("./mongodb");
    expect(mongoose.connection.readyState).toBe(1);

    await ensureConnection();

    expect(mongoose.connection.readyState).toBe(1);
    expect(mongoose.connection.name).toBe("moodle_quiz_mongodb_helper_test");
  });
});
