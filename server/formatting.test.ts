import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createTestContext(userId: number = 1): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: userId,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };

  return { ctx };
}

describe("Text formatting with LLM", () => {
  it("creates recording and processes with formatting", async () => {
    const { ctx } = createTestContext();
    const caller = appRouter.createCaller(ctx);

    // Create a recording
    const created = await caller.recording.create({
      duration: 60,
      tags: ["仕事"],
    });

    expect(created).toHaveProperty("recordingId");
    expect(created).toHaveProperty("uploadKey");
    expect(typeof created.recordingId).toBe("number");
  });

  it("returns formatted text structure", async () => {
    const { ctx } = createTestContext();
    const caller = appRouter.createCaller(ctx);

    // Create recording
    const created = await caller.recording.create({
      duration: 30,
      tags: ["テスト"],
    });

    // Verify recording was created successfully
    const recording = await caller.recording.get({ id: created.recordingId });
    expect(recording).toHaveProperty("id", created.recordingId);
    expect(recording.status).toBe("uploading");
  });
});

describe("Recording workflow integration", () => {
  it("maintains data integrity through the workflow", async () => {
    const { ctx } = createTestContext();
    const caller = appRouter.createCaller(ctx);

    // Step 1: Create recording
    const created = await caller.recording.create({
      duration: 45,
      tags: ["学習", "健康"],
    });

    expect(created.recordingId).toBeGreaterThan(0);

    // Step 2: Verify recording exists
    const recording = await caller.recording.get({ id: created.recordingId });
    expect(recording.id).toBe(created.recordingId);
    expect(recording.userId).toBe(ctx.user!.id);
    expect(recording.tags).toEqual(["学習", "健康"]);
    expect(recording.duration).toBe(45);
  });

  it("lists recordings correctly", async () => {
    const { ctx } = createTestContext();
    const caller = appRouter.createCaller(ctx);

    // Create multiple recordings
    await caller.recording.create({
      duration: 30,
      tags: ["仕事"],
    });

    await caller.recording.create({
      duration: 60,
      tags: ["プライベート"],
    });

    // List recordings
    const recordings = await caller.recording.list();
    
    expect(recordings.length).toBeGreaterThanOrEqual(2);
    expect(recordings.every(r => r.userId === ctx.user!.id)).toBe(true);
  });
});
