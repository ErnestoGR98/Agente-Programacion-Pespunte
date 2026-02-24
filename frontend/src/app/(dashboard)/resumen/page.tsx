'use client'

import { useMemo, useState, useEffect } from 'react'
import { useAppStore } from '@/lib/store/useAppStore'
import { supabase } from '@/lib/supabase/client'
import { KpiCard } from '@/components/shared/KpiCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { DAY_ORDER } from '@/types'
import type { WeeklyScheduleEntry } from '@/types'
import { Truck } from 'lucide-react'

export default function ResumenPage() {
  const result = useAppStore((s) => s.currentResult)
  const [maquilaFabricas, setMaquilaFabricas] = useState<Set<string>>(new Set())

  useEffect(() => {
    supabase
      .from('fabricas')
      .select('nombre')
      .eq('es_maquila', true)
      .then(({ data }) => {
        setMaquilaFabricas(new Set((data || []).map((f: { nombre: string }) => f.nombre)))
      })
  }, [])

  if (!result) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Ejecuta una optimizacion para ver el resumen semanal.
      </div>
    )
  }

  const summary = result.weekly_summary
  const schedule = result.weekly_schedule

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Resumen Semanal</h1>
        <p className="text-sm text-muted-foreground">
          Resultado: <Badge variant="secondary">{result.nombre}</Badge>
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard label="Total Pares" value={summary.total_pares?.toLocaleString() || '0'} />
        <KpiCard label="Estado" value={summary.status || 'N/A'} />
        <KpiCard label="Pendientes (Tardiness)" value={summary.total_tardiness || 0} />
        <KpiCard label="Tiempo Solver" value={`${(summary.wall_time_s || 0).toFixed(1)}s`} />
      </div>

      {/* Pivot table */}
      <PivotTable schedule={schedule} maquilaFabricas={maquilaFabricas} />

      {/* Balance chart */}
      <BalanceChart summary={summary} />

      {/* Models detail */}
      <ModelsDetail summary={summary} />
    </div>
  )
}

// ============================================================
// Pivot Table: Modelo x Dia
// ============================================================

function PivotTable({ schedule, maquilaFabricas }: { schedule: WeeklyScheduleEntry[]; maquilaFabricas: Set<string> }) {
  const pivot = useMemo(() => {
    const rawDays = [...new Set(schedule.map((e) => e.Dia))]
    const days = DAY_ORDER.filter((d) => rawDays.includes(d))
    const models = [...new Set(schedule.map((e) => `${e.Fabrica}|${e.Modelo}`))]

    const data = models.map((key) => {
      const [fabrica, modelo] = key.split('|')
      const row: Record<string, string | number> = { fabrica, modelo }
      let total = 0
      for (const day of days) {
        const entry = schedule.find((e) => e.Dia === day && e.Modelo === modelo && e.Fabrica === fabrica)
        const pares = entry?.Pares || 0
        row[day] = pares
        total += pares
      }
      row.total = total
      return row
    })

    return { days, data }
  }, [schedule])

  if (schedule.length === 0) return null

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Asignacion Semanal</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fabrica</TableHead>
              <TableHead>Modelo</TableHead>
              {pivot.days.map((d) => <TableHead key={d} className="text-center">{d}</TableHead>)}
              <TableHead className="text-center font-bold">TOTAL</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pivot.data.map((row, i) => {
              const isMaquila = maquilaFabricas.has(row.fabrica as string)
              return (
              <TableRow key={i} className={isMaquila ? 'bg-destructive/5' : ''}>
                <TableCell className="text-xs">
                  <span className="flex items-center gap-1">
                    {isMaquila && <Truck className="h-3 w-3 text-destructive shrink-0" />}
                    <span className={isMaquila ? 'text-destructive' : ''}>{row.fabrica}</span>
                  </span>
                </TableCell>
                <TableCell className="font-mono">{row.modelo}</TableCell>
                {pivot.days.map((d) => (
                  <TableCell key={d} className="text-center">
                    {row[d] || ''}
                  </TableCell>
                ))}
                <TableCell className="text-center font-bold">{row.total}</TableCell>
              </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// ============================================================
// Balance Chart: HC Necesario vs Disponible
// ============================================================

function BalanceChart({ summary }: { summary: { days?: Array<{ dia: string; hc_necesario: number; hc_disponible: number; utilizacion_pct: number }> } }) {
  const days = summary.days || []
  if (days.length === 0) return null

  const chartData = days.map((d) => ({
    dia: d.dia,
    'HC Necesario': d.hc_necesario,
    'HC Disponible': d.hc_disponible,
    utilizacion: d.utilizacion_pct,
  }))

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Balance HC por Dia</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="dia" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="HC Necesario" fill="#3B82F6" />
            <Bar dataKey="HC Disponible" fill="#D1D5DB" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

// ============================================================
// Models Detail Table
// ============================================================

function ModelsDetail({ summary }: { summary: { models?: Array<{ codigo: string; volumen: number; producido: number; tardiness: number; pct_completado: number }> } }) {
  const models = summary.models || []
  if (models.length === 0) return null

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Detalle por Modelo</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Modelo</TableHead>
              <TableHead>Volumen</TableHead>
              <TableHead>Producido</TableHead>
              <TableHead>Pendiente</TableHead>
              <TableHead>Completado</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.map((m) => (
              <TableRow key={m.codigo}>
                <TableCell className="font-mono">{m.codigo}</TableCell>
                <TableCell>{m.volumen}</TableCell>
                <TableCell>{m.producido}</TableCell>
                <TableCell className={m.tardiness > 0 ? 'text-destructive font-bold' : ''}>
                  {m.tardiness}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Progress value={m.pct_completado} className="h-2 w-20" />
                    <span className="text-xs">{m.pct_completado}%</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={m.tardiness > 0 ? 'destructive' : 'default'}>
                    {m.tardiness > 0 ? 'INCOMPLETO' : 'OK'}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
