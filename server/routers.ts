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
          console.log(`[processRecording] Checking for existing diary with date: ${metadata.date.toISOString()}`);
          const existingEntry = await findExistingDiaryByDate(metadata.date);
          console.log(`[processRecording] Existing entry found: ${existingEntry ? 'YES' : 'NO'}`);
          
          if (existingEntry) {
            console.log(`[processRecording] Existing entry details: pageId=${existingEntry.pageId}, content length=${existingEntry.content.length}`);
          }
          
          let notionResult: { pageId: string; pageUrl: string };
          
          if (existingEntry) {
            // Merge with existing entry
            console.log(`[processRecording] Merging with existing diary entry`);
            notionResult = await mergeWithExistingDiary({
              existingPageId: existingEntry.pageId,
              existingContent: existingEntry.content,
              newContent: formattedText,
              tags: allTags,
              date: metadata.date,
            });
          } else {
            // Create new entry
            const dateStr = `${metadata.date.getFullYear()}/${metadata.date.getMonth() + 1}/${metadata.date.getDate()}`;
            const title = `日記 ${dateStr}`;
            console.log(`[processRecording] Creating new entry with title: ${title}, date: ${metadata.date.toISOString()}`);
            notionResult = await saveToNotion({
              title,
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
  const { spawnSync } = await import('child_process');
  
  // Format date for search (YYYY/M/D format)
  const dateStr = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
  const searchQuery = `日記 ${dateStr}`;
  
  console.log(`[findExistingDiaryByDate] Searching for existing diary with date: ${dateStr}`);
  
  try {
    const searchInput = {
      query: searchQuery,
      query_type: "internal",
      data_source_url: "collection://94518c78-84e5-4fb2-aea2-165124d31bf3",
    };

    const searchResult = spawnSync(
      'manus-mcp-cli',
      ['tool', 'call', 'search', '--server', 'notion', '--input', JSON.stringify(searchInput)],
      { encoding: 'utf-8' }
    );
    
    const result = searchResult.stdout || searchResult.stderr || '';
    console.log(`[findExistingDiaryByDate] Search result length: ${result.length}`);

    // Parse search results
    const resultMatch = result.match(/Tool execution result:\s*({[\s\S]*})/);
    if (!resultMatch) {
      console.log(`[findExistingDiaryByDate] No result match found`);
      return null;
    }
    
    const searchResults = JSON.parse(resultMatch[1]);
    console.log(`[findExistingDiaryByDate] Found ${searchResults.results?.length || 0} results`);
    
    if (!searchResults.results || searchResults.results.length === 0) {
      console.log(`[findExistingDiaryByDate] No existing diary found for ${dateStr}`);
      return null;
    }

    // Log all results for debugging
    searchResults.results.forEach((r: any, i: number) => {
      console.log(`[findExistingDiaryByDate] Result ${i}: title="${r.title}", id=${r.id}`);
    });

    // Find exact date match - check for exact title match
    const exactMatch = searchResults.results.find((r: any) => 
      r.title && r.title === `日記 ${dateStr}`
    );

    if (!exactMatch) {
      console.log(`[findExistingDiaryByDate] No exact match found for "日記 ${dateStr}"`);
      return null;
    }
    
    console.log(`[findExistingDiaryByDate] Found exact match: ${exactMatch.title} (${exactMatch.id})`);

    // Fetch the full page content
    const fetchInput = { id: exactMatch.id };
    const fetchSpawn = spawnSync(
      'manus-mcp-cli',
      ['tool', 'call', 'fetch', '--server', 'notion', '--input', JSON.stringify(fetchInput)],
      { encoding: 'utf-8' }
    );
    
    const fetchResult = fetchSpawn.stdout || fetchSpawn.stderr || '';

    const fetchMatch = fetchResult.match(/Tool execution result:\s*({[\s\S]*})/);
    if (!fetchMatch) return null;

    const pageData = JSON.parse(fetchMatch[1]);
    
    console.log(`[findExistingDiaryByDate] Successfully retrieved existing diary content (${pageData.text?.length || 0} chars)`);
    
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
  console.log('[mergeWithExistingDiary] Starting merge process');
  console.log('[mergeWithExistingDiary] Page ID:', params.existingPageId);
  console.log('[mergeWithExistingDiary] Existing content length:', params.existingContent.length);
  console.log('[mergeWithExistingDiary] New content length:', params.newContent.length);
  
  const { spawnSync } = await import('child_process');
  
  // Use LLM to merge contents intelligently
  const { invokeLLM } = await import('./_core/llm');
  
  const mergeResponse = await invokeLLM({
    messages: [
      {
        role: "system",
        content: "あなたは日記の統合を手伝うアシスタントです。既存の日記と新しい内容を自然に統合してください。重複する内容は統合し、異なる内容は両方を保持してください。ヘッダー、タイトル、日付、タグ、「統合された日記」などのメタ情報やヘッダーは一切含めず、日記の内容のみを返してください。"
      },
      {
        role: "user",
        content: `以下の2つの日記内容を統合してください。メタ情報（タイトル、日付、タグ、ヘッダーなど）は一切含めず、日記の内容のみを返してください：\n\n既存の内容：\n${params.existingContent}\n\n新しい内容：\n${params.newContent}`
      }
    ],
  });

  const mergedContent = typeof mergeResponse.choices[0]?.message?.content === 'string' 
    ? mergeResponse.choices[0].message.content 
    : `${params.existingContent}\n\n${params.newContent}`;
  
  console.log('[mergeWithExistingDiary] LLM merge completed, merged content length:', mergedContent.length);

  // Update the existing Notion page's "本文" property
  const updateInput = {
    data: {
      page_id: params.existingPageId,
      command: "update_properties",
      properties: {
        "本文": mergedContent,
      },
    }
  };

  console.log('[mergeWithExistingDiary] Calling Notion update API...');
  
  const spawnResult = spawnSync(
    'manus-mcp-cli',
    ['tool', 'call', 'notion-update-page', '--server', 'notion', '--input', JSON.stringify(updateInput)],
    { encoding: 'utf-8' }
  );

  const result = spawnResult.stdout || spawnResult.stderr || '';
  console.log('[mergeWithExistingDiary] Notion API response status:', spawnResult.status);
  console.log('[mergeWithExistingDiary] Notion API response:', result.substring(0, 500));
  
  if (spawnResult.status !== 0) {
    console.error('[mergeWithExistingDiary] Failed to update Notion page (page may have been deleted):', result);
    console.log('[mergeWithExistingDiary] Falling back to creating a new page instead');
    
    // Fallback: create a new page if update fails (page might have been deleted)
    const dateStr = `${params.date.getFullYear()}/${params.date.getMonth() + 1}/${params.date.getDate()}`;
    return await saveToNotion({
      title: `日記 ${dateStr}`,
      content: mergedContent,
      tags: params.tags,
      date: params.date,
    });
  }

  // Extract page URL from result
  const urlMatch = result.match(/https:\/\/www\.notion\.so\/[a-f0-9]+/);
  const pageUrl = urlMatch ? urlMatch[0] : "";
  
  console.log('[mergeWithExistingDiary] Merge completed successfully');
  console.log('[mergeWithExistingDiary] Page URL:', pageUrl);

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
  
  // Get current date in JST (UTC+9)
  const now = new Date();
  const jstOffset = 9 * 60; // JST is UTC+9
  const currentDate = new Date(now.getTime() + jstOffset * 60 * 1000);
  const currentDateStr = currentDate.toISOString().split('T')[0];
  
  // Extract date interpretation and tags from LLM
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `あなたは日記のメタデータを抽出するアシスタントです。テキストから日付の言及とタグを抽出してJSON形式で返してください。現在の日付は${currentDateStr}です。`
      },
      {
        role: "user",
        content: `以下のテキストから日付の言及とタグを抽出してください。

テキスト: ${text}

以下のルールに従ってください：

1. 日付の解釈：
   - テキスト中に日付の言及があるかを判定
   - 日付の言及がある場合：
     a) 具体的な日付（例：「2026年1月20日」「1月20日」）
        → {"type": "specific", "date": "YYYY-MM-DD"}
     b) 相対的な日付（例：「昨日」「3日前」「先週の金曜日」）
        → {"type": "relative", "days": -1} （負の数は過去、正の数は未来）
   - 日付の言及がない場合：
     → null

2. タグ：
   - タグは内容から推測し、["仕事", "プライベート", "健康", "学習", "趣味"]の中から選択
   - 複数のタグが当てはまる場合はすべて含める

JSON形式で返してください：
{
  "dateInfo": {"type": "specific", "date": "YYYY-MM-DD"} or {"type": "relative", "days": -1} or null,
  "tags": ["tag1", "tag2"]
}

例：
- "昨日は仕事で大変だった" → {"dateInfo": {"type": "relative", "days": -1}, "tags": ["仕事"]}
- "1月20日に病院に行った" → {"dateInfo": {"type": "specific", "date": "2026-01-20"}, "tags": ["健康"]}
- "今日はジムに行った" → {"dateInfo": null, "tags": ["健康", "趣味"]}`
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
            dateInfo: {
              anyOf: [
                {
                  type: "object",
                  properties: {
                    type: { type: "string", enum: ["specific"] },
                    date: { type: "string", description: "Date in YYYY-MM-DD format" }
                  },
                  required: ["type", "date"],
                  additionalProperties: false
                },
                {
                  type: "object",
                  properties: {
                    type: { type: "string", enum: ["relative"] },
                    days: { type: "integer", description: "Number of days relative to today (negative for past, positive for future)" }
                  },
                  required: ["type", "days"],
                  additionalProperties: false
                },
                { type: "null" }
              ]
            },
            tags: { 
              type: "array", 
              items: { type: "string" },
              description: "Array of tags"
            },
          },
          required: ["dateInfo", "tags"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  let parsed: { 
    dateInfo: { type: "specific"; date: string } | { type: "relative"; days: number } | null; 
    tags: string[] 
  };
  
  try {
    parsed = typeof content === 'string' ? JSON.parse(content) : { dateInfo: null, tags: [] };
  } catch (error) {
    console.error("Failed to parse metadata:", error);
    parsed = { dateInfo: null, tags: [] };
  }
  
  // Calculate final date based on LLM interpretation
  let finalDate: Date = currentDate;
  
  if (parsed.dateInfo) {
    if (parsed.dateInfo.type === "specific") {
      // Specific date provided
      try {
        // Parse date as JST (add time component to ensure correct date)
        const extractedDate = new Date(parsed.dateInfo.date + 'T00:00:00+09:00');
        
        if (!isNaN(extractedDate.getTime())) {
          // Define acceptable date range: 1 year in the past to 1 week in the future
          const oneYearAgo = new Date(currentDate);
          oneYearAgo.setFullYear(currentDate.getFullYear() - 1);
          
          const oneWeekLater = new Date(currentDate);
          oneWeekLater.setDate(currentDate.getDate() + 7);
          
          if (extractedDate >= oneYearAgo && extractedDate <= oneWeekLater) {
            finalDate = extractedDate;
            console.log(`[extractMetadata] Using specific date: ${extractedDate.toISOString()}`);
          } else {
            console.warn(`[extractMetadata] Specific date ${parsed.dateInfo.date} is out of range, using current date`);
          }
        } else {
          console.warn(`[extractMetadata] Invalid specific date: ${parsed.dateInfo.date}, using current date`);
        }
      } catch (error) {
        console.error("Failed to parse specific date:", error);
      }
    } else if (parsed.dateInfo.type === "relative") {
      // Relative date provided - calculate from current date in JST
      const days = parsed.dateInfo.days;
      
      // Validate relative days range (-365 to +7)
      if (days >= -365 && days <= 7) {
        finalDate = new Date(currentDate);
        finalDate.setDate(currentDate.getDate() + days);
        console.log(`[extractMetadata] Using relative date: ${days} days from today = ${finalDate.toISOString()}`);
      } else {
        console.warn(`[extractMetadata] Relative days ${days} is out of range, using current date`);
      }
    }
  } else {
    console.log(`[extractMetadata] No date mentioned, using current date: ${currentDate.toISOString()}`);
  }
  
  console.log(`[extractMetadata] Final date: ${finalDate.toISOString()}, tags: ${JSON.stringify(parsed.tags)}`);
  
  return {
    date: finalDate,
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
        content: "あなたは日記の内容を箇条書き形式に整理するアシスタントです。重要なポイントを抽出し、簡潔に箇条書き形式で返してください。ヘッダー、タイトル、日付、タグなどのメタ情報は一切含めず、日記の内容のみを返してください。"
      },
      {
        role: "user",
        content: `以下の音声入力テキストを箇条書き形式に整理してください。メタ情報（タイトル、日付、タグなど）は一切含めず、日記の内容のみを返してください：\n\n${text}`
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
  const { spawnSync } = await import('child_process');
  
  // Validate date
  if (!params.date || isNaN(params.date.getTime())) {
    console.error("Invalid date provided to saveToNotion, using current date");
    params.date = new Date();
  }
  
  console.log(`[saveToNotion] Saving with title: ${params.title}, date: ${params.date.toISOString()}`);
  
  const notionInput = {
    parent: {
      data_source_id: "94518c78-84e5-4fb2-aea2-165124d31bf3"
    },
    pages: [
      {
        properties: {
          "タイトル": params.title,
          "本文": params.content,
          "タグ": JSON.stringify(params.tags),
          "date:日付:start": params.date.toISOString(),
          "date:日付:is_datetime": 1,
        }
      }
    ]
  };

  const spawnResult = spawnSync(
    'manus-mcp-cli',
    ['tool', 'call', 'notion-create-pages', '--server', 'notion', '--input', JSON.stringify(notionInput)],
    { encoding: 'utf-8' }
  );
  
  const result = spawnResult.stdout || spawnResult.stderr || '';
  
  if (spawnResult.status !== 0) {
    console.error('Failed to create Notion page:', result);
    throw new Error(`Failed to create Notion page: ${result}`);
  }
  
  // Parse result to extract page ID and URL
  const urlMatch = result.match(/https:\/\/www\.notion\.so\/[a-f0-9]+/);
  const pageUrl = urlMatch ? urlMatch[0] : "";
  const pageId = pageUrl.split('/').pop() || "";

  return { pageId, pageUrl };
}

export type AppRouter = typeof appRouter;
