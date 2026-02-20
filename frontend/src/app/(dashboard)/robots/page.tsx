'use client'

import { useState, useMemo } from 'react'
import { useAppStore } from '@/lib/store/useAppStore'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import type { DailyResult } from '@/types'

const BLOCK_LABELS = [
  '8-9', '9-10', '10-11', '11-12', '12-1:10',
  '1:50-2', '2-3', '3-4', '4-5', '5-6',
]

interface RobotUsage {
  nombre: string
  totalPares: number
  totalOps: number
  models: string[]
  days: string[]
  pctUtil: number
}

export default function RobotsPage() {
  const result = useAppStore((s) => s.currentResult)
  const [selectedDay, setSelectedDay] = useState('')

  const dayNames = useMemo(() => {
    if (!result?.daily_results) return []
    return Object.keys(result.daily_results)
  }, [result])

  // Aggregate robot usage across all days
  const robotUsage = useMemo(() => {
    if (!result?.daily_results) return []
    const map = new Map<string, RobotUsage>()

    for (const [dayName, dayData] of Object.entries(result.daily_results)) {
      const schedule = dayData.schedule || [] as Array<{
        modelo: string; recurso: string; robot?: string; blocks: number[]; total: number
      }>

      for (const s of schedule) {
        if (s.recurso !== 'ROBOT' || !s.robot) continue
        const existing = map.get(s.robot) || {
          nombre: s.robot, totalPares: 0, totalOps: 0,
          models: [], days: [], pctUtil: 0,
        }
        existing.totalPares += s.total
        existing.totalOps += 1
        if (!existing.models.includes(s.modelo)) existing.models.push(s.modelo)
        if (!existing.days.includes(dayName)) existing.days.push(dayName)
        map.set(s.robot, existing)
      }
    }

    // Calculate utilization (blocks used / total available blocks)
    const totalBlocks = dayNames.length * BLOCK_LABELS.length
    for (const robot of map.values()) {
      // Estimate blocks used from ops * avg blocks per op
      const blocksUsed = robot.totalOps * 5 // rough estimate
      robot.pctUtil = totalBlocks > 0 ? Math.min(100, Math.round((blocksUsed / totalBlocks) * 100)) : 0
    }

    return Array.from(map.values()).sort((a, b) => b.totalPares - a.totalPares)
  }, [result, dayNames])

  if (!result) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Ejecuta una optimizacion para ver los robots.
      </div>
    )
  }

  const day = selectedDay || dayNames[0] || ''

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Robots</h1>
        <p className="text-sm text-muted-foreground">Utilizacion de robots fisicos.</p>
      </div>

      {/* Weekly utilization chart */}
      {robotUsage.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Utilizacion Semanal de Robots</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={robotUsage} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" domain={[0, 'dataMax']} />
                <YAxis dataKey="nombre" type="category" width={100} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="totalPares" fill="#10B981" name="Pares" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Robot cards */}
      <div className="grid grid-cols-4 gap-3">
        {robotUsage.map((r) => (
          <Card key={r.nombre}>
            <CardContent className="pt-3 pb-2">
              <p className="font-mono font-bold text-sm">{r.nombre}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {r.totalOps} ops | {r.totalPares} pares
              </p>
              <div className="flex flex-wrap gap-1 mt-1">
                {r.models.map((m) => (
                  <Badge key={m} variant="outline" className="text-[10px]">{m}</Badge>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Dias: {r.days.join(', ')}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Day timeline */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">Timeline diario:</span>
        <Select value={day} onValueChange={setSelectedDay}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {dayNames.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {day && <RobotTimeline dayData={result.daily_results[day]} />}
    </div>
  )
}

// ============================================================
// Robot Timeline Heatmap
// ============================================================

function RobotTimeline({ dayData }: { dayData: DailyResult }) {
  const schedule = dayData?.schedule || []

  const robotOps = schedule.filter((s) => s.recurso === 'ROBOT' && s.robot)
  const robots = [...new Set(robotOps.map((s) => s.robot!))]

  if (robots.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin operaciones de robot este dia.</p>
  }

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="grid gap-1" style={{
          gridTemplateColumns: `100px repeat(${BLOCK_LABELS.length}, 1fr)`,
        }}>
          {/* Header */}
          <div />
          {BLOCK_LABELS.map((b) => (
            <div key={b} className="text-center text-[10px] font-medium text-muted-foreground py-1">
              {b}
            </div>
          ))}

          {/* Rows */}
          {robots.map((robot) => {
            const ops = robotOps.filter((s) => s.robot === robot)
            return (
              <>
                <div key={`label-${robot}`} className="flex items-center text-xs font-mono font-medium">
                  {robot}
                </div>
                {BLOCK_LABELS.map((_, bi) => {
                  const op = ops.find((s) => (s.blocks?.[bi] || 0) > 0)
                  const val = op?.blocks?.[bi] || 0
                  return (
                    <div
                      key={`${robot}-${bi}`}
                      className="flex items-center justify-center rounded text-[9px] font-medium h-7"
                      style={{
                        backgroundColor: val > 0 ? '#10B98130' : '#F3F4F6',
                        color: val > 0 ? '#10B981' : undefined,
                      }}
                      title={val > 0 ? `${op?.modelo} - ${val} pares` : ''}
                    >
                      {val > 0 ? `${op?.modelo?.slice(-3)} ${val}` : ''}
                    </div>
                  )
                })}
              </>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
