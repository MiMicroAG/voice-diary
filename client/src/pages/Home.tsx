import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { DiaryEntries } from "@/components/DiaryEntries";
import { DiaryEditor, type DiaryData } from "@/components/DiaryEditor";
import { DiaryCalendar } from "@/components/DiaryCalendar";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { toast } from "sonner";
import { Loader2, PenSquare } from "lucide-react";

type EditorMode = "none" | "voice" | "direct";

export default function Home() {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("none");
  const [diaryData, setDiaryData] = useState<DiaryData | null>(null);

  const { data: recordings, isLoading: recordingsLoading, refetch } = trpc.recording.list.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );

  const createRecordingMutation = trpc.recording.create.useMutation();
  const uploadAudioMutation = trpc.recording.uploadAudio.useMutation();
  const transcribeMutation = trpc.recording.transcribe.useMutation();
  const saveToNotionMutation = trpc.recording.saveToNotionDiary.useMutation();

  const handleRecordingComplete = async (audioBlob: Blob, tags: string[], duration: number) => {
    setIsProcessing(true);
    
    try {
      // Step 1: Create recording entry
      const { recordingId } = await createRecordingMutation.mutateAsync({
        duration,
        tags,
      });

      toast.info("音声をアップロード中...");

      // Step 2: Convert blob to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const base64 = reader.result as string;
          const base64Data = base64.split(',')[1]; // Remove data:audio/webm;base64, prefix
          resolve(base64Data);
        };
        reader.onerror = reject;
      });
      reader.readAsDataURL(audioBlob);
      const base64Data = await base64Promise;

      // Step 3: Upload audio to S3
      await uploadAudioMutation.mutateAsync({
        recordingId,
        audioData: base64Data,
        mimeType: audioBlob.type,
      });

      toast.info("音声をテキストに変換中...");

      // Step 4: Transcribe (without saving to Notion)
      const result = await transcribeMutation.mutateAsync({
        recordingId,
      });

      // Show editor with transcribed data
      setDiaryData({
        recordingId,
        title: result.title,
        content: result.transcribedText,
        tags: result.tags,
        date: result.date,
      });
      setEditorMode("voice");
      toast.success("テキストに変換しました。内容を確認して登録してください。");
    } catch (error) {
      console.error("Processing error:", error);
      toast.error("処理に失敗しました", {
        description: error instanceof Error ? error.message : "不明なエラーが発生しました"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDirectInput = () => {
    // Create initial data for direct text input
    const now = new Date();
    const jstDateStr = now.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' });
    const jstDate = jstDateStr.split(' ')[0]; // YYYY-MM-DD
    const [year, month, day] = jstDate.split('-');
    const dateStr = `${year}/${parseInt(month)}/${parseInt(day)}`;
    
    setDiaryData({
      title: `日記 ${dateStr}`,
      content: "",
      tags: [],
      date: jstDate, // Send YYYY-MM-DD string directly
    });
    setEditorMode("direct");
  };

  const handleSaveDiary = async (data: DiaryData) => {
    setIsProcessing(true);
    try {
      let recordingId = data.recordingId;
      
      // If direct input (no recordingId), create a dummy recording entry
      if (!recordingId) {
        const { recordingId: newId } = await createRecordingMutation.mutateAsync({
          duration: 0,
          tags: data.tags,
        });
        recordingId = newId;
      }

      // Save to Notion
      const result = await saveToNotionMutation.mutateAsync({
        recordingId,
        title: data.title,
        content: data.content,
        tags: data.tags,
        date: data.date,
      });

      toast.success("日記をNotionに保存しました！", {
        description: "Notionで確認できます",
        action: result.notionPageUrl ? {
          label: "開く",
          onClick: () => window.open(result.notionPageUrl, '_blank'),
        } : undefined,
      });

      // Reset editor and refresh list
      setEditorMode("none");
      setDiaryData(null);
      refetch();
    } catch (error) {
      console.error("Save error:", error);
      toast.error("保存に失敗しました", {
        description: error instanceof Error ? error.message : "不明なエラーが発生しました"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancelEdit = () => {
    setEditorMode("none");
    setDiaryData(null);
  };

  const mergeDuplicatesMutation = trpc.notion.mergeDuplicates.useMutation();
  const trpcUtils = trpc.useUtils();
  
  // State for calendar month
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  
  // Query diaries for the current calendar month
  const { data: monthDiaries, isLoading: monthDiariesLoading } = trpc.notion.queryDiaries.useQuery(
    {
      startDate: `${calendarMonth.year}-${String(calendarMonth.month).padStart(2, '0')}-01`,
      endDate: `${calendarMonth.year}-${String(calendarMonth.month).padStart(2, '0')}-31`,
    },
    { enabled: isAuthenticated }
  );

  const handleMergeDuplicates = async () => {
    try {
      toast.info("重複した日記をマージ中...");
      
      const result = await mergeDuplicatesMutation.mutateAsync();
      
      toast.success("マージが完了しました！", {
        description: `${result.mergedCount}件のタイトルを統合し、${result.deletedCount}件の重複を削除しました`
      });
      
      // Refresh the recordings list
      refetch();
      
    } catch (error) {
      console.error("Merge error:", error);
      toast.error("マージに失敗しました", {
        description: error instanceof Error ? error.message : "不明なエラーが発生しました"
      });
    }
  };

  const handleMonthChange = (year: number, month: number) => {
    setCalendarMonth({ year, month });
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6">
        <div className="max-w-2xl w-full text-center space-y-8">
          {/* Hero section */}
          <div className="space-y-6">
            <h1 className="text-7xl md:text-8xl font-bold tracking-tight" style={{ fontFamily: 'Playfair Display, serif' }}>
              AIものぐさ日記
            </h1>
            <div className="divider mx-auto w-32" />
            <h2 className="text-2xl md:text-3xl font-light" style={{ fontFamily: 'Cormorant Garamond, serif' }}>
              声で綴る、あなたの物語
            </h2>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
              音声で日記を記録し、自動的にテキスト化してNotionに保存。
              思いついたその瞬間を、声で残しましょう。
            </p>
          </div>

          {/* CTA */}
          <div className="pt-8">
            <Button
              size="lg"
              className="text-base px-8 py-6"
              onClick={() => window.location.href = getLoginUrl()}
            >
              ログインして始める
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container py-6 flex items-center justify-between">
          <h1 className="text-4xl font-bold tracking-tight" style={{ fontFamily: 'Playfair Display, serif' }}>
            AIものぐさ日記
          </h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {user?.name || user?.email}
            </span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="container py-12">
        <div className="max-w-4xl mx-auto space-y-12">
          {editorMode === "none" ? (
            <>
              {/* Recording section */}
              <section className="space-y-6">
                <div className="text-center space-y-2">
                  <h2 className="text-3xl font-light" style={{ fontFamily: 'Cormorant Garamond, serif' }}>
                    新しい日記を録音
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    マイクボタンをクリックして、あなたの声を記録しましょう
                  </p>
                </div>
                <VoiceRecorder 
                  onRecordingComplete={handleRecordingComplete}
                  isProcessing={isProcessing}
                />
                
                {/* Direct text input button */}
                <div className="text-center">
                  <Button
                    variant="outline"
                    onClick={handleDirectInput}
                    disabled={isProcessing}
                    className="gap-2"
                  >
                    <PenSquare className="h-4 w-4" />
                    テキストで直接入力
                  </Button>
                </div>
              </section>

              <div className="divider" />

              {/* Calendar section */}
              <section className="space-y-6">
                <div className="text-center space-y-2">
                  <h2 className="text-3xl font-light" style={{ fontFamily: 'Cormorant Garamond, serif' }}>
                    日記を参照
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    日付をクリックしてその日の日記を確認
                  </p>
                </div>
                <DiaryCalendar 
                  diaryEntries={monthDiaries || []}
                  isLoading={monthDiariesLoading}
                  onMonthChange={handleMonthChange}
                />
                
                {/* Merge duplicates button */}
                <div className="text-center pt-4">
                  <Button
                    variant="outline"
                    onClick={handleMergeDuplicates}
                    disabled={isProcessing || mergeDuplicatesMutation.isPending}
                    className="gap-2"
                  >
                    {mergeDuplicatesMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        マージ中...
                      </>
                    ) : (
                      "同じタイトルの日記をマージ"
                    )}
                  </Button>
                </div>
              </section>

              <div className="divider" />

              {/* Entries section */}
              <section className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-3xl font-light" style={{ fontFamily: 'Cormorant Garamond, serif' }}>
                    これまでの日記
                  </h2>
                  {recordings && recordings.length > 0 && (
                    <span className="text-label text-muted-foreground">
                      最新 {Math.min(recordings.length, 10)} 件 / 全 {recordings.length} エントリー
                    </span>
                  )}
                </div>

                {recordingsLoading ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : (
                  <DiaryEntries entries={(recordings || []).slice(0, 10)} />
                )}
              </section>
            </>
          ) : (
            /* Editor section */
            <section className="space-y-6">
              <div className="text-center space-y-2">
                <h2 className="text-3xl font-light" style={{ fontFamily: 'Cormorant Garamond, serif' }}>
                  {editorMode === "voice" ? "内容を確認・編集" : "日記を作成"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {editorMode === "voice" 
                    ? "音声から変換されたテキストを確認し、必要に応じて編集してください"
                    : "タイトル、本文、タグ、日付を入力してください"}
                </p>
              </div>
              {diaryData && (
                <DiaryEditor
                  initialData={diaryData}
                  onSave={handleSaveDiary}
                  onCancel={handleCancelEdit}
                  isSaving={isProcessing}
                />
              )}
            </section>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-24">
        <div className="container py-8 text-center">
          <p className="text-sm text-muted-foreground">
            AIものぐさ日記 - あなたの声を、永遠に
          </p>
        </div>
      </footer>
    </div>
  );
}
