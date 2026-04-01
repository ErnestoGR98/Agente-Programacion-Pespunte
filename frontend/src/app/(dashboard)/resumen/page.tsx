'use client'

import React, { useMemo, useState, useEffect, useCallback } from 'react'
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
import { Input } from '@/components/ui/input'
import { DAY_ORDER } from '@/types'
import type { DayName, WeeklyScheduleEntry, DailyResult, DiaLaboral, PedidoItem, Resultado, ScenarioProposals, Scenario } from '@/types'
import { Truck, AlertTriangle, Lightbulb, Clock, Factory, Calendar, ChevronDown, ChevronRight, Loader2, Check, Wand2, Save, RotateCcw, Play, Pencil, CalendarDays, Download, FileText, Braces } from 'lucide-react'
import { useCatalogoImages, getModeloImageUrl } from '@/lib/hooks/useCatalogoImages'
import { TableExport } from '@/components/shared/TableExport'
import { preloadModeloImages, exportTableWithImagesPDF } from '@/lib/export'
import { proposeScenarios, applyScenario, generateDaily, optimizeDay } from '@/lib/api/fastapi'
import type { WeeklyDraftRow } from '@/lib/store/useAppStore'

export default function ResumenPage() {
  const result = useAppStore((s) => s.currentResult)
  const appStep = useAppStore((s) => s.appStep)
  const [maquilaFabricas, setMaquilaFabricas] = useState<Set<string>>(new Set())
  const [showEditor, setShowEditor] = useState(false)
  const [showDailyOpt, setShowDailyOpt] = useState(false)

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
      <div className="space-y-6">
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          Ejecuta una optimizacion para ver el resumen semanal.
        </div>
        {appStep >= 1 && (
          <>
            <DailyOptimizer />
            <ManualWeeklyEditor />
          </>
        )}
      </div>
    )
  }

  const summary = result.weekly_summary
  const schedule = result.weekly_schedule

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Resumen Semanal</h1>
          <p className="text-sm text-muted-foreground">
            Resultado: <Badge variant="secondary">{result.nombre}</Badge>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={showDailyOpt ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setShowDailyOpt(!showDailyOpt); if (!showDailyOpt) setShowEditor(false) }}
          >
            <CalendarDays className="mr-1 h-4 w-4" />
            {showDailyOpt ? 'Ocultar Diario' : 'Optimizar por Dia'}
          </Button>
          <Button
            variant={showEditor ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setShowEditor(!showEditor); if (!showEditor) setShowDailyOpt(false) }}
          >
            <Pencil className="mr-1 h-4 w-4" />
            {showEditor ? 'Ocultar Editor' : 'Editar Plan Manual'}
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard label="Total Pares" value={summary.total_pares?.toLocaleString() || '0'} />
        <KpiCard label="Estado" value={summary.status || 'N/A'} />
        <KpiCard label="Pendientes (Tardiness)" value={summary.total_tardiness || 0} />
        <KpiCard label="Tiempo Solver" value={`${(summary.wall_time_s || 0).toFixed(1)}s`} />
      </div>

      {/* Manual weekly editor (collapsible) */}
      {showEditor && <ManualWeeklyEditor />}

      {/* Daily optimizer (collapsible) */}
      {showDailyOpt && <DailyOptimizer />}

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
// Manual Weekly Editor
// ============================================================

