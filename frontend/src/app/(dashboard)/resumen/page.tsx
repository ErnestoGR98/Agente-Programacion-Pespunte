'use client'

import { useMemo, useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/lib/store/useAppStore'
import { supabase } from '@/lib/supabase/client'
import { KpiCard } from '@/components/shared/KpiCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { DAY_ORDER } from '@/types'
import type { WeeklyScheduleEntry, DailyResult, ScenarioProposals, Scenario } from '@/types'
import { Truck, AlertTriangle, Lightbulb, Clock, Factory, Calendar, ChevronDown, ChevronRight, Loader2, Check } from 'lucide-react'
import { useCatalogoImages, getModeloImageUrl } from '@/lib/hooks/useCatalogoImages'
import { TableExport } from '@/components/shared/TableExport'
import { preloadModeloImages, exportTableWithImagesPDF } from '@/lib/export'
import { proposeScenarios, applyScenario } from '@/lib/api/fastapi'

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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard label="Total Pares" value={summary.total_pares?.toLocaleString() || '0'} />
        <KpiCard label="Estado" value={summary.status || 'N/A'} />
        <KpiCard label="Pendientes (Tardiness)" value={summary.total_tardiness || 0} />
        <KpiCard label="Tiempo Solver" value={`${(summary.wall_time_s || 0).toFixed(1)}s`} />
      </div>

      {/* Scenario planner — deshabilitado temporalmente
      <ScenarioPanel resultName={result.nombre} />
      */}

      {/* Pivot table */}
      <PivotTable schedule={schedule} maquilaFabricas={maquilaFabricas} />

      {/* Balance chart */}
      <BalanceChart summary={summary} dailyResults={result.daily_results} />

      {/* Models detail */}
      <ModelsDetail summary={summary} />
    </div>
  )
}

// ============================================================
// Scenario Planner Panel
// ============================================================

const SCENARIO_ICONS: Record<string, typeof Clock> = {
  SABADO: Calendar,
  OVERTIME: Clock,
  MAQUILA: Factory,
  REORGANIZAR: Lightbulb,
  COMBINACION: Lightbulb,
}

const COST_LABELS = ['', '$', '$$', '$$$']

