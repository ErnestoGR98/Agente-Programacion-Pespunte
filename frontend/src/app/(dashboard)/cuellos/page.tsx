'use client'

import { useMemo } from 'react'
import { useAppStore } from '@/lib/store/useAppStore'
import { KpiCard } from '@/components/shared/KpiCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react'
import { useCatalogoImages, getModeloImageUrl } from '@/lib/hooks/useCatalogoImages'
import { BLOCK_LABELS, DEFAULT_CAPACITIES, CHART_COLORS } from '@/types'

interface Alert {
  level: 'error' | 'warning'
  message: string
}

interface ActiveConstraint {
  dia: string
  bloque: string
  restriccion: string
  capacidad: number
  carga: number
  uso_pct: number
}

interface ModelWorkload {
  modelo: string
  volumen: number
  sec_par: number
  min_total: number
  hc_horas: number
  num_ops: number
}

export default function CuellosPage() {
  const result = useAppStore((s) => s.currentResult)
  const catImages = useCatalogoImages()

  const alerts = useMemo(() => {
    if (!result) return []
    const list: Alert[] = []

    // Incomplete models (tardiness)
    const models = result.weekly_summary?.models || []
    for (const m of models) {
      if (m.tardiness > 0) {
        list.push({
          level: 'error',
          message: `Modelo ${m.codigo}: ${m.tardiness} pares sin programar (${m.pct_completado}% completado)`,
        })
      }
    }

    // Days with tardiness or HC overflow
    if (result.daily_results) {
      for (const [dayName, dayData] of Object.entries(result.daily_results)) {
        if (dayData.total_tardiness > 0) {
          list.push({
            level: 'warning',
            message: `${dayName}: ${dayData.total_tardiness} pares de tardiness diaria`,
          })
        }

        const schedule = dayData.schedule || []
        const plantilla = dayData.plantilla || 0
        if (plantilla > 0) {
          for (let b = 0; b < BLOCK_LABELS.length; b++) {
            const hcUsed = schedule.reduce((sum, s) => sum + ((s.blocks?.[b] || 0) > 0 ? s.hc : 0), 0)
            if (hcUsed > plantilla) {
              list.push({
                level: 'warning',
                message: `${dayName} bloque ${BLOCK_LABELS[b]}: HC ${hcUsed} excede plantilla ${plantilla}`,
              })
              break
            }
          }
        }
      }
    }

    return list
  }, [result])

  const activeConstraints = useMemo(() => {
    if (!result?.daily_results) return []
    const constraints: ActiveConstraint[] = []

    for (const [dayName, dayData] of Object.entries(result.daily_results)) {
      const schedule = dayData.schedule || []
      const plantilla = dayData.plantilla || 0

      for (let b = 0; b < BLOCK_LABELS.length; b++) {
        // HC constraint
        if (plantilla > 0) {
          const hcUsed = schedule.reduce((sum, s) => sum + ((s.blocks?.[b] || 0) > 0 ? s.hc : 0), 0)
          const pct = Math.round((hcUsed / plantilla) * 100)
          if (pct > 70) {
            constraints.push({
              dia: dayName, bloque: BLOCK_LABELS[b], restriccion: 'HEADCOUNT',
              capacidad: plantilla, carga: hcUsed, uso_pct: pct,
            })
          }
        }

        // Resource constraints
        const resourceLoad = new Map<string, number>()
        for (const s of schedule) {
          const val = s.blocks?.[b] || 0
          if (val > 0) {
            resourceLoad.set(s.recurso, (resourceLoad.get(s.recurso) || 0) + val)
          }
        }

        for (const [recurso, load] of resourceLoad) {
          const cap = DEFAULT_CAPACITIES[recurso] || 10
          const pct = Math.round((load / cap) * 100)
          if (pct > 70) {
            constraints.push({
              dia: dayName, bloque: BLOCK_LABELS[b], restriccion: recurso,
              capacidad: cap, carga: load, uso_pct: pct,
            })
          }
        }
      }
    }

    return constraints.sort((a, b) => b.uso_pct - a.uso_pct).slice(0, 20)
  }, [result])

  const modelWorkloads = useMemo(() => {
    if (!result?.daily_results) return []
    const map = new Map<string, ModelWorkload>()

    for (const dayData of Object.values(result.daily_results)) {
      const schedule = dayData.schedule || []

      for (const s of schedule) {
        const existing = map.get(s.modelo) || {
          modelo: s.modelo, volumen: 0, sec_par: 0, min_total: 0, hc_horas: 0, num_ops: 0,
        }
        const secPerPair = s.rate > 0 ? 3600 / s.rate : 0
        existing.volumen += s.total
        existing.sec_par = secPerPair
        existing.min_total += (s.total * secPerPair) / 60
        existing.num_ops += 1
        const activeBlocks = (s.blocks || []).filter((v: number) => v > 0).length
        existing.hc_horas += activeBlocks * s.hc
        map.set(s.modelo, existing)
      }
    }

    return Array.from(map.values()).sort((a, b) => b.hc_horas - a.hc_horas)
  }, [result])

  if (!result) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Ejecuta una optimizacion para ver cuellos de botella.
      </div>
    )
  }

  const errorCount = alerts.filter((a) => a.level === 'error').length
  const warningCount = alerts.filter((a) => a.level === 'warning').length
  const criticalConstraints = activeConstraints.filter((c) => c.uso_pct >= 100).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cuellos de Botella</h1>
        <p className="text-sm text-muted-foreground">Alertas, restricciones activas y carga de trabajo.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard label="Alertas Criticas" value={errorCount} />
        <KpiCard label="Advertencias" value={warningCount} />
        <KpiCard label="Restricciones >70%" value={activeConstraints.length} />
        <KpiCard label="Restricciones Criticas" value={criticalConstraints} />
      </div>

      {/* Alerts */}
      <Card>
        <CardHeader><CardTitle className="text-base">Alertas</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {alerts.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle className="h-4 w-4" />
              No se detectaron cuellos de botella criticos.
            </div>
          )}
          {alerts.map((a, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              {a.level === 'error' ? (
                <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
              )}
              <span className={a.level === 'error' ? 'text-destructive' : 'text-yellow-700'}>
                {a.message}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Active Constraints */}
      {activeConstraints.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Restricciones Mas Activas (Top 20)</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dia</TableHead>
                  <TableHead>Bloque</TableHead>
                  <TableHead>Restriccion</TableHead>
                  <TableHead className="text-right">Capacidad</TableHead>
                  <TableHead className="text-right">Carga</TableHead>
                  <TableHead className="text-right">Uso %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeConstraints.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs">{c.dia}</TableCell>
                    <TableCell className="text-xs">{c.bloque}</TableCell>
                    <TableCell>
                      <Badge
                        variant={c.uso_pct >= 100 ? 'destructive' : 'outline'}
                        className="text-[10px]"
                      >
                        {c.restriccion}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{c.capacidad}</TableCell>
                    <TableCell className="text-right">{c.carga}</TableCell>
                    <TableCell className="text-right">
                      <span
                        className="font-bold"
                        style={{
                          color: c.uso_pct >= 100 ? '#C0392B'
                            : c.uso_pct >= 85 ? '#D4A017'
                            : '#2C3E50',
                        }}
                      >
                        {c.uso_pct}%
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Model Workload */}
      {modelWorkloads.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Modelos por Carga de Trabajo</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Modelo</TableHead>
                  <TableHead className="text-right">Volumen</TableHead>
                  <TableHead className="text-right">Seg/Par</TableHead>
                  <TableHead className="text-right">Min Total</TableHead>
                  <TableHead className="text-right">HC-Horas</TableHead>
                  <TableHead className="text-right">Num Ops</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modelWorkloads.map((m) => (
                  <TableRow key={m.modelo}>
                    <TableCell className="font-mono">
                      <span className="flex items-center gap-1">
                        {(() => { const u = getModeloImageUrl(catImages, m.modelo); return u ? <img src={u} alt={m.modelo} className="h-6 w-auto rounded border object-contain bg-white" /> : null })()}
                        {m.modelo}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{m.volumen}</TableCell>
                    <TableCell className="text-right">{m.sec_par.toFixed(1)}</TableCell>
                    <TableCell className="text-right">{Math.round(m.min_total).toLocaleString()}</TableCell>
                    <TableCell className="text-right font-bold">{m.hc_horas.toFixed(1)}</TableCell>
                    <TableCell className="text-right">{m.num_ops}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={modelWorkloads} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="modelo" type="category" width={80} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="hc_horas" fill={CHART_COLORS[0]} name="HC-Horas" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
