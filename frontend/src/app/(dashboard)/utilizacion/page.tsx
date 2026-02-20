'use client'

import { useState, useMemo } from 'react'
import { useAppStore } from '@/lib/store/useAppStore'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import type { DailyResult } from '@/types'

const BLOCK_LABELS = [
  '8-9', '9-10', '10-11', '11-12', '12-1:10',
  '1:50-2', '2-3', '3-4', '4-5', '5-6',
]

export default function UtilizacionPage() {
  const result = useAppStore((s) => s.currentResult)
  const [selectedDay, setSelectedDay] = useState('')

  const dayNames = useMemo(() => {
    if (!result?.daily_results) return []
    return Object.keys(result.daily_results)
  }, [result])

  if (!result) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Ejecuta una optimizacion para ver la utilizacion HC.
      </div>
    )
  }

  const day = selectedDay || dayNames[0] || ''

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Utilizacion HC</h1>
        <p className="text-sm text-muted-foreground">Mapa de calor y carga por bloque.</p>
      </div>

      {/* Weekly Heatmap */}
      <WeeklyHeatmap dailyResults={result.daily_results} dayNames={dayNames} />

      {/* Day selector */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">Dia:</span>
        <Select value={day} onValueChange={setSelectedDay}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {dayNames.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* HC per block chart */}
      {day && <HcBlockChart dayData={result.daily_results[day]} dayName={day} />}
    </div>
  )
}

// ============================================================
// Weekly Heatmap (CSS Grid)
// ============================================================

function WeeklyHeatmap({
  dailyResults,
  dayNames,
}: {
  dailyResults: Record<string, DailyResult>
  dayNames: string[]
}) {
  // Build heatmap data: for each day x block, compute HC utilization %
  const cells = useMemo(() => {
    const result: Array<{ day: string; block: string; value: number }> = []
    for (const day of dayNames) {
      const data = dailyResults[day]
      const schedule = data?.schedule || []
      const plantilla = data?.plantilla || 1

      for (let b = 0; b < BLOCK_LABELS.length; b++) {
        const hcUsed = schedule.reduce((sum, s) => {
          return sum + ((s.blocks?.[b] || 0) > 0 ? s.hc : 0)
        }, 0)
        const pct = Math.round((hcUsed / plantilla) * 100)
        result.push({ day, block: BLOCK_LABELS[b], value: pct })
      }
    }
    return result
  }, [dailyResults, dayNames])

  function getColor(pct: number): string {
    if (pct === 0) return '#F3F4F6'
    if (pct < 50) return '#BBF7D0'
    if (pct < 80) return '#FDE68A'
    if (pct < 100) return '#FDBA74'
    return '#FCA5A5'
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Mapa de Calor: Utilizacion HC</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div className="grid gap-1" style={{
            gridTemplateColumns: `80px repeat(${BLOCK_LABELS.length}, 1fr)`,
          }}>
            {/* Header */}
            <div />
            {BLOCK_LABELS.map((b) => (
              <div key={b} className="text-center text-[10px] font-medium text-muted-foreground py-1">
                {b}
              </div>
            ))}

            {/* Rows */}
            {dayNames.map((day) => (
              <>
                <div key={`label-${day}`} className="flex items-center text-xs font-medium">
                  {day}
                </div>
                {BLOCK_LABELS.map((block) => {
                  const cell = cells.find((c) => c.day === day && c.block === block)
                  const pct = cell?.value || 0
                  return (
                    <div
                      key={`${day}-${block}`}
                      className="flex items-center justify-center rounded text-[10px] font-medium h-8"
                      style={{ backgroundColor: getColor(pct) }}
                      title={`${day} ${block}: ${pct}%`}
                    >
                      {pct > 0 ? `${pct}%` : ''}
                    </div>
                  )
                })}
              </>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================
// HC per Block Chart
// ============================================================

function HcBlockChart({ dayData, dayName }: { dayData: DailyResult; dayName: string }) {
  const schedule = dayData?.schedule || []
  const plantilla = dayData?.plantilla || 0

  const chartData = useMemo(() => {
    return BLOCK_LABELS.map((label, b) => {
      const entry: Record<string, string | number> = { bloque: label }
      const models = [...new Set(schedule.map((s) => s.modelo))]
      for (const m of models) {
        const ops = schedule.filter((s) => s.modelo === m)
        const hc = ops.reduce((sum, s) => sum + ((s.blocks?.[b] || 0) > 0 ? s.hc : 0), 0)
        if (hc > 0) entry[m] = hc
      }
      return entry
    })
  }, [schedule])

  const models = [...new Set(schedule.map((s) => s.modelo))]
  const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316']

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">HC por Bloque — {dayName}</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bloque" tick={{ fontSize: 10 }} />
            <YAxis />
            <Tooltip />
            <Legend />
            {models.map((m, i) => (
              <Bar key={m} dataKey={m} stackId="a" fill={colors[i % colors.length]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
