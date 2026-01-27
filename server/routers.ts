import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { createRecording, updateRecording, getUserRecordings, getRecordingById } from "./db";
import { storagePut } from "./storage";
import { transcribeAudio } from "./_core/voiceTranscription";
import { TRPCError } from "@trpc/server";
import { saveToNotion as saveToNotionRestAPI } from "./notion";

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
     * Transcribe audio only (without saving to Notion)
     * Returns transcribed text, metadata, and formatted content for user review
     */
    transcribe: protectedProcedure
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

          // Use extracted date from audio content for both title and Notion date field
          const titleJstDateStr = metadata.date.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' });
          const titleJstDate = titleJstDateStr.split(' ')[0]; // YYYY-MM-DD
          const [titleYear, titleMonth, titleDay] = titleJstDate.split('-');
          const titleDateStr = `${titleYear}/${parseInt(titleMonth)}/${parseInt(titleDay)}`;
          const title = `日記 ${titleDateStr}`;
          
          // Update recording with transcribed text (but not Notion info yet)
          await updateRecording(input.recordingId, {
            transcribedText: formattedText,
            status: "transcribed", // New status: transcribed but not saved to Notion
          });

          return {
            success: true,
            title,
            transcribedText: formattedText,
            tags: allTags,
            date: titleJstDate, // Return extracted date from audio content (matches title date)
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
     * Save edited diary entry to Notion
     */
    saveToNotionDiary: protectedProcedure
      .input(z.object({
        recordingId: z.number(),
        title: z.string(),
        content: z.string(),
        tags: z.array(z.string()),
        date: z.string(), // YYYY-MM-DD date string
      }))
      .mutation(async ({ ctx, input }) => {
        const recording = await getRecordingById(input.recordingId);
        
        if (!recording || recording.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Recording not found" });
        }

        try {
          // Parse date from YYYY-MM-DD string as JST
          const date = new Date(input.date + 'T00:00:00+09:00');
          
          // Save to Notion
          const notionResult = await saveToNotion({
            title: input.title,
            content: input.content,
            tags: input.tags,
            date,
          });

          // Update recording with Notion info
          await updateRecording(input.recordingId, {
            notionPageId: notionResult.pageId,
            notionPageUrl: notionResult.pageUrl,
            status: "completed",
          });

          return {
            success: true,
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
            message: `Failed to save to Notion: ${errorMessage}` 
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

  /**
   * Notion diary router
   */
  notion: router({
    /**
     * Query diary entries from Notion
     */
    queryDiaries: protectedProcedure
      .input(z.object({
        startDate: z.string().optional(), // YYYY-MM-DD
        endDate: z.string().optional(), // YYYY-MM-DD
        title: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const { queryDiaryEntries } = await import('./notion');
        
        const options: any = {};
        if (input.startDate) {
          options.startDate = new Date(input.startDate + 'T00:00:00+09:00');
        }
        if (input.endDate) {
          options.endDate = new Date(input.endDate + 'T00:00:00+09:00');
        }
        if (input.title) {
          options.title = input.title;
        }
        
        const entries = await queryDiaryEntries(options);
        return entries;
      }),
    
    /**
     * Merge duplicate diary entries with the same title
     */
    mergeDuplicates: protectedProcedure
      .mutation(async () => {
        const { queryDiaryEntries, updatePage, deletePage } = await import('./notion');
        
        // Get all diary entries
        const allEntries = await queryDiaryEntries();
        
        type DiaryEntry = {
          pageId: string;
          pageUrl: string;
          title: string;
          content: string;
          tags: string[];
          date: string;
        };
        
        // Group by title
        const groupedByTitle = new Map<string, DiaryEntry[]>();
        for (const entry of allEntries) {
          const existing = groupedByTitle.get(entry.title) || [];
          existing.push(entry);
          groupedByTitle.set(entry.title, existing);
        }
        
        let mergedCount = 0;
        let deletedCount = 0;
        
        // Process each group
        for (const [title, entries] of Array.from(groupedByTitle.entries())) {
          if (entries.length <= 1) {
            continue; // No duplicates
          }
          
          console.log(`[mergeDuplicates] Found ${entries.length} entries with title: ${title}`);
          
          // Sort by date (newest first)
          entries.sort((a: DiaryEntry, b: DiaryEntry) => b.date.localeCompare(a.date));
          
          // Keep the first (newest) entry as the master
          const masterEntry = entries[0];
          const duplicateEntries = entries.slice(1);
          
          // Merge content
          const mergedContent = [
            masterEntry.content,
            ...duplicateEntries.map(e => e.content)
          ].filter(c => c.trim().length > 0).join('\n\n');
          
          // Merge tags (OR operation - union of all tags)
          const allTags = new Set<string>();
          for (const entry of entries) {
            for (const tag of entry.tags) {
              allTags.add(tag);
            }
          }
          const mergedTags = Array.from(allTags);
          
          console.log(`[mergeDuplicates] Merging into master entry: ${masterEntry.pageId}`);
          console.log(`[mergeDuplicates] Merged content length: ${mergedContent.length}`);
          console.log(`[mergeDuplicates] Merged tags: ${mergedTags.join(', ')}`);
          
          // Update master entry
          await updatePage(masterEntry.pageId, {
            content: mergedContent,
            tags: mergedTags
          });
          
          mergedCount++;
          
          // Delete duplicate entries
          for (const duplicate of duplicateEntries) {
            console.log(`[mergeDuplicates] Deleting duplicate entry: ${duplicate.pageId}`);
            await deletePage(duplicate.pageId);
            deletedCount++;
          }
        }
        
        console.log(`[mergeDuplicates] Merge complete: ${mergedCount} titles merged, ${deletedCount} duplicates deleted`);
        
        return {
          success: true,
          mergedCount,
          deletedCount
        };
      }),
  }),
});

/**
 * Extract date and tags from transcribed text using LLM
 */
async function extractMetadata(text: string): Promise<{
  date: Date;
  tags: string[];
}> {
  const { invokeLLM } = await import('./_core/llm');
  
  // Get current date in JST (UTC+9)
  // Use toLocaleString to get JST date components correctly
  const now = new Date();
  const jstDateStr = now.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }); // 'sv-SE' gives YYYY-MM-DD HH:MM:SS format
  const currentDateStr = jstDateStr.split(' ')[0]; // Extract YYYY-MM-DD
  
  // Create a Date object representing midnight JST for the current day
  const currentDate = new Date(currentDateStr + 'T00:00:00+09:00');
  
  // Extract date interpretation and tags from LLM
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `あなたは日記のメタデータを抽出するアシスタントです。テキストから日付の言及とタグを抽出してJSON形式で返してください。現在の日付は${currentDateStr}です。`
      },
      {
        role: "user",
        content: `以下の音声テキストから日付の言及とタグを抽出してください。

テキスト: ${text}

重要：「〇〇の日記に記録」という指示部分と、実際の日記内容を区別してください。

例：
- "昨日の日記に今日は雨だったと記録する"
  → 日付は「昨日」（指示部分）、内容は「今日は雨だった」
  → {"dateInfo": {"type": "relative", "days": -1}, "tags": ["天気"]}

- "1月20日の日記に仕事でプレゼンをしたと記録"
  → 日付は「1月20日」（指示部分）、内容は「仕事でプレゼンをした」
  → {"dateInfo": {"type": "specific", "date": "2026-01-20"}, "tags": ["仕事"]}

以下のルールに従ってください：
1. 日付の解釈：
   - 「〇〇の日記に」という指示があれば、その日付を抽出
   - 指示がなければ、内容中の日付言及を抽出
   - 日付の言及がある場合：
     a) 具体的な日付（例：「2026年1月20日」「1月20日」）
        → {"type": "specific", "date": "YYYY-MM-DD"}
     b) 相対的な日付（例：「昨日」「3日前」「先週の金曜日」）
        → {"type": "relative", "days": -1} （負の数は過去、正の数は未来）
   - 日付の言及がない場合：
     → null

2. タグ：
   - タグは実際の日記内容（指示部分を除いた部分）から推測
   - ["仕事", "プライベート", "健康", "学習", "趣味", "食事"]の中から選択
   - 複数のタグが当てはまる場合はすべて含める

JSON形式で返してください：
{
  "dateInfo": {"type": "specific", "date": "YYYY-MM-DD"} or {"type": "relative", "days": -1} or null,
  "tags": ["tag1", "tag2"]
}

その他の例：
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
        // Calculate the target date by adding/subtracting days
        const targetTimestamp = currentDate.getTime() + (days * 24 * 60 * 60 * 1000);
        finalDate = new Date(targetTimestamp);
        console.log(`[extractMetadata] Using relative date: ${days} days from ${currentDateStr} = ${finalDate.toISOString()}`);
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
        content: "あなたは日記の内容を箇条書き形式に整理するアシスタントです。重要なポイントを抽出し、時系列順に並べ、階層化して返してください。"
      },
      {
        role: "user",
        content: `以下の音声入力テキストを箇条書き形式に整理してください。

重要なルール：
1. メインの項目は「• 」（黒丸+スペース）で始める
2. サブ項目（詳細や補足）は「  ◦ 」（2スペース+白丸+スペース）で始める
3. 時系列順に並べる
4. 1行に1つの項目を書く
5. メタ情報（タイトル、日付、タグなど）は一切含めない
6. 「昨日の日記に」「3日前の日記に」「今日の日記に」などの日記への言及は削除する
7. 日記の内容のみを箇条書きで返す

例：
入力：「今日は会社に行って、会議に参加しました。新しいプロジェクトについて話し合いました。その後、銀行に立ち寄って振り込みをしました。」
出力：
• 会社に行って会議に参加した
  ◦ 新しいプロジェクトについて話し合った
• 銀行に立ち寄って振り込みをした

音声入力テキスト：
${text}`
      }
    ],
  });

  const content = response.choices[0]?.message?.content;
  const formattedContent = typeof content === 'string' ? content.trim() : text;
  
  console.log(`[formatTextToBulletPoints] Input length: ${text.length}, Output length: ${formattedContent.length}`);
  console.log(`[formatTextToBulletPoints] Output preview: ${formattedContent.substring(0, 200)}`);
  
  return formattedContent;
}

/**
 * Save diary entry to Notion database using REST API
 * 
 * This function now uses direct REST API calls instead of MCP,
 * eliminating environment dependencies and improving reliability.
 */
async function saveToNotion(params: {
  title: string;
  content: string;
  tags: string[];
  date: Date;
}): Promise<{ pageId: string; pageUrl: string }> {
  return saveToNotionRestAPI(params);
}

export type AppRouter = typeof appRouter;
