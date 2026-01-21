import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Mic, Square, Loader2 } from "lucide-react";
import { toast } from "sonner";

const AVAILABLE_TAGS = ["仕事", "プライベート", "健康", "学習", "趣味", "食事"];

interface VoiceRecorderProps {
  onRecordingComplete: (audioBlob: Blob, tags: string[], duration: number) => void;
  isProcessing?: boolean;
}

export function VoiceRecorder({ onRecordingComplete, isProcessing = false }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Set up audio analysis for visualization
      audioContextRef.current = new AudioContext();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const duration = recordingTime;
        
        // Check file size (16MB limit)
        const sizeMB = audioBlob.size / (1024 * 1024);
        if (sizeMB > 16) {
          toast.error("録音ファイルが大きすぎます", {
            description: `ファイルサイズ: ${sizeMB.toFixed(2)}MB（最大16MB）`
          });
          return;
        }

        onRecordingComplete(audioBlob, selectedTags, duration);
        
        // Clean up
        stream.getTracks().forEach(track => track.stop());
        if (audioContextRef.current) audioContextRef.current.close();
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      // Start audio level monitoring
      monitorAudioLevel();

      toast.success("録音を開始しました");
    } catch (error) {
      console.error("Recording error:", error);
      toast.error("マイクへのアクセスに失敗しました", {
        description: "ブラウザの設定でマイクの使用を許可してください"
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }

      setAudioLevel(0);
    }
  };

  const monitorAudioLevel = () => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    
    const updateLevel = () => {
      if (!analyserRef.current) return;
      
      analyserRef.current.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      setAudioLevel(average / 255); // Normalize to 0-1

      animationFrameRef.current = requestAnimationFrame(updateLevel);
    };

    updateLevel();
  };

  const toggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Card className="p-8 bg-card text-card-foreground border border-border">
      <div className="space-y-8">
        {/* Recording Controls */}
        <div className="flex flex-col items-center space-y-6">
          <div className="relative">
            {/* Visual feedback circle */}
            <div 
              className="absolute inset-0 rounded-full bg-primary/10 transition-transform duration-150"
              style={{ 
                transform: `scale(${1 + audioLevel * 0.3})`,
                opacity: isRecording ? 0.6 : 0
              }}
            />
            
            <Button
              size="lg"
              variant={isRecording ? "destructive" : "default"}
              className="relative z-10 h-24 w-24 rounded-full"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <Loader2 className="h-10 w-10 animate-spin" />
              ) : isRecording ? (
                <Square className="h-10 w-10" />
              ) : (
                <Mic className="h-10 w-10" />
              )}
            </Button>
          </div>

          {/* Recording time */}
          {isRecording && (
            <div className="text-center">
              <div className="text-4xl font-bold tracking-tight" style={{ fontFamily: 'Playfair Display, serif' }}>
                {formatTime(recordingTime)}
              </div>
              <div className="text-label text-muted-foreground mt-2">
                録音中
              </div>
            </div>
          )}

          {!isRecording && !isProcessing && (
            <div className="text-center">
              <div className="text-label text-muted-foreground">
                マイクボタンをクリックして録音開始
              </div>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="divider" />

        {/* Tag Selection */}
        <div className="space-y-4">
          <Label className="text-label text-foreground">タグを選択</Label>
          <div className="grid grid-cols-2 gap-4">
            {AVAILABLE_TAGS.map((tag) => (
              <div key={tag} className="flex items-center space-x-3">
                <Checkbox
                  id={`tag-${tag}`}
                  checked={selectedTags.includes(tag)}
                  onCheckedChange={() => toggleTag(tag)}
                  disabled={isRecording || isProcessing}
                />
                <Label
                  htmlFor={`tag-${tag}`}
                  className="text-sm font-normal cursor-pointer"
                >
                  {tag}
                </Label>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
