import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { createRecording, updateRecording, getUserRecordings, getRecordingById } from "./db";
import { storagePut } from "./storage";
import { transcribeAudio } from "./_core/voiceTranscription";
import { TRPCError } from "@trpc/server";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  recording: router({
    /**
     * Create a new recording entry and get upload URL
     */
    create: protectedProcedure
      .input(z.object({
        duration: z.number().optional(),
        tags: z.array(z.string()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const recording = await createRecording({
          userId: ctx.user.id,
          audioFileKey: `recordings/${ctx.user.id}/${Date.now()}.webm`,
          audioUrl: "", // Will be updated after upload
          duration: input.duration,
          tags: input.tags ? JSON.stringify(input.tags) : null,
          status: "uploading",
        });

        return {
          recordingId: recording.id,
          uploadKey: recording.audioFileKey,
        };
      }),

    /**
     * Upload audio file to S3 and update recording
     */
    uploadAudio: protectedProcedure
      .input(z.object({
        recordingId: z.number(),
        audioData: z.string(), // base64 encoded audio data
        mimeType: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const recording = await getRecordingById(input.recordingId);
        if (!recording || recording.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Recording not found" });
        }

        // Convert base64 to buffer
        const audioBuffer = Buffer.from(input.audioData, 'base64');
        
        // Upload to S3
        const { url } = await storagePut(
          recording.audioFileKey,
          audioBuffer,
          input.mimeType
        );

        // Update recording with audio URL
        await updateRecording(input.recordingId, {
          audioUrl: url,
          status: "processing",
        });

        return { success: true, audioUrl: url };
      }),

    /**
     * Process audio: transcribe and save to Notion
     */
    process: protectedProcedure
      .input(z.object({
        recordingId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const recording = await getRecordingById(input.recordingId);
        if (!recording || recording.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Recording not found" });
        }

        if (!recording.audioUrl) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Audio not uploaded yet" });
        }

        try {
          // Transcribe audio using Whisper
          const transcription = await transcribeAudio({
            audioUrl: recording.audioUrl,
            language: "ja",
          });

          // Check if transcription failed
          if ('error' in transcription) {
            throw new Error(transcription.error);
          }

          const transcribedText = transcription.text;

          // Format text into bullet points using LLM
          const formattedText = await formatTextToBulletPoints(transcribedText);

          // Save to Notion
          const notionResult = await saveToNotion({
            title: `日記 ${new Date().toLocaleDateString('ja-JP')}`,
            content: formattedText,
            tags: recording.tags ? JSON.parse(recording.tags) : [],
            date: new Date(),
          });

          // Update recording with formatted transcription and Notion info
          await updateRecording(input.recordingId, {
            transcribedText: formattedText,
            notionPageId: notionResult.pageId,
            notionPageUrl: notionResult.pageUrl,
            status: "completed",
          });

          return {
            success: true,
            transcribedText: formattedText,
            notionPageUrl: notionResult.pageUrl,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          await updateRecording(input.recordingId, {
            status: "failed",
            errorMessage,
          });
          throw new TRPCError({ 
            code: "INTERNAL_SERVER_ERROR", 
            message: `Processing failed: ${errorMessage}` 
          });
        }
      }),

    /**
     * Get user's recordings list
     */
    list: protectedProcedure.query(async ({ ctx }) => {
      const recordings = await getUserRecordings(ctx.user.id);
      return recordings.map(r => ({
        ...r,
        tags: r.tags ? JSON.parse(r.tags) : [],
      }));
    }),

    /**
     * Get single recording details
     */
    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const recording = await getRecordingById(input.id);
        if (!recording || recording.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Recording not found" });
        }
        return {
          ...recording,
          tags: recording.tags ? JSON.parse(recording.tags) : [],
        };
      }),
  }),
});

/**
 * Format transcribed text into structured bullet points using LLM
 */
async function formatTextToBulletPoints(text: string): Promise<string> {
  const { invokeLLM } = await import('./_core/llm');
  
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: "あなたは日記の整理を手伝うアシスタントです。ユーザーが音声で入力した内容を、読みやすい箇条書き形式に整理してください。重要なポイントを抽出し、論理的な順序で並べてください。元の意味を変えずに、簡潔で分かりやすい箇条書きにしてください。"
      },
      {
        role: "user",
        content: `以下の音声入力テキストを箇条書き形式に整理してください：\n\n${text}`
      }
    ],
  });

  const content = response.choices[0]?.message?.content;
  return typeof content === 'string' ? content : text;
}

/**
 * Save diary entry to Notion database
 */
async function saveToNotion(params: {
  title: string;
  content: string;
  tags: string[];
  date: Date;
}): Promise<{ pageId: string; pageUrl: string }> {
  const { execSync } = await import('child_process');
  
  const notionInput = {
    parent: {
      data_source_id: "94518c78-84e5-4fb2-aea2-165124d31bf3"
    },
    pages: [{
      properties: {
        "タイトル": params.title,
        "本文": params.content,
        "タグ": JSON.stringify(params.tags),
        "date:日付:start": params.date.toISOString(),
        "date:日付:is_datetime": 1,
      }
    }]
  };

  const result = execSync(
    `manus-mcp-cli tool call notion-create-pages --server notion --input '${JSON.stringify(notionInput)}'`,
    { encoding: 'utf-8' }
  );

  // Parse the result to extract page ID and URL
  const urlMatch = result.match(/https:\/\/www\.notion\.so\/[a-f0-9]+/);
  const pageUrl = urlMatch ? urlMatch[0] : "";
  const pageId = pageUrl.split('/').pop() || "";

  return { pageId, pageUrl };
}

export type AppRouter = typeof appRouter;