function ScenarioPanel({ resultName }: { resultName: string }) {
  const [proposals, setProposals] = useState<ScenarioProposals | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const [applied, setApplied] = useState<string | null>(null)
  const [applyResult, setApplyResult] = useState<{ changes: string[]; next_step: string } | null>(null)
  const pedidoNombre = useAppStore((s) => s.currentPedidoNombre) || ''
  const semana = useAppStore((s) => s.currentSemana) || ''

  const loadScenarios = useCallback(async () => {
    setLoading(true)
    try {
      const data = await proposeScenarios(resultName)
      setProposals(data)
      if (data.gaps.total_tardiness > 0 || data.gaps.total_sin_asignar > 0) {
        setExpanded(true)
      }
    } catch (e) {
      console.error('Error loading scenarios:', e)
    } finally {
      setLoading(false)
    }
  }, [resultName])

  useEffect(() => { loadScenarios() }, [loadScenarios])

  if (!proposals) {
    if (loading) return (
      <Card>
        <CardContent className="py-4 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Analizando resultado...
        </CardContent>
      </Card>
    )
    return null
  }

  const { gaps, scenarios } = proposals

  // No gaps = no panel
  if (gaps.total_tardiness === 0 && gaps.total_sin_asignar === 0) return null

  const totalDeficit = gaps.total_tardiness + gaps.total_sin_asignar_pares
  const handleApply = async (scenario: Scenario, idx: number) => {
    const key = `${scenario.tipo}_${idx}`
    setApplying(key)
    try {
      const res = await applyScenario(resultName, pedidoNombre, semana, scenario)
      setApplied(key)
      setApplyResult(res)
    } catch (e) {
      console.error('Error applying scenario:', e)
    } finally {
      setApplying(null)
    }
  }

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="py-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <CardTitle className="text-base">
              Deficit Semanal: {totalDeficit.toLocaleString()}p sin completar
            </CardTitle>
            {gaps.total_sin_asignar > 0 && (
              <Badge variant="outline" className="text-red-500 border-red-500/30">
                {gaps.total_sin_asignar} ops sin asignar
              </Badge>
            )}
          </div>
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-4">
          {/* Gap details by model */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {gaps.by_model.filter(g => g.tardiness > 0 || g.sin_asignar > 0).map((g) => (
              <div key={g.modelo} className="rounded border border-border/50 p-2 text-sm">
                <div className="font-medium">{g.modelo}</div>
                <div className="text-muted-foreground text-xs">
                  {g.tardiness > 0 && <span className="text-amber-500">{g.tardiness}p tardiness</span>}
                  {g.tardiness > 0 && g.sin_asignar > 0 && ' · '}
                  {g.sin_asignar > 0 && <span className="text-red-500">{g.sin_asignar} sin asignar ({g.recurso_faltante})</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Bottlenecks */}
          {gaps.bottlenecks.length > 0 && (
            <div className="text-sm">
              <span className="font-medium text-muted-foreground">Cuellos de botella: </span>
              {gaps.bottlenecks.map((b, i) => (
                <Badge key={i} variant="outline" className="mr-1 text-xs">
                  {b.recurso} ({b.deficit_horas}h deficit)
                </Badge>
              ))}
            </div>
          )}

          {/* Scenarios */}
          {scenarios.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <Lightbulb className="h-4 w-4 text-blue-500" />
                Escenarios para completar
              </div>
              <div className="space-y-2">
                {scenarios.map((s, idx) => {
                  const Icon = SCENARIO_ICONS[s.tipo] || Lightbulb
                  const isApplied = applied === `${s.tipo}_${idx}`
                  const isApplying = applying === `${s.tipo}_${idx}`

                  return (
                    <div
                      key={`${s.tipo}_${idx}`}
                      className={`flex items-center justify-between rounded border p-3 transition-colors ${
                        isApplied ? 'border-green-500/50 bg-green-500/10' : 'border-border/50 hover:border-border'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="text-sm font-medium">{s.descripcion}</div>
                          <div className="text-xs text-muted-foreground">
                            +{s.pares_recuperables.toLocaleString()}p ({s.pct_recuperable}%)
                            <span className="ml-2 text-amber-500">{COST_LABELS[s.costo_relativo]}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Progress value={s.pct_recuperable} className="w-20 h-2" />
                        {isApplied ? (
                          <Badge className="bg-green-600"><Check className="h-3 w-3 mr-1" /> Aplicado</Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!!applying || !!applied}
                            onClick={() => handleApply(s, idx)}
                          >
                            {isApplying ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Aplicar'}
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Apply result */}
          {applyResult && (
            <div className="rounded border border-green-500/30 bg-green-500/10 p-3 text-sm">
              <div className="font-medium text-green-600 mb-1">Escenario aplicado</div>
              <ul className="list-disc list-inside text-muted-foreground text-xs space-y-0.5">
                {applyResult.changes.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
              <div className="mt-2 text-xs font-medium">{applyResult.next_step}</div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}

// ============================================================
// Pivot Table: Modelo x Dia
// ============================================================

function PivotTable({ schedule, maquilaFabricas }: { schedule: WeeklyScheduleEntry[]; maquilaFabricas: Set<string> }) {
  const catImages = useCatalogoImages()
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

  const exportHeaders = ['Fabrica', 'Modelo', ...pivot.days, 'TOTAL']
  const grandTotal = pivot.data.reduce((s, r) => s + (Number(r.total) || 0), 0)
  const exportRows = [
    ...pivot.data.map((row) => [
      row.fabrica, row.modelo, ...pivot.days.map((d) => row[d] || 0), row.total,
    ] as (string | number)[]),
    ['', 'TOTAL', ...pivot.days.map((d) => pivot.data.reduce((s, r) => s + (Number(r[d]) || 0), 0)), grandTotal],
  ]

  async function handlePDF() {
    const modelos = pivot.data.map((r) => String(r.modelo))
    const imgMap = await preloadModeloImages(modelos, catImages, (num, color) =>
      getModeloImageUrl(catImages, num, color)
    )
    exportTableWithImagesPDF('asignacion_semanal', exportHeaders, exportRows, imgMap, 'Modelo')
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Asignacion Semanal</CardTitle>
        <TableExport title="asignacion_semanal" headers={exportHeaders} rows={exportRows} onCustomPDF={handlePDF} />
      </CardHeader>
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
                <TableCell className="font-mono">
                  <span className="flex items-center gap-1">
                    {(() => { const [num, ...c] = String(row.modelo).split(' '); const u = getModeloImageUrl(catImages, num, c.join(' ')); return u ? <img src={u} alt={String(row.modelo)} className="h-6 w-auto rounded border object-contain bg-white" /> : null })()}
                    {row.modelo}
                  </span>
                </TableCell>
                {pivot.days.map((d) => (
                  <TableCell key={d} className="text-center">
                    {row[d] || ''}
                  </TableCell>
                ))}
                <TableCell className="text-center font-bold">{row.total}</TableCell>
              </TableRow>
              )
            })}
            <TableRow className="bg-primary/10 font-bold border-t-2 border-primary/30">
              <TableCell colSpan={2} className="text-right text-primary">TOTAL</TableCell>
              {pivot.days.map((d) => {
                const dayTotal = pivot.data.reduce((s, r) => s + (Number(r[d]) || 0), 0)
                return <TableCell key={d} className="text-center text-primary">{dayTotal || ''}</TableCell>
              })}
              <TableCell className="text-center text-primary">{pivot.data.reduce((s, r) => s + (Number(r.total) || 0), 0).toLocaleString()}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// ============================================================
// Balance Chart: HC Necesario vs Disponible
// ============================================================

function BalanceChart({ summary, dailyResults }: { summary: { days?: Array<{ dia: string; hc_necesario: number; hc_disponible: number; utilizacion_pct: number }> }; dailyResults?: Record<string, DailyResult> }) {
  const days = summary.days || []
  if (days.length === 0) return null

  // Calcular HC pico real por dia: max personas simultaneas en un bloque
  const peakByDay: Record<string, number> = {}
  if (dailyResults) {
    for (const [dayName, dr] of Object.entries(dailyResults)) {
      const schedule = dr.schedule || []
      if (schedule.length === 0) continue
      const numBlocks = Math.max(...schedule.map((s) => (s.blocks || []).length), 0)
      let peak = 0
      for (let b = 0; b < numBlocks; b++) {
        let hcBlock = 0
        for (const s of schedule) {
          const bp = (s.blocks || [])[b] || 0
          if (bp > 0) hcBlock++
        }
        peak = Math.max(peak, hcBlock)
      }
      peakByDay[dayName] = peak
    }
  }

  const chartData = days.map((d) => ({
    dia: d.dia,
    'HC Promedio': d.hc_necesario,
    'HC Pico': peakByDay[d.dia] || Math.ceil(d.hc_necesario),
    'HC Disponible': d.hc_disponible,
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
            <Bar dataKey="HC Promedio" fill="#93C5FD" />
            <Bar dataKey="HC Pico" fill="#3B82F6" />
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
  const catImages = useCatalogoImages()
  const models = summary.models || []
  if (models.length === 0) return null

  const exportHeaders = ['Modelo', 'Volumen', 'Producido', 'Pendiente', 'Completado %', 'Estado']
  const totalVol = models.reduce((s, m) => s + m.volumen, 0)
  const totalProd = models.reduce((s, m) => s + m.producido, 0)
  const totalTard = models.reduce((s, m) => s + m.tardiness, 0)
  const exportRows = [
    ...models.map((m) => [
      m.codigo, m.volumen, m.producido, m.tardiness, m.pct_completado, m.tardiness > 0 ? 'INCOMPLETO' : 'OK',
    ] as (string | number)[]),
    ['TOTAL', totalVol, totalProd, totalTard, '', ''],
  ]

  async function handlePDF() {
    const modelos = models.map((m) => m.codigo)
    const imgMap = await preloadModeloImages(modelos, catImages, (num, color) =>
      getModeloImageUrl(catImages, num, color)
    )
    exportTableWithImagesPDF('detalle_modelos', exportHeaders, exportRows, imgMap, 'Modelo')
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Detalle por Modelo</CardTitle>
        <TableExport title="detalle_modelos" headers={exportHeaders} rows={exportRows} onCustomPDF={handlePDF} />
      </CardHeader>
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
                <TableCell className="font-mono">
                  <span className="flex items-center gap-1">
                    {(() => { const [num, ...c] = m.codigo.split(' '); const u = getModeloImageUrl(catImages, num, c.join(' ')); return u ? <img src={u} alt={m.codigo} className="h-6 w-auto rounded border object-contain bg-white" /> : null })()}
                    {m.codigo}
                  </span>
                </TableCell>
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
            <TableRow className="bg-primary/10 font-bold border-t-2 border-primary/30">
              <TableCell className="text-primary">TOTAL</TableCell>
              <TableCell className="text-primary">{models.reduce((s, m) => s + m.volumen, 0).toLocaleString()}</TableCell>
              <TableCell className="text-primary">{models.reduce((s, m) => s + m.producido, 0).toLocaleString()}</TableCell>
              <TableCell className={models.some((m) => m.tardiness > 0) ? 'text-destructive' : 'text-primary'}>{models.reduce((s, m) => s + m.tardiness, 0)}</TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
