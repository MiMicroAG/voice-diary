import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";

interface TextInputDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (text: string) => Promise<void>;
}

export function TextInputDialog({ open, onClose, onSubmit }: TextInputDialogProps) {
  const [text, setText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async () => {
    if (!text.trim()) return;
    
    setIsProcessing(true);
    try {
      await onSubmit(text);
      setText("");
      onClose();
    } catch (error) {
      console.error("Failed to process text:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    if (!isProcessing) {
      setText("");
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>日記を入力</DialogTitle>
          <DialogDescription>
            今日の出来事や感想を自由に入力してください。AIが内容を整理して日記として保存します。
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <Textarea
            placeholder="例：今日は朝から雨が降っていた。午後に友達とカフェで会って、新しいプロジェクトについて話し合った。帰りにスーパーで買い物をして、夕食はカレーを作った。"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-[200px] resize-none"
            disabled={isProcessing}
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isProcessing}
          >
            キャンセル
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!text.trim() || isProcessing}
          >
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                解析中...
              </>
            ) : (
              "解析して確認"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
