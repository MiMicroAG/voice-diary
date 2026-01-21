import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Calendar, Clock } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";

interface DiaryEntry {
  id: number;
  transcribedText: string | null;
  tags: string[];
  status: string;
  notionPageUrl: string | null;
  createdAt: Date;
  duration: number | null;
  errorMessage: string | null;
}

interface DiaryEntriesProps {
  entries: DiaryEntry[];
}

export function DiaryEntries({ entries }: DiaryEntriesProps) {
  if (entries.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground text-lg">
          まだ日記エントリーがありません
        </p>
        <p className="text-muted-foreground text-sm mt-2">
          音声を録音して最初の日記を作成しましょう
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {entries.map((entry) => (
        <Card key={entry.id} className="p-6 bg-card text-card-foreground border border-border hover:shadow-lg transition-shadow">
          <div className="space-y-4">
            {/* Header with date and status */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4" />
                  <span>
                    {format(new Date(entry.createdAt), "yyyy年M月d日", { locale: ja })}
                  </span>
                </div>
                {entry.duration && (
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4" />
                    <span>{Math.floor(entry.duration / 60)}分{entry.duration % 60}秒</span>
                  </div>
                )}
              </div>

              {entry.status === "completed" && entry.notionPageUrl && (
                <a
                  href={entry.notionPageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <span className="text-label">Notionで開く</span>
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>

            {/* Tags */}
            {entry.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {entry.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            {/* Transcribed text */}
            {entry.transcribedText && (
              <div className="prose prose-sm max-w-none">
                <div className="text-foreground leading-relaxed whitespace-pre-wrap">
                  {entry.transcribedText.length > 500
                    ? `${entry.transcribedText.substring(0, 500)}...`
                    : entry.transcribedText}
                </div>
              </div>
            )}

            {/* Status indicator */}
            {entry.status !== "completed" && (
              <div className="space-y-2">
                <Badge variant="outline" className="text-sm">
                  {entry.status === "processing" && "処理中..."}
                  {entry.status === "uploading" && "アップロード中..."}
                  {entry.status === "failed" && "失敗"}
                </Badge>
                {entry.status === "failed" && entry.errorMessage && (
                  <p className="text-xs text-destructive">
                    エラー: {entry.errorMessage}
                  </p>
                )}
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