function ManualWeeklyEditor() {
  const {
    appStep, currentPedidoNombre, currentSemana,
    weeklyDraft, weeklyDraftSemana, setWeeklyDraft,
  } = useAppStore()

  const [items, setItems] = useState<PedidoItem[]>([])
  const [dias, setDias] = useState<DiaLaboral[]>([])
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<WeeklyDraftRow[]>([])
  const [autoLoading, setAutoLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

  // Lot range config
  const [loteMin, setLoteMin] = useState(200)
  const [loteMax, setLoteMax] = useState(400)

  const activeDays = useMemo(() => {
    return DAY_ORDER.filter((d) => dias.some((dl) => dl.nombre === d && dl.plantilla > 0))
  }, [dias])

  // Persist draft to store
  useEffect(() => {
    if (rows.length > 0 && currentSemana) {
      setWeeklyDraft(rows, currentSemana)
    }
  }, [rows, currentSemana, setWeeklyDraft])

  // Load data
  useEffect(() => {
    if (appStep < 1 || !currentPedidoNombre) return
    setLoading(true)

    async function load() {
      const { data: pedido } = await supabase
        .from('pedidos')
        .select('id')
        .eq('nombre', currentPedidoNombre!)
        .single()

      if (!pedido) { setLoading(false); return }

      const [itemsRes, diasRes] = await Promise.all([
        supabase.from('pedido_items').select('*').eq('pedido_id', pedido.id).order('modelo_num'),
        supabase.from('dias_laborales').select('*').order('orden'),
      ])

      setItems(itemsRes.data || [])
      setDias(diasRes.data || [])

      // Restore draft or init from existing result's weekly_schedule
      const hasDraft = weeklyDraft && weeklyDraftSemana === currentSemana
      if (hasDraft) {
        setRows(weeklyDraft)
      } else {
        const currentResult = useAppStore.getState().currentResult
        const pedidoItems = itemsRes.data || []

        if (currentResult?.weekly_schedule?.length) {
          // Pre-fill from existing optimization result
          const newRows: WeeklyDraftRow[] = pedidoItems.map((it: PedidoItem) => {
            const days = Object.fromEntries(DAY_ORDER.map((d) => [d, 0])) as Record<DayName, number>
            const codigo = `${it.modelo_num} ${it.color}`.trim()
            for (const entry of currentResult.weekly_schedule) {
              if (entry.Modelo === codigo && entry.Dia) {
                days[entry.Dia as DayName] = (days[entry.Dia as DayName] || 0) + entry.Pares
              }
            }
            return { modelo_num: it.modelo_num, color: it.color, fabrica: it.fabrica, pedido: it.volumen, days }
          })
          setRows(newRows)
        } else {
          const newRows: WeeklyDraftRow[] = pedidoItems.map((it: PedidoItem) => ({
            modelo_num: it.modelo_num,
            color: it.color,
            fabrica: it.fabrica,
            pedido: it.volumen,
            days: Object.fromEntries(DAY_ORDER.map((d) => [d, 0])) as Record<DayName, number>,
          }))
          setRows(newRows)
        }
      }
      setLoading(false)
    }

    load()
  }, [appStep, currentPedidoNombre]) // eslint-disable-line react-hooks/exhaustive-deps

  // Day capacity estimate
  const dayCapacity = useMemo(() => {
    const cap: Record<string, { plantilla: number; maxPares: number }> = {}
    for (const d of dias) {
      const maxPares = d.plantilla * (d.minutos / 60) * 30
      cap[d.nombre] = { plantilla: d.plantilla, maxPares: Math.round(maxPares) }
    }
    return cap
  }, [dias])

  const dayTotals = useMemo(() => {
    const totals: Record<string, number> = {}
    for (const d of activeDays) totals[d] = rows.reduce((sum, r) => sum + (r.days[d] || 0), 0)
    return totals
  }, [rows, activeDays])

  const rowTotals = useMemo(() => {
    return rows.map((r) => activeDays.reduce((sum, d) => sum + (r.days[d] || 0), 0))
  }, [rows, activeDays])

  const handleCellChange = useCallback((rowIdx: number, day: DayName, value: string) => {
    const num = parseInt(value) || 0
    setRows((prev) => {
      const next = [...prev]
      next[rowIdx] = { ...next[rowIdx], days: { ...next[rowIdx].days, [day]: Math.max(0, num) } }
      return next
    })
    setSaved(false)
  }, [])

  // Auto-distribute
  const handleAutoDistribute = useCallback(() => {
    setAutoLoading(true)
    setTimeout(() => {
      const weekdays = activeDays.filter((d): d is DayName => d !== 'Sab')
      const hasSab = activeDays.includes('Sab')
      const dayLoad: Record<string, number> = {}
      const dayModels: Record<string, number> = {}
      activeDays.forEach((d) => { dayLoad[d] = 0; dayModels[d] = 0 })

      const indexed = rows.map((r, i) => ({ ...r, idx: i }))
      indexed.sort((a, b) => b.pedido - a.pedido)

      const newRowDays: Record<DayName, number>[] = rows.map(() =>
        Object.fromEntries(activeDays.map((d) => [d, 0])) as Record<DayName, number>
      )

      for (const model of indexed) {
        let remaining = model.pedido
        if (remaining === 0) continue

        const slotSize = Math.max(loteMin, Math.min(loteMax, Math.ceil(remaining / 3 / 100) * 100))
        const daysNeeded = Math.min(weekdays.length, Math.max(1, Math.ceil(remaining / slotSize)))

        const sortedWeekdays = [...weekdays].sort((a, b) => {
          const loadDiff = dayLoad[a] - dayLoad[b]
          return loadDiff !== 0 ? loadDiff : dayModels[a] - dayModels[b]
        })

        const selectedDays = sortedWeekdays.slice(0, daysNeeded)
        const perDay = Math.floor(remaining / selectedDays.length / 100) * 100
        let leftover = remaining - perDay * selectedDays.length

        for (const d of selectedDays) {
          let assign = perDay
          if (leftover >= 100) { assign += 100; leftover -= 100 }
          else if (leftover > 0) { assign += leftover; leftover = 0 }
          newRowDays[model.idx][d as DayName] = assign
          dayLoad[d] += assign
          if (assign > 0) dayModels[d]++
        }
      }

      // Spill overflow to Saturday
      if (hasSab && weekdays.length > 0) {
        const weekdayConfig = dias.find((d) => weekdays.includes(d.nombre))
        if (weekdayConfig) {
          const weekdayCap = weekdayConfig.plantilla * (weekdayConfig.minutos / 60) * 30
          for (const wd of weekdays) {
            if (dayLoad[wd] > weekdayCap) {
              const modelsOnDay = indexed
                .filter((m) => newRowDays[m.idx][wd as DayName] > 0)
                .sort((a, b) => newRowDays[a.idx][wd as DayName] - newRowDays[b.idx][wd as DayName])
              let toMove = dayLoad[wd] - weekdayCap
              for (const m of modelsOnDay) {
                if (toMove <= 0) break
                const current = newRowDays[m.idx][wd as DayName]
                const move = Math.min(current, Math.ceil(toMove / 100) * 100)
                newRowDays[m.idx][wd as DayName] -= move
                newRowDays[m.idx]['Sab'] += move
                dayLoad[wd] -= move
                dayLoad['Sab'] += move
                toMove -= move
              }
            }
          }
        }
      }

      setRows((prev) => prev.map((r, i) => ({ ...r, days: newRowDays[i] })))
      setAutoLoading(false)
      setSaved(false)
    }, 300)
  }, [activeDays, rows, loteMin, loteMax, dias])

  const handleClear = useCallback(() => {
    setRows((prev) => prev.map((r) => ({
      ...r,
      days: Object.fromEntries(DAY_ORDER.map((d) => [d, 0])) as Record<DayName, number>,
    })))
    setSaved(false)
  }, [])

  // Save as resultado
  const handleSave = useCallback(async () => {
    if (!currentSemana) return

    const weeklySchedule = rows.flatMap((r) =>
      activeDays
        .filter((d) => r.days[d] > 0)
        .map((d) => ({
          Dia: d,
          Modelo: `${r.modelo_num} ${r.color}`.trim(),
          Fabrica: r.fabrica,
          Pares: r.days[d],
          HC_Necesario: 0,
        }))
    )

    const totalPares = weeklySchedule.reduce((s, e) => s + e.Pares, 0)

    const weeklySummary = {
      status: 'MANUAL',
      total_pares: totalPares,
      total_tardiness: rows.reduce((s, r, i) => s + Math.max(0, r.pedido - rowTotals[i]), 0),
      wall_time_s: 0,
      days: activeDays.map((d) => ({
        dia: d,
        pares: dayTotals[d] || 0,
        hc_necesario: 0,
        hc_disponible: dayCapacity[d]?.plantilla || 0,
        utilizacion_pct: 0,
        overtime_hrs: 0,
        is_saturday: d === 'Sab',
      })),
      models: rows.map((r, i) => ({
        codigo: `${r.modelo_num} ${r.color}`.trim(),
        volumen: r.pedido,
        producido: rowTotals[i],
        tardiness: Math.max(0, r.pedido - rowTotals[i]),
        pct_completado: r.pedido > 0 ? Math.min(100, Math.round((rowTotals[i] / r.pedido) * 100)) : 100,
      })),
    }

    const baseName = currentSemana
    const { data: existing } = await supabase
      .from('resultados')
      .select('id, version')
      .eq('base_name', baseName)
      .order('version', { ascending: false })
      .limit(1)

    const nextVersion = existing && existing.length > 0 ? existing[0].version + 1 : 1
    const nombre = `${baseName}_v${nextVersion}`

    await supabase.from('resultados').insert({
      nombre,
      base_name: baseName,
      version: nextVersion,
      nota: 'Plan semanal manual',
      weekly_schedule: weeklySchedule,
      weekly_summary: weeklySummary,
      daily_results: {},
      pedido_snapshot: items,
      params_snapshot: {},
    })

    const { data: savedResult } = await supabase
      .from('resultados')
      .select('*')
      .eq('nombre', nombre)
      .single()

    if (savedResult) {
      useAppStore.getState().setCurrentResult(savedResult as Resultado)
    }

    setSaved(true)
  }, [rows, activeDays, dayTotals, rowTotals, currentSemana, items, dayCapacity])

  // Generate daily from saved plan
  const handleGenerateDaily = useCallback(async () => {
    const currentResult = useAppStore.getState().currentResult
    if (!currentResult) return

    setGenerating(true)
    setGenError(null)

    try {
      const res = await generateDaily({ resultado_id: currentResult.id })

      const { data } = await supabase
        .from('resultados')
        .select('*')
        .eq('nombre', res.saved_as)
        .single()

      if (data) {
        useAppStore.getState().setCurrentResult(data as Resultado)
      }
      setSaved(false)
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Error al generar diario')
    } finally {
      setGenerating(false)
    }
  }, [])

  // Render
  if (appStep < 1) return null

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando datos para planificacion...
        </CardContent>
      </Card>
    )
  }

  const grandTotal = rowTotals.reduce((s, t) => s + t, 0)
  const grandPedido = rows.reduce((s, r) => s + r.pedido, 0)
  const grandPendiente = Math.max(0, grandPedido - grandTotal)

  return (
    <Card className="border-blue-500/30">
      <CardHeader className="py-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Pencil className="h-4 w-4" />
            Plan Semanal Manual
            <Badge variant="outline" className="text-xs font-normal">
              {rows.length} modelos · {grandPedido.toLocaleString()}p pedido
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleClear}>
              <RotateCcw className="mr-1 h-3 w-3" /> Limpiar
            </Button>
            <div className="flex items-center gap-1 rounded-md border border-border/50 px-2 py-1">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Lote:</span>
              <Input
                type="number" min={100} step={100} value={loteMin}
                onChange={(e) => setLoteMin(Math.max(100, parseInt(e.target.value) || 100))}
                className="h-6 w-14 text-xs text-center p-0.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-xs text-muted-foreground">—</span>
              <Input
                type="number" min={100} step={100} value={loteMax}
                onChange={(e) => setLoteMax(Math.max(loteMin, parseInt(e.target.value) || 400))}
                className="h-6 w-14 text-xs text-center p-0.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
            <Button variant="outline" size="sm" onClick={handleAutoDistribute} disabled={autoLoading}>
              {autoLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Wand2 className="mr-1 h-3 w-3" />}
              Auto
            </Button>
            <Button size="sm" onClick={handleSave} disabled={grandTotal === 0}>
              {saved ? <><Check className="mr-1 h-3 w-3" /> Guardado</> : <><Save className="mr-1 h-3 w-3" /> Guardar</>}
            </Button>
            {saved && (
              <Button size="sm" variant={genError ? 'destructive' : 'default'} onClick={handleGenerateDaily} disabled={generating}>
                {generating
                  ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Generando...</>
                  : <><Play className="mr-1 h-3 w-3" /> Generar Diario</>
                }
              </Button>
            )}
            {genError && <span className="text-xs text-destructive max-w-[200px] truncate">{genError}</span>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {/* KPIs row */}
        <div className="grid grid-cols-4 gap-2">
          <div className="rounded border p-2 text-center">
            <p className="text-[10px] text-muted-foreground">Asignado</p>
            <p className="text-lg font-bold">{grandTotal.toLocaleString()}</p>
          </div>
          <div className="rounded border p-2 text-center">
            <p className="text-[10px] text-muted-foreground">Pedido</p>
            <p className="text-lg font-bold">{grandPedido.toLocaleString()}</p>
          </div>
          <div className="rounded border p-2 text-center">
            <p className="text-[10px] text-muted-foreground">Pendiente</p>
            <p className={`text-lg font-bold ${grandPendiente > 0 ? 'text-destructive' : 'text-green-600'}`}>
              {grandPendiente.toLocaleString()}
            </p>
          </div>
          <div className="rounded border p-2 text-center">
            <p className="text-[10px] text-muted-foreground">Cobertura</p>
            <p className="text-lg font-bold">
              {grandPedido > 0 ? Math.min(100, Math.round((grandTotal / grandPedido) * 100)) : 0}%
            </p>
          </div>
        </div>

        {/* Capacity bars */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
          {activeDays.map((d) => {
            const cap = dayCapacity[d]
            const assigned = dayTotals[d] || 0
            const pct = cap?.maxPares ? Math.round((assigned / cap.maxPares) * 100) : 0
            const overloaded = pct > 100
            return (
              <div key={d} className="space-y-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{d}{d === 'Sab' ? ' (TE)' : ''}</span>
                  <span className={`text-[10px] ${overloaded ? 'text-destructive font-bold' : 'text-muted-foreground'}`}>{pct}%</span>
                </div>
                <Progress value={Math.min(pct, 100)} className={`h-1.5 ${overloaded ? '[&>div]:bg-destructive' : ''}`} />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>{assigned.toLocaleString()}p</span>
                  <span>{cap?.plantilla || 0}HC</span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Editable table */}
        <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-card z-10 min-w-[120px] text-xs">Modelo</TableHead>
                <TableHead className="text-center min-w-[60px] text-xs">Pedido</TableHead>
                {activeDays.map((d) => (
                  <TableHead key={d} className={`text-center min-w-[80px] text-xs ${d === 'Sab' ? 'text-amber-500' : ''}`}>
                    {d}
                  </TableHead>
                ))}
                <TableHead className="text-center min-w-[60px] text-xs">Total</TableHead>
                <TableHead className="text-center min-w-[60px] text-xs">Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, ri) => {
                const total = rowTotals[ri]
                const pendiente = row.pedido - total
                const complete = total >= row.pedido
                return (
                  <TableRow key={`${row.modelo_num}-${row.color}`}>
                    <TableCell className="sticky left-0 bg-card z-10 font-mono text-xs py-1">
                      <div>{row.modelo_num}</div>
                      {row.color && <div className="text-muted-foreground text-[10px]">{row.color}</div>}
                    </TableCell>
                    <TableCell className="text-center text-xs font-medium py-1">{row.pedido.toLocaleString()}</TableCell>
                    {activeDays.map((d) => (
                      <TableCell key={d} className="p-0.5">
                        <Input
                          type="number" min={0} step={100}
                          value={row.days[d] || ''}
                          onChange={(e) => handleCellChange(ri, d, e.target.value)}
                          className="h-7 w-full text-center text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          placeholder="0"
                        />
                      </TableCell>
                    ))}
                    <TableCell className={`text-center font-bold text-xs py-1 ${total > row.pedido ? 'text-amber-500' : ''}`}>
                      {total.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-center py-1">
                      {complete
                        ? <Badge variant="default" className="bg-green-600 text-[10px] px-1.5 py-0">OK</Badge>
                        : <Badge variant="destructive" className="text-[10px] px-1.5 py-0">-{pendiente}</Badge>
                      }
                    </TableCell>
                  </TableRow>
                )
              })}
              {/* Totals row */}
              <TableRow className="bg-primary/10 font-bold border-t-2 border-primary/30">
                <TableCell className="sticky left-0 bg-primary/10 z-10 text-primary text-xs">TOTAL</TableCell>
                <TableCell className="text-center text-primary text-xs">{grandPedido.toLocaleString()}</TableCell>
                {activeDays.map((d) => {
                  const cap = dayCapacity[d]
                  const val = dayTotals[d] || 0
                  const overloaded = cap?.maxPares && val > cap.maxPares
                  return (
                    <TableCell key={d} className={`text-center text-xs ${overloaded ? 'text-destructive' : 'text-primary'}`}>
                      {val.toLocaleString()}
                    </TableCell>
                  )
                })}
                <TableCell className="text-center text-primary text-xs">{grandTotal.toLocaleString()}</TableCell>
                <TableCell className="text-center">
                  {grandPendiente > 0
                    ? <span className="text-destructive flex items-center justify-center gap-0.5 text-[10px]">
                        <AlertTriangle className="h-3 w-3" /> -{grandPendiente}
                      </span>
                    : <Badge className="bg-green-600 text-[10px] px-1.5 py-0">Completo</Badge>
                  }
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
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
  const [allDays, setAllDays] = useState<string[]>([])

  // Load all active days from dias_laborales
  useEffect(() => {
    supabase.from('dias_laborales').select('nombre').order('orden').then(({ data }) => {
      if (data) setAllDays(DAY_ORDER.filter((d) => data.some((dl: { nombre: string }) => dl.nombre === d)))
    })
  }, [])

  const pivot = useMemo(() => {
    const days = allDays.length > 0 ? allDays : DAY_ORDER.filter((d) => [...new Set(schedule.map((e) => e.Dia))].includes(d))
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


// ============================================================
// Daily Optimizer
// ============================================================

const DAY_COLOR: Record<string, string> = {
  Lun: '#3b82f6', Mar: '#8b5cf6', Mie: '#06b6d4', Jue: '#f59e0b', Vie: '#10b981', Sab: '#ef4444',
}

function DailyOptimizer() {
  const { currentSemana, currentPedidoNombre, currentResult, setCurrentResult } = useAppStore()

  const [selectedDay, setSelectedDay] = useState<DayName>('Lun')
  const [dias, setDias] = useState<DiaLaboral[]>([])
  const [pedidoItems, setPedidoItems] = useState<PedidoItem[]>([])
  const [models, setModels] = useState<{ modelo: string; pares: number; fabrica: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultadoId, setResultadoId] = useState<string | null>(null)
  const [optimizedDays, setOptimizedDays] = useState<Set<string>>(new Set())
  const [dayStatus, setDayStatus] = useState<Record<string, { pares: number; tardiness: number; status: string }>>({})
  const [search, setSearch] = useState('')
  const [expandedRezago, setExpandedRezago] = useState<Set<string>>(new Set())
  const [fracNames, setFracNames] = useState<Map<string, string>>(new Map()) // key: "modelo|frac" -> operacion
  const catImages = useCatalogoImages()

  // Load fraction operation names from catalog
  useEffect(() => {
    const modelNums = new Set(pedidoItems.map((p) => p.modelo_num))
    if (modelNums.size === 0) return
    supabase
      .from('catalogo_operaciones')
      .select('fraccion, operacion, catalogo_modelos!inner(modelo_num)')
      .in('catalogo_modelos.modelo_num', [...modelNums])
      .then(({ data }) => {
        const map = new Map<string, string>()
        for (const op of data || []) {
          const cm = op.catalogo_modelos as unknown as { modelo_num: string }
          map.set(`${cm.modelo_num}|${op.fraccion}`, op.operacion || '')
        }
        setFracNames(map)
      })
  }, [pedidoItems])

  // Compute carry-over from prior optimized days
  const carryOver = useMemo(() => {
    if (!currentResult?.daily_results) return { tardiness: {} as Record<string, number>, produced: {} as Record<string, Record<string, number>> }
    const dayIdx = DAY_ORDER.indexOf(selectedDay)
    const priorDays = DAY_ORDER.slice(0, dayIdx)
    const tardiness: Record<string, number> = {}
    const produced: Record<string, Record<string, number>> = {}

    for (const d of priorDays) {
      const dr = currentResult.daily_results[d]
      if (!dr || !dr.schedule?.length) continue
      // Accumulate tardiness
      const tard = dr.tardiness_by_model || {}
      for (const [code, t] of Object.entries(tard)) {
        tardiness[code] = (tardiness[code] || 0) + (t as number)
      }
      // Accumulate produced_by_op
      const prod = (dr as unknown as Record<string, unknown>).produced_by_op as Record<string, Record<string, number>> | undefined
      if (prod) {
        for (const [code, fracProd] of Object.entries(prod)) {
          if (!produced[code]) produced[code] = {}
          for (const [frac, p] of Object.entries(fracProd)) {
            produced[code][frac] = (produced[code][frac] || 0) + (p as number)
          }
        }
      }
    }
    return { tardiness, produced }
  }, [currentResult, selectedDay])

  const activeDays = useMemo(() => {
    return DAY_ORDER.filter((d) => dias.some((dl) => dl.nombre === d && dl.plantilla > 0)) as DayName[]
  }, [dias])

  // Load dias laborales + pedido items
  useEffect(() => {
    supabase.from('dias_laborales').select('*').order('orden').then(({ data }) => {
      setDias(data || [])
    })
  }, [])

  useEffect(() => {
    if (!currentPedidoNombre) return
    async function loadPedido() {
      const { data: pedido } = await supabase
        .from('pedidos')
        .select('id')
        .eq('nombre', currentPedidoNombre!)
        .single()
      if (!pedido) return
      const { data: items } = await supabase
        .from('pedido_items')
        .select('*')
        .eq('pedido_id', pedido.id)
        .order('modelo_num')
      setPedidoItems(items || [])
    }
    loadPedido()
  }, [currentPedidoNombre])

  // Initialize from current result
  useEffect(() => {
    if (currentResult?.id) {
      setResultadoId(currentResult.id)
      const done = new Set<string>()
      const statuses: Record<string, { pares: number; tardiness: number; status: string }> = {}
      if (currentResult.daily_results) {
        for (const [d, dr] of Object.entries(currentResult.daily_results)) {
          if (dr.schedule?.length > 0) {
            done.add(d)
            statuses[d] = {
              pares: dr.total_pares || 0,
              tardiness: dr.total_tardiness || 0,
              status: dr.status || '',
            }
          }
        }
      }
      setOptimizedDays(done)
      setDayStatus(statuses)
    }
  }, [currentResult])

  // Compute rezago models (non-editable, per-fraction detail)
  const rezagoModels = useMemo(() => {
    const result: { modelo: string; fabrica: string; totalPendiente: number; fracciones: { frac: string; nombre: string; producido: number; max: number; pendiente: number }[] }[] = []
    for (const [code, tard] of Object.entries(carryOver.tardiness)) {
      if (tard <= 0) continue
      const modelNum = code.split(' ')[0]
      const pedido = pedidoItems.find((p) => p.modelo_num === modelNum)
      const produced = carryOver.produced[code] || {}

      // Build per-fraction detail
      const fracs: { frac: string; nombre: string; producido: number; max: number; pendiente: number }[] = []
      const maxProd = Math.max(...Object.values(produced).map(Number), 0)
      for (const [frac, prod] of Object.entries(produced)) {
        const nombre = fracNames.get(`${modelNum}|${frac}`) || ''
        const pendiente = maxProd - Number(prod)
        if (pendiente > 0) {
          fracs.push({ frac, nombre, producido: Number(prod), max: maxProd, pendiente })
        }
      }
      fracs.sort((a, b) => Number(a.frac) - Number(b.frac))

      result.push({
        modelo: code,
        fabrica: pedido?.fabrica || '',
        totalPendiente: tard,
        fracciones: fracs,
      })
    }
    return result
  }, [carryOver, pedidoItems, fracNames])

  // Load NEW models for selected day (editable, separate from rezago)
  useEffect(() => {
    const dayModels = new Map<string, { modelo: string; pares: number; fabrica: string }>()

    // All pedido models available to program
    for (const it of pedidoItems) {
      const codigo = `${it.modelo_num} ${it.color}`.trim()
      if (!dayModels.has(codigo)) {
        dayModels.set(codigo, { modelo: codigo, pares: 0, fabrica: it.fabrica || '' })
      }
    }

    // Override pares from weekly_schedule if exists for this day
    if (currentResult?.weekly_schedule?.length) {
      for (const e of currentResult.weekly_schedule) {
        if (e.Dia === selectedDay) {
          const existing = dayModels.get(e.Modelo)
          if (existing) {
            existing.pares += e.Pares
          } else {
            dayModels.set(e.Modelo, { modelo: e.Modelo, pares: e.Pares, fabrica: e.Fabrica || '' })
          }
        }
      }
    }

    setModels(Array.from(dayModels.values()).sort((a, b) => a.modelo.localeCompare(b.modelo)))
  }, [selectedDay, currentResult, pedidoItems])

  function updatePares(modelo: string, pares: number) {
    setModels((prev) => prev.map((m) => m.modelo === modelo ? { ...m, pares } : m))
  }

  async function handleOptimize() {
    const semana = currentSemana || currentPedidoNombre || ''
    if (!semana) return
    setOptimizing(true)
    setError(null)

    try {
      // Combine new models + rezago models
      const allModels = new Map<string, { modelo: string; pares: number; fabrica?: string }>()

      // New models (user-edited)
      for (const m of models) {
        if (m.pares > 0) {
          allModels.set(m.modelo, { modelo: m.modelo, pares: m.pares, fabrica: m.fabrica })
        }
      }

      // Rezago models (add to existing or create new)
      for (const rz of rezagoModels) {
        const existing = allModels.get(rz.modelo)
        if (existing) {
          existing.pares += rz.totalPendiente
        } else {
          allModels.set(rz.modelo, { modelo: rz.modelo, pares: rz.totalPendiente, fabrica: rz.fabrica })
        }
      }

      const modelsToSend = Array.from(allModels.values())
      if (modelsToSend.length === 0) return

      const res = await optimizeDay({
        semana: semana,
        day_name: selectedDay,
        models_day: modelsToSend,
        previous_resultado_id: resultadoId,
      })

      setResultadoId(res.resultado_id)
      setOptimizedDays((prev) => new Set([...prev, selectedDay]))
      setDayStatus((prev) => ({
        ...prev,
        [selectedDay]: { pares: res.total_pares, tardiness: res.tardiness, status: res.status },
      }))

      // Clear subsequent days (carry-over changed)
      const dayIdx = activeDays.indexOf(selectedDay)
      if (dayIdx >= 0) {
        const laterDays = activeDays.slice(dayIdx + 1)
        if (laterDays.length > 0) {
          setOptimizedDays((prev) => {
            const next = new Set(prev)
            for (const d of laterDays) next.delete(d)
            return next
          })
        }
      }

      // Reload full result
      const { data } = await supabase
        .from('resultados')
        .select('*')
        .eq('id', res.resultado_id)
        .single()
      if (data) {
        setCurrentResult(data as Resultado)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido')
    } finally {
      setOptimizing(false)
    }
  }

  const totalNewPares = models.reduce((s, m) => s + m.pares, 0)
  const totalRezagoPares = rezagoModels.reduce((s, m) => s + m.totalPendiente, 0)
  const totalPares = totalNewPares + totalRezagoPares

  const filteredModels = useMemo(() => {
    if (!search.trim()) return models
    const q = search.toLowerCase()
    return models.filter((m) => m.modelo.toLowerCase().includes(q) || m.fabrica.toLowerCase().includes(q))
  }, [models, search])

  const [jsonCopied2, setJsonCopied2] = useState(false)

  function handleExportJSON() {
    const data = {
      semana: currentSemana || currentPedidoNombre || '',
      dia: selectedDay,
      modelos: models.map((m) => {
        const [modelNum, ...cp] = m.modelo.split(' ')
        const pedido = pedidoItems.find((p) => p.modelo_num === modelNum && p.color === cp.join(' '))
          || pedidoItems.find((p) => p.modelo_num === modelNum)
        return { modelo: m.modelo, fabrica: m.fabrica, pedido_total: pedido?.volumen || 0, pares_dia: m.pares }
      }),
      total_pares_dia: totalPares,
    }
    navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => {
      setJsonCopied2(true)
      setTimeout(() => setJsonCopied2(false), 2000)
    })
  }

  function handleExportPDF() {
    // Use jspdf-autotable for a clean table PDF
    import('jspdf').then(({ default: jsPDF }) => {
      import('jspdf-autotable').then((autoTableModule) => {
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
        const title = `Programa Diario — ${selectedDay} — ${currentSemana || ''}`
        doc.setFontSize(14)
        doc.text(title, 14, 15)
        doc.setFontSize(10)
        doc.text(`Total pares: ${totalPares.toLocaleString()}`, 14, 22)

        const head = [['#', 'Modelo', 'Fabrica', 'Pedido', 'Pares Dia']]
        const body = models
          .filter((m) => m.pares > 0 || true)
          .map((m, i) => {
            const [modelNum, ...cp] = m.modelo.split(' ')
            const pedido = pedidoItems.find((p) => p.modelo_num === modelNum && p.color === cp.join(' '))
              || pedidoItems.find((p) => p.modelo_num === modelNum)
            return [i + 1, m.modelo, m.fabrica || '-', pedido?.volumen?.toLocaleString() || '-', m.pares > 0 ? m.pares.toLocaleString() : '-']
          })
        body.push(['', 'TOTAL', '', '', totalPares.toLocaleString()])

        ;(autoTableModule as unknown as { default: Function }).default(doc, {
          startY: 28,
          head,
          body,
          theme: 'grid',
          headStyles: { fillColor: [59, 130, 246], fontSize: 9 },
          bodyStyles: { fontSize: 8 },
          columnStyles: { 0: { halign: 'center', cellWidth: 10 }, 3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold' } },
        })

        doc.save(`diario_${selectedDay}_${currentSemana || 'plan'}.pdf`)
      })
    })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4" />
            Optimizacion por Dia
          </CardTitle>
          <div className="flex items-center gap-1 rounded-md border px-1 py-0.5">
            <Download className="h-3.5 w-3.5 text-muted-foreground mr-0.5" />
            <button
              onClick={handleExportPDF}
              className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
            >
              <FileText className="h-3.5 w-3.5" />
              PDF
            </button>
            <button
              onClick={handleExportJSON}
              className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
            >
              {jsonCopied2 ? <Check className="h-3.5 w-3.5" /> : <Braces className="h-3.5 w-3.5" />}
              {jsonCopied2 ? 'Copiado' : 'JSON'}
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Day selector */}
        <div className="flex items-center gap-1 flex-wrap">
          {activeDays.map((d) => {
            const isSelected = d === selectedDay
            const isDone = optimizedDays.has(d)
            const ds = dayStatus[d]
            return (
              <button
                key={d}
                onClick={() => setSelectedDay(d)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  isSelected ? 'ring-2 ring-offset-1' : 'hover:bg-accent/50'
                }`}
                style={{
                  borderColor: isSelected ? DAY_COLOR[d] : isDone ? `${DAY_COLOR[d]}40` : undefined,
                  outline: isSelected ? `2px solid ${DAY_COLOR[d]}` : undefined,
                  outlineOffset: isSelected ? 1 : undefined,
                  backgroundColor: isDone ? `${DAY_COLOR[d]}10` : undefined,
                }}
              >
                <span style={{ color: DAY_COLOR[d] }}>{d}</span>
                {isDone && (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                )}
                {ds && (
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {ds.pares}p
                    {ds.tardiness > 0 && <span className="text-amber-500 ml-0.5">-{ds.tardiness}</span>}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Rezago section — non-editable, per-fraction detail */}
        {rezagoModels.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-semibold text-amber-500">
                Rezago de dias anteriores — {totalRezagoPares.toLocaleString()}p pendientes
              </span>
              <span className="text-[10px] text-muted-foreground">(se agrega automaticamente al optimizar)</span>
            </div>
            {rezagoModels.map((rz) => {
              const [modelNum, ...cp] = rz.modelo.split(' ')
              const imgUrl = getModeloImageUrl(catImages, modelNum, cp.join(' '))
              const isExp = expandedRezago.has(rz.modelo)
              return (
                <div key={rz.modelo} className="rounded border border-amber-500/20 bg-card p-2">
                  <button
                    className="flex items-center gap-2 w-full text-left"
                    onClick={() => setExpandedRezago((prev) => {
                      const next = new Set(prev)
                      if (next.has(rz.modelo)) next.delete(rz.modelo)
                      else next.add(rz.modelo)
                      return next
                    })}
                  >
                    {imgUrl ? (
                      <div className="h-10 w-14 rounded border bg-white flex items-center justify-center p-0.5 flex-shrink-0">
                        <img src={imgUrl} alt="" className="max-h-full max-w-full object-contain" />
                      </div>
                    ) : (
                      <div className="h-10 w-14 rounded border bg-muted flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <span className="font-mono text-sm font-medium">{rz.modelo}</span>
                      <span className="text-xs text-muted-foreground ml-2">{rz.fabrica}</span>
                    </div>
                    <span className="font-mono font-bold text-amber-500">{rz.totalPendiente}p</span>
                    {rz.fracciones.length > 0 && (
                      isExp ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </button>
                  {isExp && rz.fracciones.length > 0 && (
                    <div className="mt-2 pl-16 space-y-0.5">
                      {rz.fracciones.map((f) => (
                        <div key={f.frac} className="flex items-center gap-2 text-[10px] font-mono">
                          <span className="text-muted-foreground w-6 text-right">F{f.frac}</span>
                          <span className="text-muted-foreground truncate flex-1 max-w-[200px] text-[9px]">{f.nombre}</span>
                          <span className="text-emerald-500">{f.producido}p</span>
                          <span className="text-muted-foreground">/</span>
                          <span>{f.max}p</span>
                          <span className="text-amber-500 font-bold">-{f.pendiente}p</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Search bar */}
        {models.length > 0 && (
          <Input
            placeholder="Buscar modelo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 max-w-xs text-sm"
          />
        )}

        {/* Models table for selected day */}
        {models.length > 0 ? (
          <div className="rounded border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs w-10"></TableHead>
                  <TableHead className="text-xs">Modelo</TableHead>
                  <TableHead className="text-xs text-center w-20">Fabrica</TableHead>
                  <TableHead className="text-xs text-center w-20">Pedido</TableHead>
                  <TableHead className="text-xs text-center w-24">Pares Dia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredModels.map((m) => {
                  const [modelNum, ...colorParts] = m.modelo.split(' ')
                  const colorStr = colorParts.join(' ')
                  const ped = pedidoItems.find((p) => p.modelo_num === modelNum && p.color === colorStr)
                    || pedidoItems.find((p) => p.modelo_num === modelNum)
                  const imgUrl = getModeloImageUrl(catImages, modelNum, colorStr)
                  return (
                    <TableRow key={m.modelo}>
                      <TableCell className="px-2 py-2 w-[100px]">
                        {imgUrl ? (
                          <div className="h-16 w-[90px] rounded border bg-white flex items-center justify-center p-1">
                            <img src={imgUrl} alt="" className="max-h-full max-w-full object-contain" />
                          </div>
                        ) : (
                          <div className="h-16 w-[90px] rounded border bg-muted flex items-center justify-center text-[9px] text-muted-foreground">Sin foto</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="font-mono text-sm font-medium">{m.modelo}</div>
                        {(carryOver.tardiness[m.modelo] || 0) > 0 && (
                          <span className="text-[9px] text-amber-500">+ {carryOver.tardiness[m.modelo]}p rezago arriba</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center text-xs text-muted-foreground">{m.fabrica || '-'}</TableCell>
                      <TableCell className="text-center text-xs text-muted-foreground font-mono">{ped?.volumen?.toLocaleString() || '-'}</TableCell>
                      <TableCell className="text-center">
                        <Input
                          type="number"
                          min={0}
                          step={50}
                          value={m.pares}
                          onChange={(e) => updatePares(m.modelo, parseInt(e.target.value) || 0)}
                          className="h-7 w-20 text-xs font-mono text-center mx-auto"
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}
                <TableRow className="bg-accent/30 font-bold">
                  <TableCell />
                  <TableCell>NUEVOS</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell className="text-center font-mono">{totalNewPares.toLocaleString()}</TableCell>
                </TableRow>
                {totalRezagoPares > 0 && (
                  <TableRow className="bg-amber-500/10 font-bold">
                    <TableCell />
                    <TableCell className="text-amber-500">+ REZAGO</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-center font-mono text-amber-500">{totalRezagoPares.toLocaleString()}</TableCell>
                  </TableRow>
                )}
                <TableRow className="bg-primary/10 font-bold border-t-2">
                  <TableCell />
                  <TableCell className="text-primary">TOTAL DIA</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell className="text-center font-mono text-primary">{totalPares.toLocaleString()}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground text-center py-4">
            No hay modelos asignados a {selectedDay} en el plan semanal.
          </div>
        )}

        {/* Optimize button + status */}
        <div className="flex items-center gap-3">
          <Button
            onClick={handleOptimize}
            disabled={optimizing || totalPares === 0}
            className="gap-1"
          >
            {optimizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Optimizar {selectedDay}
          </Button>

          {error && (
            <span className="text-xs text-destructive">{error}</span>
          )}

          {dayStatus[selectedDay] && !optimizing && (
            <div className="flex items-center gap-2 text-xs">
              <Badge variant={dayStatus[selectedDay].status === 'OPTIMAL' ? 'default' : 'secondary'}>
                {dayStatus[selectedDay].status}
              </Badge>
              <span className="font-mono">{dayStatus[selectedDay].pares}p producidos</span>
              {dayStatus[selectedDay].tardiness > 0 && (
                <span className="text-amber-500 font-mono">-{dayStatus[selectedDay].tardiness}p pendientes</span>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
