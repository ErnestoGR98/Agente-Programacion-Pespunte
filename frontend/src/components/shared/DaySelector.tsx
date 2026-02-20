'use client'

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

interface DaySelectorProps {
  dayNames: string[]
  selectedDay: string
  onDayChange: (day: string) => void
  className?: string
}

export function DaySelector({ dayNames, selectedDay, onDayChange, className }: DaySelectorProps) {
  return (
    <Select value={selectedDay} onValueChange={onDayChange}>
      <SelectTrigger className={className ?? 'w-40'}>
        <SelectValue placeholder="Dia..." />
      </SelectTrigger>
      <SelectContent>
        {dayNames.map((d) => (
          <SelectItem key={d} value={d}>{d}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
