import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Calendar } from "lucide-react";

export type DiaryData = {
  recordingId?: number;
  title: string;
  content: string;
  tags: string[];
  date: string; // ISO date string
};

type DiaryEditorProps = {
  initialData: DiaryData;
  onSave: (data: DiaryData) => Promise<void>;
  onCancel: () => void;
  isSaving: boolean;
};

const AVAILABLE_TAGS = ["仕事", "プライベート", "健康", "学習", "趣味", "食事"];

export function DiaryEditor({ initialData, onSave, onCancel, isSaving }: DiaryEditorProps) {
  const [title, setTitle] = useState(initialData.title);
  const [content, setContent] = useState(initialData.content);
  const [tags, setTags] = useState<string[]>(initialData.tags);
  const [date, setDate] = useState(() => {
    // Convert ISO string to YYYY-MM-DD format for input[type="date"]
    const d = new Date(initialData.date);
    return d.toISOString().split('T')[0];
  });

  const handleToggleTag = (tag: string) => {
    setTags(prev =>
      prev.includes(tag)
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  };

  const handleSave = async () => {
    // Send date string directly (YYYY-MM-DD format)
    // Server will handle JST timezone conversion
    await onSave({
      recordingId: initialData.recordingId,
      title,
      content,
      tags,
      date, // Send YYYY-MM-DD string directly
    });
  };

  return (
    <Card className="p-6 space-y-6">
      <div className="space-y-2">
        <Label htmlFor="title">タイトル</Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="日記のタイトル"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="content">本文</Label>
        <Textarea
          id="content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="今日の出来事を書いてください..."
          rows={12}
          className="font-mono text-sm"
        />
      </div>

      <div className="space-y-2">
        <Label>タグ</Label>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {AVAILABLE_TAGS.map((tag) => (
            <label
              key={tag}
              className="flex items-center space-x-2 cursor-pointer"
            >
              <Checkbox
                checked={tags.includes(tag)}
                onCheckedChange={() => handleToggleTag(tag)}
              />
              <span className="text-sm">{tag}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="date" className="flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          日付（録音日）
        </Label>
        <Input
          id="date"
          type="date"
          value={date}
          readOnly
          disabled
          className="w-full bg-muted cursor-not-allowed"
        />
      </div>

      <div className="flex gap-3 pt-4">
        <Button
          onClick={handleSave}
          disabled={isSaving || !title.trim() || !content.trim()}
          className="flex-1"
        >
          {isSaving ? "保存中..." : "Notionに登録"}
        </Button>
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={isSaving}
        >
          キャンセル
        </Button>
      </div>
    </Card>
  );
}
