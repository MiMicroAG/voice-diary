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

          // Always create a new entry (no merging)
          // Convert to JST to get the correct date components
          const jstDateStr = metadata.date.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' });
          const jstDate = jstDateStr.split(' ')[0]; // YYYY-MM-DD
          const [year, month, day] = jstDate.split('-');
          const dateStr = `${year}/${parseInt(month)}/${parseInt(day)}`;
          const title = `日記 ${dateStr}`;
          console.log(`[processRecording] Creating new entry with title: ${title}, date: ${metadata.date.toISOString()}`);
          const notionResult = await saveToNotion({
            title,
            content: formattedText,
            tags: allTags,
            date: metadata.date,
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
   - タグは内容から推測し、["仕事", "プライベート", "健康", "学習", "趣味", "食事"]の中から選択
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
  
  // Parse result to extract page ID
  console.log('[saveToNotion] Notion API response:', result);
  
  // Extract page id from JSON response (notion-create-pages returns {pages:[{id:...}]})
  let pageId = "";
  try {
    const jsonMatch = result.match(/\{"pages":\[\{[^\]]+\}\]\}/);
    if (jsonMatch) {
      const jsonObj = JSON.parse(jsonMatch[0]);
      if (jsonObj.pages && jsonObj.pages.length > 0) {
        pageId = jsonObj.pages[0].id;
      }
    }
  } catch (e) {
    console.error('[saveToNotion] Failed to parse page id from response:', e);
    console.error('[saveToNotion] Response:', result);
  }
  
  if (!pageId) {
    throw new Error('Failed to extract page_id from Notion response');
  }
  
  // Generate page URL from page ID
  const pageIdWithoutHyphens = pageId.replace(/-/g, '');
  const pageUrl = `https://www.notion.so/${pageIdWithoutHyphens}`;
  
  console.log('[saveToNotion] Successfully created page:', pageId);
  console.log('[saveToNotion] Page URL:', pageUrl);

  return { pageId, pageUrl };
}

export type AppRouter = typeof appRouter;
