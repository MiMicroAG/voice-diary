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

          // Extract metadata (date and tags) from transcribed text
          const metadata = await extractMetadata(transcribedText);
          
          // Merge user-selected tags with AI-extracted tags
          const userTags = recording.tags ? JSON.parse(recording.tags) : [];
          const combinedTags = [...userTags, ...metadata.tags];
          const allTags = Array.from(new Set(combinedTags));

          // Format text into bullet points using LLM
          const formattedText = await formatTextToBulletPoints(transcribedText);

          // Check if there's an existing diary entry for this date
          const existingEntry = await findExistingDiaryByDate(metadata.date);
          
          let notionResult: { pageId: string; pageUrl: string };
          
          if (existingEntry) {
            // Merge with existing entry
            notionResult = await mergeWithExistingDiary({
              existingPageId: existingEntry.pageId,
              existingContent: existingEntry.content,
              newContent: formattedText,
              tags: allTags,
              date: metadata.date,
            });
          } else {
            // Create new entry
            notionResult = await saveToNotion({
              title: `日記 ${metadata.date.toLocaleDateString('ja-JP')}`,
              content: formattedText,
              tags: allTags,
              date: metadata.date,
            });
          }

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
 * Find existing diary entry by date in Notion
 */
async function findExistingDiaryByDate(date: Date): Promise<{ pageId: string; content: string; pageUrl: string } | null> {
  const { execSync } = await import('child_process');
  
  // Validate date
  if (!date || isNaN(date.getTime())) {
    console.error("Invalid date provided to findExistingDiaryByDate");
    return null;
  }
  
  const dateStr = date.toLocaleDateString('ja-JP');
  const searchQuery = `日記 ${dateStr}`;
  
  try {
    const searchInput = {
      query: searchQuery,
      query_type: "internal",
      data_source_url: "collection://94518c78-84e5-4fb2-aea2-165124d31bf3",
    };

    const result = execSync(
      `manus-mcp-cli tool call search --server notion --input '${JSON.stringify(searchInput)}'`,
      { encoding: 'utf-8' }
    );

    // Parse search results
    const resultMatch = result.match(/Tool execution result:\s*({[\s\S]*})/);
    if (!resultMatch) return null;
    
    const searchResults = JSON.parse(resultMatch[1]);
    if (!searchResults.results || searchResults.results.length === 0) return null;

    // Find exact date match
    const exactMatch = searchResults.results.find((r: any) => 
      r.title && r.title.includes(dateStr)
    );

    if (!exactMatch) return null;

    // Fetch the full page content
    const fetchInput = { id: exactMatch.id };
    const fetchResult = execSync(
      `manus-mcp-cli tool call fetch --server notion --input '${JSON.stringify(fetchInput)}'`,
      { encoding: 'utf-8' }
    );

    const fetchMatch = fetchResult.match(/Tool execution result:\s*({[\s\S]*})/);
    if (!fetchMatch) return null;

    const pageData = JSON.parse(fetchMatch[1]);
    
    return {
      pageId: exactMatch.id,
      content: pageData.text || "",
      pageUrl: exactMatch.url,
    };
  } catch (error) {
    console.error("Error finding existing diary:", error);
    return null;
  }
}

/**
 * Merge new content with existing diary entry
 */
async function mergeWithExistingDiary(params: {
  existingPageId: string;
  existingContent: string;
  newContent: string;
  tags: string[];
  date: Date;
}): Promise<{ pageId: string; pageUrl: string }> {
  const { execSync } = await import('child_process');
  
  // Use LLM to merge contents intelligently
  const { invokeLLM } = await import('./_core/llm');
  
  const mergeResponse = await invokeLLM({
    messages: [
      {
        role: "system",
        content: "あなたは日記の統合を手伝うアシスタントです。既存の日記と新しい内容を自然に統合してください。重複する内容は統合し、異なる内容は両方を保持してください。"
      },
      {
        role: "user",
        content: `以下の2つの日記内容を統合してください：\n\n既存の内容：\n${params.existingContent}\n\n新しい内容：\n${params.newContent}`
      }
    ],
  });

  const mergedContent = typeof mergeResponse.choices[0]?.message?.content === 'string' 
    ? mergeResponse.choices[0].message.content 
    : `${params.existingContent}\n\n${params.newContent}`;

  // Update the existing Notion page
  const updateInput = {
    page_id: params.existingPageId,
    command: "update_properties",
    properties: {
      "本文": mergedContent,
      "タグ": JSON.stringify(params.tags),
    }
  };

  const result = execSync(
    `manus-mcp-cli tool call notion-update-page --server notion --input '${JSON.stringify(updateInput).replace(/'/g, "'\\''")}' 2>&1`,
    { encoding: 'utf-8' }
  );

  // Extract page URL from result
  const urlMatch = result.match(/https:\/\/www\.notion\.so\/[a-f0-9]+/);
  const pageUrl = urlMatch ? urlMatch[0] : "";

  return { pageId: params.existingPageId, pageUrl };
}

/**
 * Extract date and tags from transcribed text using LLM
 */
async function extractMetadata(text: string): Promise<{
  date: Date;
  tags: string[];
}> {
  const { invokeLLM } = await import('./_core/llm');
  
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: "あなたは日記のメタデータを抽出するアシスタントです。テキストから日付とタグを抽出してJSON形式で返してください。"
      },
      {
        role: "user",
        content: `以下のテキストから日付とタグを抽出してください。

テキスト: ${text}

以下のルールに従ってください：
1. 日付が明示的に言及されている場合はその日付を使用し、ない場合は今日の日付を使用
2. タグは内容から推測し、["仕事", "プライベート", "健康", "学習", "趣味"]の中から選択
3. 複数のタグが当てはまる場合はすべて含める

JSON形式で返してください：
{
  "date": "YYYY-MM-DD",
  "tags": ["tag1", "tag2"]
}`
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "diary_metadata",
        strict: true,
        schema: {
          type: "object",
          properties: {
            date: { type: "string", description: "Date in YYYY-MM-DD format" },
            tags: { 
              type: "array", 
              items: { type: "string" },
              description: "Array of tags"
            },
          },
          required: ["date", "tags"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  let parsed: { date: string; tags: string[] };
  
  try {
    parsed = typeof content === 'string' ? JSON.parse(content) : { date: new Date().toISOString().split('T')[0], tags: [] };
  } catch (error) {
    console.error("Failed to parse metadata:", error);
    parsed = { date: new Date().toISOString().split('T')[0], tags: [] };
  }
  
  // Validate and parse date
  let parsedDate: Date;
  try {
    parsedDate = new Date(parsed.date);
    // Check if date is valid
    if (isNaN(parsedDate.getTime())) {
      console.warn(`Invalid date from LLM: ${parsed.date}, using today`);
      parsedDate = new Date();
    }
  } catch (error) {
    console.error("Failed to parse date:", error);
    parsedDate = new Date();
  }
  
  return {
    date: parsedDate,
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
  };
}

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
  
  // Validate date
  if (!params.date || isNaN(params.date.getTime())) {
    console.error("Invalid date provided to saveToNotion, using current date");
    params.date = new Date();
  }
  
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
