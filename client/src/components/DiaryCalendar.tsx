import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface DiaryCalendarProps {
  onDateClick: (date: string) => void; // YYYY-MM-DD format
}

export function DiaryCalendar({ onDateClick }: DiaryCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  
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
  
  // Navigate to previous month
  const goToPrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };
  
  // Navigate to next month
  const goToNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
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
          
          return (
            <button
              key={index}
              onClick={() => onDateClick(day.dateString)}
              className={`
                aspect-square flex items-center justify-center rounded-md text-sm
                transition-colors
                ${isCurrentMonth ? 'text-foreground hover:bg-accent' : 'text-muted-foreground hover:bg-accent/50'}
                ${isToday ? 'bg-primary text-primary-foreground font-bold hover:bg-primary/90' : ''}
              `}
            >
              {day.date}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
