import { describe, expect, it, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { createRecording, updateRecording, getUserRecordings } from "./db";

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

describe("recording.create", () => {
  it("creates a new recording entry with tags and duration", async () => {
    const { ctx } = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.recording.create({
      duration: 120,
      tags: ["仕事", "学習"],
    });

    expect(result).toHaveProperty("recordingId");
    expect(result).toHaveProperty("uploadKey");
    expect(typeof result.recordingId).toBe("number");
    expect(result.uploadKey).toContain("recordings/");
  });

  it("creates a recording without optional fields", async () => {
    const { ctx } = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.recording.create({});

    expect(result).toHaveProperty("recordingId");
    expect(result).toHaveProperty("uploadKey");
  });
});

describe("recording.list", () => {
  it("returns empty array when user has no recordings", async () => {
    const { ctx } = createTestContext(999999); // User with no recordings
    const caller = appRouter.createCaller(ctx);

    const result = await caller.recording.list();

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it("returns user's recordings with parsed tags", async () => {
    const { ctx } = createTestContext();
    const caller = appRouter.createCaller(ctx);

    // Create a test recording
    await caller.recording.create({
      duration: 60,
      tags: ["健康", "趣味"],
    });

    const result = await caller.recording.list();

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    
    const firstRecording = result[0];
    expect(firstRecording).toHaveProperty("tags");
    expect(Array.isArray(firstRecording.tags)).toBe(true);
  });
});

describe("recording.get", () => {
  it("retrieves a specific recording by id", async () => {
    const { ctx } = createTestContext();
    const caller = appRouter.createCaller(ctx);

    // Create a recording first
    const created = await caller.recording.create({
      duration: 90,
      tags: ["プライベート"],
    });

    const result = await caller.recording.get({ id: created.recordingId });

    expect(result).toHaveProperty("id", created.recordingId);
    expect(result).toHaveProperty("userId", ctx.user!.id);
    expect(result).toHaveProperty("tags");
    expect(Array.isArray(result.tags)).toBe(true);
  });

  it("throws NOT_FOUND when recording doesn't exist", async () => {
    const { ctx } = createTestContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.recording.get({ id: 999999 })
    ).rejects.toThrow();
  });

  it("throws NOT_FOUND when accessing another user's recording", async () => {
    const { ctx: ctx1 } = createTestContext(1);
    const caller1 = appRouter.createCaller(ctx1);

    // Create recording as user 1
    const created = await caller1.recording.create({
      duration: 60,
      tags: ["仕事"],
    });

    // Try to access as user 2
    const { ctx: ctx2 } = createTestContext(2);
    const caller2 = appRouter.createCaller(ctx2);

    await expect(
      caller2.recording.get({ id: created.recordingId })
    ).rejects.toThrow();
  });
});

describe("Database helpers", () => {
  it("createRecording inserts a new recording", async () => {
    const recording = await createRecording({
      userId: 1,
      audioFileKey: "test/audio.webm",
      audioUrl: "https://example.com/audio.webm",
      duration: 120,
      status: "uploading",
      tags: JSON.stringify(["テスト"]),
    });

    expect(recording).toHaveProperty("id");
    expect(recording.userId).toBe(1);
    expect(recording.audioFileKey).toBe("test/audio.webm");
  });

  it("updateRecording modifies existing recording", async () => {
    const recording = await createRecording({
      userId: 1,
      audioFileKey: "test/audio2.webm",
      audioUrl: "https://example.com/audio2.webm",
      status: "uploading",
    });

    const updated = await updateRecording(recording.id, {
      status: "completed",
      transcribedText: "テスト音声",
    });

    expect(updated).toBeDefined();
    expect(updated?.status).toBe("completed");
    expect(updated?.transcribedText).toBe("テスト音声");
  });

  it("getUserRecordings returns recordings ordered by date", async () => {
    const userId = 1;

    // Create multiple recordings
    await createRecording({
      userId,
      audioFileKey: "test/audio3.webm",
      audioUrl: "https://example.com/audio3.webm",
      status: "completed",
    });

    await createRecording({
      userId,
      audioFileKey: "test/audio4.webm",
      audioUrl: "https://example.com/audio4.webm",
      status: "completed",
    });

    const recordings = await getUserRecordings(userId);

    expect(recordings.length).toBeGreaterThan(0);
    
    // Verify they're ordered by creation date (newest first)
    if (recordings.length > 1) {
      const first = new Date(recordings[0].createdAt).getTime();
      const second = new Date(recordings[1].createdAt).getTime();
      expect(first).toBeGreaterThanOrEqual(second);
    }
  });
});

describe('JST date formatting', () => {
  it('should format Date as JST date string (YYYY-MM-DD)', () => {
    // Test with a specific UTC date
    const utcDate = new Date('2026-01-23T03:00:00.000Z'); // UTC 2026-01-23 03:00 = JST 2026-01-23 12:00
    
    // Test the logic used in notion.ts
    const jstDateTimeStr = utcDate.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' });
    const jstDateStr = jstDateTimeStr.split(' ')[0];
    
    expect(jstDateStr).toBe('2026-01-23');
  });

  it('should handle date conversion across day boundaries', () => {
    // Test with a date that crosses day boundary when converted to JST
    const utcDate = new Date('2026-01-22T15:30:00.000Z'); // UTC 2026-01-22 15:30 = JST 2026-01-23 00:30
    
    const jstDateTimeStr = utcDate.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' });
    const jstDateStr = jstDateTimeStr.split(' ')[0];
    
    expect(jstDateStr).toBe('2026-01-23'); // Should be next day in JST
  });

  it('should create proper diary title from JST date', () => {
    const jstDate = '2026-01-23';
    const [year, month, day] = jstDate.split('-');
    const dateStr = `${year}/${parseInt(month)}/${parseInt(day)}`;
    const title = `日記 ${dateStr}`;
    
    expect(title).toBe('日記 2026/1/23');
  });
});
