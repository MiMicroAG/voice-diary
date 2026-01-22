import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { DiaryEntries } from "@/components/DiaryEntries";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function Home() {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);

  const { data: recordings, isLoading: recordingsLoading, refetch } = trpc.recording.list.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );

  const createRecordingMutation = trpc.recording.create.useMutation();
  const uploadAudioMutation = trpc.recording.uploadAudio.useMutation();
  const processRecordingMutation = trpc.recording.process.useMutation();

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

      // Step 4: Process (transcribe and save to Notion)
      const result = await processRecordingMutation.mutateAsync({
        recordingId,
      });

      toast.success("日記をNotionに保存しました！", {
        description: "Notionで確認できます",
        action: result.notionPageUrl ? {
          label: "開く",
          onClick: () => window.open(result.notionPageUrl, '_blank'),
        } : undefined,
      });

      // Refresh the list
      refetch();
    } catch (error) {
      console.error("Processing error:", error);
      toast.error("処理に失敗しました", {
        description: error instanceof Error ? error.message : "不明なエラーが発生しました"
      });
    } finally {
      setIsProcessing(false);
    }
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
                  {recordings.length} エントリー
                </span>
              )}
            </div>

            {recordingsLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <DiaryEntries entries={recordings || []} />
            )}
          </section>
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
