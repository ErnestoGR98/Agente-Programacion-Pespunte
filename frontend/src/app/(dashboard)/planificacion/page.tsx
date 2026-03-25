'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import { useAppStore } from '@/lib/store/useAppStore'
import { supabase } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Progress } from '@/components/ui/progress'
import { Loader2, Wand2, Save, RotateCcw, AlertTriangle, Check, Play } from 'lucide-react'
import { DAY_ORDER } from '@/types'
import type { DayName, PedidoItem, DiaLaboral, CatalogoModelo, Resultado } from '@/types'
import { generateDaily } from '@/lib/api/fastapi'

// ============================================================
// Types
// ============================================================

/** One row in the weekly grid: modelo + pares per day */
interface WeeklyRow {
  modelo_num: string
  color: string
  fabrica: string
  pedido: number // original order volume
  /** pares assigned per day — editable */
  days: Record<DayName, number>
}

interface DayCapacity {
  plantilla: number
  minutos: number
  /** estimated max pares this day can handle (simple: plantilla * minutos * rate / 60) */
  maxPares: number
}

// ============================================================
// Page
// ============================================================

export default function PlanificacionPage() {
  const {
    appStep, currentPedidoNombre, currentSemana,
    weeklyDraft, weeklyDraftSemana, setWeeklyDraft,
  } = useAppStore()

  // Data from Supabase
  const [items, setItems] = useState<PedidoItem[]>([])
  const [dias, setDias] = useState<DiaLaboral[]>([])
  const [catalogo, setCatalogo] = useState<CatalogoModelo[]>([])
  const [loading, setLoading] = useState(true)

  // Weekly grid state
  const [rows, setRows] = useState<WeeklyRow[]>([])
  const [mode, setMode] = useState<'manual' | 'auto'>('manual')
  const [autoLoading, setAutoLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

  // Auto-distribute config
  const [loteMin, setLoteMin] = useState(200)
  const [loteMax, setLoteMax] = useState(400)

  // Active days (from config)
  const activeDays = useMemo(() => {
    return DAY_ORDER.filter((d) => dias.some((dl) => dl.nombre === d && dl.plantilla > 0))
  }, [dias])

  // Persist draft to store whenever rows change
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
      // Get pedido ID
      const { data: pedido } = await supabase
        .from('pedidos')
        .select('id')
        .eq('nombre', currentPedidoNombre!)
        .single()

      if (!pedido) { setLoading(false); return }

      const [itemsRes, diasRes, catRes] = await Promise.all([
        supabase.from('pedido_items').select('*').eq('pedido_id', pedido.id).order('modelo_num'),
        supabase.from('dias_laborales').select('*').order('orden'),
        supabase.from('catalogo_modelos').select('*'),
      ])

      setItems(itemsRes.data || [])
      setDias(diasRes.data || [])
      setCatalogo(catRes.data || [])

      // Restore draft from store if same semana, otherwise init empty
      const hasDraft = weeklyDraft && weeklyDraftSemana === currentSemana
      if (hasDraft) {
        setRows(weeklyDraft)
      } else {
        const newRows: WeeklyRow[] = (itemsRes.data || []).map((it: PedidoItem) => ({
          modelo_num: it.modelo_num,
          color: it.color,
          fabrica: it.fabrica,
          pedido: it.volumen,
          days: Object.fromEntries(DAY_ORDER.map((d) => [d, 0])) as Record<DayName, number>,
        }))
        setRows(newRows)
      }
      setLoading(false)
    }

    load()
  }, [appStep, currentPedidoNombre]) // eslint-disable-line react-hooks/exhaustive-deps

  // Capacity per day (simple estimate: plantilla * minutos available)
  const dayCapacity = useMemo(() => {
    const cap: Record<string, DayCapacity> = {}
    for (const d of dias) {
      // Estimate: avg sec_per_pair across catalogo models ~120s, so pares/person/hour ~30
      // Simple: plantilla * (minutos / 60) * 30 pares/person/hr
      const paresPerPersonHr = 30
      const maxPares = d.plantilla * (d.minutos / 60) * paresPerPersonHr
      cap[d.nombre] = {
        plantilla: d.plantilla,
        minutos: d.minutos,
        maxPares: Math.round(maxPares),
      }
    }
    return cap
  }, [dias])

  // Computed totals
  const dayTotals = useMemo(() => {
    const totals: Record<string, number> = {}
    for (const d of activeDays) {
      totals[d] = rows.reduce((sum, r) => sum + (r.days[d] || 0), 0)
    }
    return totals
  }, [rows, activeDays])

  const rowTotals = useMemo(() => {
    return rows.map((r) => activeDays.reduce((sum, d) => sum + (r.days[d] || 0), 0))
  }, [rows, activeDays])

  // Cell edit handler
  const handleCellChange = useCallback((rowIdx: number, day: DayName, value: string) => {
    const num = parseInt(value) || 0
    setRows((prev) => {
      const next = [...prev]
      next[rowIdx] = { ...next[rowIdx], days: { ...next[rowIdx].days, [day]: Math.max(0, num) } }
      return next
    })
    setSaved(false)
  }, [])

  // Auto-distribute: balance load Lun-Vie first, Sab only if overflow
  const handleAutoDistribute = useCallback(() => {
    setAutoLoading(true)
    setTimeout(() => {
      // Separate weekdays from Saturday
      const weekdays = activeDays.filter((d): d is DayName => d !== 'Sab')
      const hasSab = activeDays.includes('Sab')

      // Track load per day
      const dayLoad: Record<string, number> = {}
      activeDays.forEach((d) => { dayLoad[d] = 0 })
      const dayModels: Record<string, number> = {}
      activeDays.forEach((d) => { dayModels[d] = 0 })

      // Sort models: largest first
      const indexed = rows.map((r, i) => ({ ...r, idx: i }))
      indexed.sort((a, b) => b.pedido - a.pedido)

      const newRowDays: Record<DayName, number>[] = rows.map(() =>
        Object.fromEntries(activeDays.map((d) => [d, 0])) as Record<DayName, number>
      )

      for (const model of indexed) {
        let remaining = model.pedido
        if (remaining === 0) continue

        const slotSize = Math.max(loteMin, Math.min(loteMax, Math.ceil(remaining / 3 / 100) * 100))

        // First try to fit in weekdays only
        const daysNeeded = Math.min(weekdays.length, Math.max(1, Math.ceil(remaining / slotSize)))

        // Sort weekdays by load (balance)
        const sortedWeekdays = [...weekdays].sort((a, b) => {
          const loadDiff = dayLoad[a] - dayLoad[b]
          if (loadDiff !== 0) return loadDiff
          return dayModels[a] - dayModels[b]
        })

        const selectedDays = sortedWeekdays.slice(0, daysNeeded)

        // Distribute across selected weekdays
        const perDay = Math.floor(remaining / selectedDays.length / 100) * 100
        let leftover = remaining - perDay * selectedDays.length

        for (const d of selectedDays) {
          let assign = perDay
          if (leftover >= 100) {
            assign += 100
            leftover -= 100
          } else if (leftover > 0) {
            assign += leftover
            leftover = 0
          }
          newRowDays[model.idx][d as DayName] = assign
          dayLoad[d] += assign
          if (assign > 0) dayModels[d]++
        }
      }

      // Check if weekdays are overloaded — if so, spill to Saturday
      if (hasSab && weekdays.length > 0) {
        // Calculate average weekday load
        const avgWeekday = weekdays.reduce((s, d) => s + dayLoad[d], 0) / weekdays.length
        // Find the day config to estimate capacity (use plantilla-based rough cap)
        const sabConfig = dias.find((d) => d.nombre === 'Sab')
        const weekdayConfig = dias.find((d) => weekdays.includes(d.nombre))

        if (sabConfig && weekdayConfig) {
          // Estimate weekday capacity: plantilla * minutes * ~30 pares/person/hr / 60
          const weekdayCap = weekdayConfig.plantilla * (weekdayConfig.minutos / 60) * 30

          // If any weekday exceeds capacity, redistribute overflow to Saturday
          for (const wd of weekdays) {
            if (dayLoad[wd] > weekdayCap) {
              const overflow = dayLoad[wd] - weekdayCap
              // Find models on this day, move smallest ones to Saturday
              const modelsOnDay = indexed
                .filter((m) => newRowDays[m.idx][wd as DayName] > 0)
                .sort((a, b) => newRowDays[a.idx][wd as DayName] - newRowDays[b.idx][wd as DayName])

              let toMove = overflow
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

  // Clear all
  const handleClear = useCallback(() => {
    setRows((prev) => prev.map((r) => ({
      ...r,
      days: Object.fromEntries(DAY_ORDER.map((d) => [d, 0])) as Record<DayName, number>,
    })))
    setSaved(false)
  }, [])

  // Save weekly plan to Supabase (as a resultado with only weekly_schedule)
  const handleSave = useCallback(async () => {
    if (!currentSemana) return

    // Build weekly_schedule format matching WeeklyScheduleEntry
    const weeklySchedule = rows.flatMap((r) =>
      activeDays
        .filter((d) => r.days[d] > 0)
        .map((d) => ({
          Dia: d,
          Modelo: `${r.modelo_num} ${r.color}`.trim(),
          Fabrica: r.fabrica,
          Pares: r.days[d],
          HC_Necesario: 0, // will be computed when daily is generated
        }))
    )

    const totalPares = weeklySchedule.reduce((s, e) => s + e.Pares, 0)

    // Build weekly_summary
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

    // Check if there's already a manual plan for this week
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

    // Load as current result
    const { data: saved } = await supabase
      .from('resultados')
      .select('*')
      .eq('nombre', nombre)
      .single()

    if (saved) {
      useAppStore.getState().setCurrentResult(saved)
    }

    setSaved(true)
  }, [rows, activeDays, dayTotals, rowTotals, currentSemana, items, dayCapacity])

  // Generate daily schedule from saved weekly plan
  const handleGenerateDaily = useCallback(async () => {
    const currentResult = useAppStore.getState().currentResult
    if (!currentResult) return

    setGenerating(true)
    setGenError(null)

    try {
      const res = await generateDaily({
        resultado_id: currentResult.id,
      })

      // Load the new result with daily data
      const { data } = await supabase
        .from('resultados')
        .select('*')
        .eq('nombre', res.saved_as)
        .single()

      if (data) {
        useAppStore.getState().setCurrentResult(data as Resultado)
      }
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Error al generar diario')
    } finally {
      setGenerating(false)
    }
  }, [])

  // ============================================================
  // Render
  // ============================================================

  if (appStep < 1) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Carga un pedido en la pagina de Datos para comenzar la planificacion.
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando datos...
      </div>
    )
  }

  const grandTotal = rowTotals.reduce((s, t) => s + t, 0)
  const grandPedido = rows.reduce((s, r) => s + r.pedido, 0)
  const grandPendiente = Math.max(0, grandPedido - grandTotal)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Plan Semanal</h1>
          <p className="text-sm text-muted-foreground">
            {currentSemana} — {rows.length} modelos, {grandPedido.toLocaleString()} pares pedido
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleClear}>
            <RotateCcw className="mr-1 h-4 w-4" /> Limpiar
          </Button>
          <div className="flex items-center gap-1.5 rounded-md border border-border/50 px-2 py-1">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Lote/dia:</span>
            <Input
              type="number"
              min={100}
              step={100}
              value={loteMin}
              onChange={(e) => setLoteMin(Math.max(100, parseInt(e.target.value) || 100))}
              className="h-6 w-16 text-xs text-center p-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              title="Lote minimo por modelo por dia"
            />
            <span className="text-xs text-muted-foreground">—</span>
            <Input
              type="number"
              min={100}
              step={100}
              value={loteMax}
              onChange={(e) => setLoteMax(Math.max(loteMin, parseInt(e.target.value) || 400))}
              className="h-6 w-16 text-xs text-center p-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              title="Lote maximo por modelo por dia"
            />
          </div>
          <Button variant="outline" size="sm" onClick={handleAutoDistribute} disabled={autoLoading}>
            {autoLoading
              ? <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              : <Wand2 className="mr-1 h-4 w-4" />
            }
            Auto-distribuir
          </Button>
          <Button size="sm" onClick={handleSave}>
            {saved
              ? <><Check className="mr-1 h-4 w-4" /> Guardado</>
              : <><Save className="mr-1 h-4 w-4" /> Guardar plan</>
            }
          </Button>
          {saved && (
            <Button
              size="sm"
              variant={genError ? 'destructive' : 'default'}
              onClick={handleGenerateDaily}
              disabled={generating}
            >
              {generating ? (
                <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Generando diario...</>
              ) : (
                <><Play className="mr-1 h-4 w-4" /> Generar Diario</>
              )}
            </Button>
          )}
          {genError && (
            <span className="text-xs text-destructive">{genError}</span>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Total Asignado</p>
            <p className="text-xl font-bold">{grandTotal.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Total Pedido</p>
            <p className="text-xl font-bold">{grandPedido.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Pendiente</p>
            <p className={`text-xl font-bold ${grandPendiente > 0 ? 'text-destructive' : 'text-green-600'}`}>
              {grandPendiente.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Cobertura</p>
            <p className="text-xl font-bold">
              {grandPedido > 0 ? Math.min(100, Math.round((grandTotal / grandPedido) * 100)) : 0}%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Capacity bars per day */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Carga por Dia</CardTitle>
        </CardHeader>
        <CardContent className="pb-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {activeDays.map((d) => {
              const cap = dayCapacity[d]
              const assigned = dayTotals[d] || 0
              const pct = cap?.maxPares ? Math.round((assigned / cap.maxPares) * 100) : 0
              const overloaded = pct > 100

              return (
                <div key={d} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {d}
                      {d === 'Sab' && <span className="ml-1 text-[10px] text-amber-500 font-normal">T.E.</span>}
                    </span>
                    <span className={`text-xs ${overloaded ? 'text-destructive font-bold' : 'text-muted-foreground'}`}>
                      {pct}%
                    </span>
                  </div>
                  <Progress
                    value={Math.min(pct, 100)}
                    className={`h-2 ${overloaded ? '[&>div]:bg-destructive' : ''}`}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{assigned.toLocaleString()}p</span>
                    <span className="text-muted-foreground/60">{cap?.plantilla || 0} HC</span>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Weekly grid table */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Distribucion Semanal</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 bg-card z-10 min-w-[140px]">Modelo</TableHead>
                  <TableHead className="text-center min-w-[70px]">Pedido</TableHead>
                  {activeDays.map((d) => (
                    <TableHead key={d} className={`text-center min-w-[90px] ${d === 'Sab' ? 'text-amber-500' : ''}`}>
                      {d}{d === 'Sab' ? ' (T.E.)' : ''}
                    </TableHead>
                  ))}
                  <TableHead className="text-center min-w-[70px]">Total</TableHead>
                  <TableHead className="text-center min-w-[80px]">Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, ri) => {
                  const total = rowTotals[ri]
                  const pendiente = row.pedido - total
                  const over = total > row.pedido
                  const complete = total >= row.pedido

                  return (
                    <TableRow key={`${row.modelo_num}-${row.color}`}>
                      <TableCell className="sticky left-0 bg-card z-10 font-mono text-xs">
                        <div>{row.modelo_num}</div>
                        {row.color && (
                          <div className="text-muted-foreground text-[10px]">{row.color}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-center text-sm font-medium">
                        {row.pedido.toLocaleString()}
                      </TableCell>
                      {activeDays.map((d) => (
                        <TableCell key={d} className="p-1">
                          <Input
                            type="number"
                            min={0}
                            step={100}
                            value={row.days[d] || ''}
                            onChange={(e) => handleCellChange(ri, d, e.target.value)}
                            className="h-8 w-full text-center text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            placeholder="0"
                          />
                        </TableCell>
                      ))}
                      <TableCell className={`text-center font-bold text-sm ${over ? 'text-amber-500' : ''}`}>
                        {total.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-center">
                        {complete ? (
                          <Badge variant="default" className="bg-green-600 text-xs">OK</Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs">
                            -{pendiente}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}

                {/* Totals row */}
                <TableRow className="bg-primary/10 font-bold border-t-2 border-primary/30">
                  <TableCell className="sticky left-0 bg-primary/10 z-10 text-primary">TOTAL</TableCell>
                  <TableCell className="text-center text-primary">
                    {grandPedido.toLocaleString()}
                  </TableCell>
                  {activeDays.map((d) => {
                    const cap = dayCapacity[d]
                    const val = dayTotals[d] || 0
                    const overloaded = cap?.maxPares && val > cap.maxPares
                    return (
                      <TableCell
                        key={d}
                        className={`text-center ${overloaded ? 'text-destructive' : 'text-primary'}`}
                      >
                        {val.toLocaleString()}
                      </TableCell>
                    )
                  })}
                  <TableCell className="text-center text-primary">
                    {grandTotal.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-center">
                    {grandPendiente > 0 ? (
                      <span className="text-destructive flex items-center justify-center gap-1 text-xs">
                        <AlertTriangle className="h-3 w-3" /> -{grandPendiente}
                      </span>
                    ) : (
                      <Badge className="bg-green-600 text-xs">Completo</Badge>
                    )}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
