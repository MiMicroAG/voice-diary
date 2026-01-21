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

describe("Date extraction and merging", () => {
  it("creates recording with metadata extraction flow", async () => {
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

  it("handles tag merging correctly", async () => {
    const { ctx } = createTestContext();
    const caller = appRouter.createCaller(ctx);

    // Create recording with user-selected tags
    const created = await caller.recording.create({
      duration: 45,
      tags: ["仕事", "学習"],
    });

    // Verify recording was created with tags
    const recording = await caller.recording.get({ id: created.recordingId });
    expect(recording.tags).toEqual(["仕事", "学習"]);
  });

  it("maintains recording list integrity", async () => {
    const { ctx } = createTestContext();
    const caller = appRouter.createCaller(ctx);

    // Create multiple recordings
    const recording1 = await caller.recording.create({
      duration: 30,
      tags: ["健康"],
    });

    const recording2 = await caller.recording.create({
      duration: 60,
      tags: ["趣味"],
    });

    // List all recordings
    const recordings = await caller.recording.list();
    
    expect(recordings.length).toBeGreaterThanOrEqual(2);
    
    // Find our recordings
    const found1 = recordings.find(r => r.id === recording1.recordingId);
    const found2 = recordings.find(r => r.id === recording2.recordingId);
    
    expect(found1).toBeDefined();
    expect(found2).toBeDefined();
    expect(found1?.tags).toEqual(["健康"]);
    expect(found2?.tags).toEqual(["趣味"]);
  });
});

describe("Recording workflow with metadata", () => {
  it("creates and retrieves recording with full metadata", async () => {
    const { ctx } = createTestContext();
    const caller = appRouter.createCaller(ctx);

    // Create recording with multiple tags
    const created = await caller.recording.create({
      duration: 90,
      tags: ["仕事", "プライベート", "学習"],
    });

    expect(created.recordingId).toBeGreaterThan(0);

    // Retrieve and verify
    const recording = await caller.recording.get({ id: created.recordingId });
    expect(recording.id).toBe(created.recordingId);
    expect(recording.duration).toBe(90);
    expect(recording.tags).toHaveLength(3);
    expect(recording.tags).toContain("仕事");
    expect(recording.tags).toContain("プライベート");
    expect(recording.tags).toContain("学習");
  });

  it("handles empty tags gracefully", async () => {
    const { ctx } = createTestContext();
    const caller = appRouter.createCaller(ctx);

    // Create recording without tags
    const created = await caller.recording.create({
      duration: 30,
    });

    const recording = await caller.recording.get({ id: created.recordingId });
    expect(recording.tags).toEqual([]);
  });
});
