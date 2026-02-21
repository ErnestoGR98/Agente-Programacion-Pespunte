'use client'

import { useState, useMemo } from 'react'
import { useAppStore } from '@/lib/store/useAppStore'
import { KpiCard } from '@/components/shared/KpiCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { DaySelector } from '@/components/shared/DaySelector'
import { STAGE_COLORS, BLOCK_LABELS, DAY_NAMES } from '@/types'
import type { DailyResult } from '@/types'

const DAY_ORDER = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab']

export default function ProgramaPage() {
  const result = useAppStore((s) => s.currentResult)
  const [selectedDay, setSelectedDay] = useState<string>('')

  const dayNames = useMemo(() => {
    if (!result?.daily_results) return []
    const keys = Object.keys(result.daily_results)
    return DAY_ORDER.filter((d) => keys.includes(d))
  }, [result])

  const day = selectedDay || dayNames[0] || ''
  const dayData = result?.daily_results?.[day]

  if (!result) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Ejecuta una optimizacion para ver el programa diario.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Programa Diario</h1>
          <p className="text-sm text-muted-foreground">{result.nombre}</p>
        </div>
        <DaySelector dayNames={dayNames} selectedDay={day} onDayChange={setSelectedDay} />
      </div>

      {dayData && <DayView dayName={day} data={dayData} />}
    </div>
  )
}

function DayView({ dayName, data }: { dayName: string; data: DailyResult }) {
  const schedule = data.schedule || []

  const totalPares = data.total_pares || 0
  const tardiness = data.total_tardiness || 0
  const plantilla = data.plantilla || 0
  const status = data.status || '?'
  const maxHc = schedule.reduce((max, s) => Math.max(max, s.hc), 0)
  const unassignedCount = (data.unassigned_ops || []).length

  // Detect block labels from first schedule entry with blocks
  const blockLabels = useMemo(() => {
    const maxBlocks = schedule.reduce((max, s) => Math.max(max, s.blocks?.length || 0), 0)
    return BLOCK_LABELS.slice(0, maxBlocks || 10)
  }, [schedule])

  function getEtapaColor(etapa: string): string {
    if (!etapa) return '#94A3B8'
    if (etapa.includes('PRELIMINAR') || etapa.includes('PRE')) return STAGE_COLORS.PRELIMINAR
    if (etapa.includes('ROBOT')) return STAGE_COLORS.ROBOT
    if (etapa.includes('POST')) return STAGE_COLORS.POST
    return '#94A3B8'
  }

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-5 gap-4">
        <KpiCard label="Pares del Dia" value={totalPares.toLocaleString()} />
        <KpiCard label="HC Maximo" value={maxHc} />
        <KpiCard label="Plantilla" value={plantilla} />
        <KpiCard
          label="Estado"
          value={status}
          detail={tardiness > 0 ? `${tardiness} pares pendientes` : undefined}
        />
        <KpiCard
          label="Sin Operario"
          value={unassignedCount}
          detail={unassignedCount > 0 ? 'operaciones sin asignar' : 'todo asignado'}
        />
      </div>

      {/* Legend */}
      <div className="flex gap-4">
        {Object.entries(STAGE_COLORS).map(([name, color]) => (
          <div key={name} className="flex items-center gap-1">
            <div className="h-3 w-3 rounded" style={{ backgroundColor: color }} />
            <span className="text-xs">{name}</span>
          </div>
        ))}
      </div>

      {/* Schedule table */}
      <Card>
        <CardContent className="pt-4 overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-1 text-left">MODELO</th>
                <th className="px-2 py-1 text-left">FRACC</th>
                <th className="px-2 py-1 text-left">OPERACION</th>
                <th className="px-2 py-1 text-left">RECURSO</th>
                <th className="px-2 py-1 text-left">OPERARIO</th>
                <th className="px-2 py-1 text-right">RATE</th>
                <th className="px-2 py-1 text-right">HC</th>
                {blockLabels.map((b) => (
                  <th key={b} className="px-1 py-1 text-center w-12">{b}</th>
                ))}
                <th className="px-2 py-1 text-right font-bold">TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {schedule.map((s, i) => {
                const bgColor = getEtapaColor(s.etapa)
                return (
                  <tr key={i} className="border-b hover:bg-accent/30">
                    <td className="px-2 py-1 font-mono font-medium">{s.modelo}</td>
                    <td className="px-2 py-1">{s.fraccion}</td>
                    <td className="px-2 py-1 max-w-[120px] truncate">{s.operacion}</td>
                    <td className="px-2 py-1">
                      <Badge variant="outline" className="text-[10px]">{s.recurso}</Badge>
                    </td>
                    <td className="px-2 py-1">
                      {s.operario === 'SIN ASIGNAR' ? (
                        <span className="text-[10px] font-medium text-destructive">SIN ASIGNAR</span>
                      ) : s.operario ? (
                        <span className="text-[10px] font-medium">{s.operario}</span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">{s.rate}</td>
                    <td className="px-2 py-1 text-right">{s.hc}</td>
                    {(s.blocks || []).map((val, bi) => (
                      <td
                        key={bi}
                        className="px-1 py-1 text-center"
                        style={{
                          backgroundColor: val > 0 ? `${bgColor}30` : undefined,
                          color: val > 0 ? bgColor : undefined,
                          fontWeight: val > 0 ? 600 : 400,
                        }}
                      >
                        {val > 0 ? val : ''}
                      </td>
                    ))}
                    <td className="px-2 py-1 text-right font-bold">{s.total}</td>
                  </tr>
                )
              })}
              {schedule.length === 0 && (
                <tr>
                  <td colSpan={blockLabels.length + 8} className="text-center text-muted-foreground py-8">
                    Sin operaciones para este dia.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
