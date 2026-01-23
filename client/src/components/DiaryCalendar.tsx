import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

interface DiaryEntry {
  pageId: string;
  pageUrl: string;
  title: string;
  content: string;
  tags: string[];
  date: string;
}

interface DiaryCalendarProps {
  diaryEntries: DiaryEntry[];
  isLoading: boolean;
  onMonthChange: (year: number, month: number) => void;
}

export function DiaryCalendar({ diaryEntries, isLoading, onMonthChange }: DiaryCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedEntry, setSelectedEntry] = useState<DiaryEntry | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  
  // Get current month and year
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth(); // 0-indexed
  
  // Get first day of the month (0 = Sunday, 6 = Saturday)
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  
  // Get number of days in the month
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  // Get number of days in previous month
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  
  // Generate calendar days
  const calendarDays: Array<{ date: number; month: 'prev' | 'current' | 'next'; dateString: string }> = [];
  
  // Previous month days
  for (let i = firstDayOfMonth - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    const dateString = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    calendarDays.push({ date: day, month: 'prev', dateString });
  }
  
  // Current month days
  for (let day = 1; day <= daysInMonth; day++) {
    const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    calendarDays.push({ date: day, month: 'current', dateString });
  }
  
  // Next month days to fill the grid (6 rows x 7 days = 42 days)
  const remainingDays = 42 - calendarDays.length;
  for (let day = 1; day <= remainingDays; day++) {
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    const dateString = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    calendarDays.push({ date: day, month: 'next', dateString });
  }
  
  // Notify parent of month change
  useEffect(() => {
    onMonthChange(year, month + 1); // month is 0-indexed, so add 1
  }, [year, month, onMonthChange]);

  // Navigate to previous month
  const goToPrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };
  
  // Navigate to next month
  const goToNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };
  
  // Create a map of date strings to diary entries
  const diaryMap = new Map<string, DiaryEntry>();
  for (const entry of diaryEntries) {
    diaryMap.set(entry.date, entry);
  }
  
  // Handle date click
  const handleDateClick = (dateString: string, isCurrentMonth: boolean) => {
    if (!isCurrentMonth) return; // Ignore clicks on other months
    
    const entry = diaryMap.get(dateString);
    if (entry) {
      setSelectedEntry(entry);
      setIsDialogOpen(true);
    }
  };
  
  // Month names in Japanese
  const monthNames = [
    '1月', '2月', '3月', '4月', '5月', '6月',
    '7月', '8月', '9月', '10月', '11月', '12月'
  ];
  
  // Day names in Japanese
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  
  // Get today's date string
  const today = new Date();
  const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  
  return (
    <Card className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={goToPrevMonth}
          className="h-8 w-8"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        
        <h3 className="text-lg font-semibold">
          {year}年 {monthNames[month]}
        </h3>
        
        <Button
          variant="ghost"
          size="icon"
          onClick={goToNextMonth}
          className="h-8 w-8"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      
      {/* Day names */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {dayNames.map((day, index) => (
          <div
            key={index}
            className="text-center text-sm font-medium text-muted-foreground py-2"
          >
            {day}
          </div>
        ))}
      </div>
      
      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {calendarDays.map((day, index) => {
          const isToday = day.dateString === todayString;
          const isCurrentMonth = day.month === 'current';
          
          const hasDiary = diaryMap.has(day.dateString);
          const isClickable = isCurrentMonth && hasDiary;
          
          return (
            <button
              key={index}
              onClick={() => handleDateClick(day.dateString, isCurrentMonth)}
              disabled={!isClickable}
              className={`
                aspect-square flex items-center justify-center rounded-md text-sm
                transition-colors relative
                ${
                  isToday
                    ? 'bg-primary text-primary-foreground font-bold hover:bg-primary/90'
                    : hasDiary && isCurrentMonth
                    ? 'bg-accent text-accent-foreground hover:bg-accent/80 cursor-pointer'
                    : isCurrentMonth
                    ? 'text-muted-foreground/50 cursor-not-allowed'
                    : 'text-muted-foreground/30 cursor-not-allowed'
                }
                ${!isClickable ? 'opacity-50' : ''}
              `}
            >
              {day.date}
              {hasDiary && isCurrentMonth && (
                <span className="absolute bottom-1 w-1 h-1 rounded-full bg-current" />
              )}
            </button>
          );
        })}
      </div>
      
      {/* Diary preview dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>{selectedEntry?.title}</span>
              {selectedEntry && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(selectedEntry.pageUrl, '_blank')}
                  className="gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  Notionで開く
                </Button>
              )}
            </DialogTitle>
            <DialogDescription>
              {selectedEntry?.date}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Tags */}
            {selectedEntry && selectedEntry.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selectedEntry.tags.map((tag, index) => (
                  <Badge key={index} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
            
            {/* Content */}
            <div className="prose prose-sm max-w-none">
              <p className="whitespace-pre-wrap">{selectedEntry?.content}</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
