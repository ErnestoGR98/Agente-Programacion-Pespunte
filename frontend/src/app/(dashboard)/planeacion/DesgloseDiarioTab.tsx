'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { KpiCard } from '@/components/shared/KpiCard'
import { STAGE_COLORS, CHART_COLORS, DAY_ORDER } from '@/types'
import type { DayName } from '@/types'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, LabelList, ReferenceLine,
} from 'recharts'
import { BarChart3, TrendingUp, Layers, Clock, ChevronDown, ChevronRight, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const ETAPAS = ['MAQ', 'PREL', 'ROBOT', 'POST', 'N/A'] as const
type Etapa = typeof ETAPAS[number]

// Display label: enum interno se mantiene 'N/A' pero en UI se muestra descriptivo.
// Las demas etapas se muestran tal cual.
const ETAPA_LABEL: Record<Etapa, string> = {
  MAQ: 'MAQ',
  PREL: 'PREL',
  ROBOT: 'ROBOT',
  POST: 'POST',
  'N/A': 'N/A PRELIMINAR (Proceso directo a ensamble)',
}
const ETAPA_LABEL_SHORT: Record<Etapa, string> = {
  MAQ: 'MAQ',
  PREL: 'PREL',
  ROBOT: 'ROBOT',
  POST: 'POST',
  'N/A': 'N/A PRELIMINAR',
}

// Cada persona aporta 9 horas productivas al dia
const HRS_POR_PERSONA = 9
const toPersonas = (horas: number) => horas / HRS_POR_PERSONA

// Paleta high-contrast para fondos oscuros (override local — STAGE_COLORS
// global esta calibrado para fondos claros y N/A queda muy grisaceo)
const ETAPA_COLOR: Record<Etapa, string> = {
  MAQ: '#f43f5e',   // rose-500 (rojo vibrante)
  PREL: '#fbbf24',  // amber-400 (mas claro/saturado que amber-500)
  ROBOT: '#10b981', // emerald-500
  POST: '#ec4899',  // pink-500
  'N/A': '#60a5fa', // blue-400 (en vez de slate gris)
}

const PROCESO_TO_ETAPA: Record<string, Etapa> = {
  PRELIMINARES: 'PREL',
  ROBOT: 'ROBOT',
  POST: 'POST',
  MAQUILA: 'MAQ',
  'N/A PRELIMINAR': 'N/A',
}

interface PlanDayStats {
  id: string
  nombre: string
  hrsByEtapaByDay: Record<Etapa, Partial<Record<DayName, number>>>
  totalHrs: number
}

function planColor(idx: number) {
  return CHART_COLORS[idx % CHART_COLORS.length]
}

export function DesgloseDiarioTab() {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<PlanDayStats[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showTable, setShowTable] = useState(false)

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const [planesRes, itemsRes, modsRes, opsRes] = await Promise.all([
        supabase.from('planes_semanales').select('id, nombre, created_at').order('created_at'),
        supabase.from('plan_semanal_items').select('plan_id, modelo_num, dia, pares'),
        supabase.from('catalogo_modelos').select('id, modelo_num'),
        supabase.from('catalogo_operaciones').select('modelo_id, fraccion, input_o_proceso, rate'),
      ])
      const planes = (planesRes.data || []) as { id: string; nombre: string }[]
      const items = (itemsRes.data || []) as { plan_id: string; modelo_num: string; dia: string; pares: number }[]
      const mods = (modsRes.data || []) as { id: string; modelo_num: string }[]
      const ops = (opsRes.data || []) as { modelo_id: string; fraccion: number; input_o_proceso: string; rate: number | string }[]

      const modIdToNum = new Map<string, string>()
      for (const m of mods) modIdToNum.set(m.id, m.modelo_num)

      const opsByNum = new Map<string, { etapa: Etapa; rate: number }[]>()
      for (const op of ops) {
        const num = modIdToNum.get(op.modelo_id)
        if (!num) continue
        const etapa = PROCESO_TO_ETAPA[op.input_o_proceso]
        if (!etapa) continue
        const rate = Number(op.rate)
        if (rate <= 0) continue
        if (!opsByNum.has(num)) opsByNum.set(num, [])
        opsByNum.get(num)!.push({ etapa, rate })
      }

      const itemsByPlan = new Map<string, typeof items>()
      for (const it of items) {
        if (!itemsByPlan.has(it.plan_id)) itemsByPlan.set(it.plan_id, [])
        itemsByPlan.get(it.plan_id)!.push(it)
      }

      const planStats: PlanDayStats[] = []
      for (const p of planes) {
        const planItems = itemsByPlan.get(p.id) ?? []
        const hrsByEtapaByDay: PlanDayStats['hrsByEtapaByDay'] = {
          PREL: {}, ROBOT: {}, POST: {}, 'N/A': {}, MAQ: {},
        }
        let totalHrs = 0
        for (const it of planItems) {
          if (!it.pares || it.pares <= 0) continue
          const dia = it.dia as DayName
          const modOps = opsByNum.get(it.modelo_num) ?? []
          for (const op of modOps) {
            const h = it.pares / op.rate
            const byDay = hrsByEtapaByDay[op.etapa]
            byDay[dia] = (byDay[dia] ?? 0) + h
            totalHrs += h
          }
        }
        planStats.push({ id: p.id, nombre: p.nombre, hrsByEtapaByDay, totalHrs })
      }

      setStats(planStats)
      setSelected(new Set(planStats.map((p) => p.id)))
      setLoading(false)
    })()
  }, [])

  const visible = useMemo(
    () => stats.filter((p) => selected.has(p.id)),
    [stats, selected],
  )

  // Aggregates para KPIs (suma de planes visibles)
  const aggregates = useMemo(() => {
    const totalHrs = visible.reduce((s, p) => s + p.totalHrs, 0)
    const hrsByDay: Record<string, number> = {}
    const hrsByEtapa: Record<Etapa, number> = { PREL: 0, ROBOT: 0, POST: 0, 'N/A': 0, MAQ: 0 }
    for (const p of visible) {
      for (const e of ETAPAS) {
        const byDay = p.hrsByEtapaByDay[e] ?? {}
        for (const [d, h] of Object.entries(byDay)) {
          hrsByDay[d] = (hrsByDay[d] ?? 0) + (h ?? 0)
          hrsByEtapa[e] += (h ?? 0)
        }
      }
    }
    let peakDay = '—'
    let peakDayHrs = 0
    for (const [d, h] of Object.entries(hrsByDay)) {
      if (h > peakDayHrs) { peakDayHrs = h; peakDay = d }
    }
    let topEtapa: Etapa | null = null
    let topEtapaHrs = 0
    for (const e of ETAPAS) {
      if (hrsByEtapa[e] > topEtapaHrs) { topEtapaHrs = hrsByEtapa[e]; topEtapa = e }
    }
    return { totalHrs, hrsByDay, hrsByEtapa, peakDay, peakDayHrs, topEtapa, topEtapaHrs }
  }, [visible])

  // Datos del chart comparativo: por dia, una columna por plan visible
  const compareLineData = useMemo(() => {
    return DAY_ORDER.map((d) => {
      const row: Record<string, number | string> = { dia: d }
      for (const p of visible) {
        const total = ETAPAS.reduce((s, e) => s + (p.hrsByEtapaByDay[e]?.[d] ?? 0), 0)
        row[p.nombre] = total
      }
      return row
    }).filter((row) => visible.some((p) => Number(row[p.nombre] ?? 0) > 0))
  }, [visible])

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (stats.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          No hay planes guardados todavia.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Selector de planes */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm">
              <Layers className="h-4 w-4" />
              Planes a comparar
              <span className="text-xs text-muted-foreground font-normal">
                ({selected.size} / {stats.length})
              </span>
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelected(new Set(stats.map((p) => p.id)))}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Marcar todos
              </button>
              <span className="text-xs text-muted-foreground">·</span>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Desmarcar todos
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {stats.map((p) => {
              const isSel = selected.has(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleSelected(p.id)}
                  className={cn(
                    'px-3 py-1 rounded-md border text-xs font-medium transition-colors flex items-center gap-1.5',
                    isSel
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted/40 hover:bg-muted',
                  )}
                >
                  {p.nombre}
                  {isSel && <X className="h-3 w-3" />}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Selecciona al menos un plan arriba para ver el desglose.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KpiCard
              label="Total Horas"
              value={aggregates.totalHrs.toFixed(1)}
            />
            <KpiCard
              label="Personas requeridas"
              value={toPersonas(aggregates.totalHrs).toFixed(1)}
            />
            <KpiCard
              label="Dia mas cargado"
              value={aggregates.peakDay === '—' ? '—' : `${aggregates.peakDay} · ${toPersonas(aggregates.peakDayHrs).toFixed(1)} p`}
            />
            <KpiCard
              label="Etapa principal"
              value={aggregates.topEtapa ? `${ETAPA_LABEL_SHORT[aggregates.topEtapa]} · ${toPersonas(aggregates.topEtapaHrs).toFixed(1)} p` : '—'}
            />
            <KpiCard
              label="Planes activos"
              value={String(visible.length)}
            />
          </div>

          {/* Charts separados — un mini-chart por (plan, etapa) */}
          <div className="space-y-4">
            {visible.map((p, idx) => {
              // Dias activos del plan (al menos una etapa tiene > 0 ese dia)
              const diasActivosPlan = DAY_ORDER.filter((d) =>
                ETAPAS.some((e) => (p.hrsByEtapaByDay[e]?.[d] ?? 0) > 0),
              )
              // Etapas con al menos un dia con datos
              const etapasConDatos = ETAPAS.filter((e) =>
                DAY_ORDER.some((d) => (p.hrsByEtapaByDay[e]?.[d] ?? 0) > 0),
              )
              if (etapasConDatos.length === 0) {
                return (
                  <Card key={p.id}>
                    <CardContent className="p-4">
                      <h3 className="font-semibold text-sm flex items-center gap-2">
                        <BarChart3 className="h-4 w-4" style={{ color: planColor(idx) }} />
                        {p.nombre}
                      </h3>
                      <p className="text-xs text-muted-foreground py-4 text-center">Sin produccion en este plan.</p>
                    </CardContent>
                  </Card>
                )
              }
              return (
                <Card key={p.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-semibold text-sm flex items-center gap-2">
                        <BarChart3 className="h-4 w-4" style={{ color: planColor(idx) }} />
                        {p.nombre}
                      </h3>
                      <span className="text-xs text-muted-foreground">
                        {p.totalHrs.toFixed(1)} h · {toPersonas(p.totalHrs).toFixed(1)} personas
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {etapasConDatos.map((e) => {
                        const color = ETAPA_COLOR[e]
                        // Mostrar TODOS los dias activos del plan (con 0 si esta etapa no trabaja ese dia)
                        // para que las barras y celdas queden alineadas entre etapas
                        const chartData = diasActivosPlan.map((d) => ({
                          dia: d,
                          hrs: p.hrsByEtapaByDay[e]?.[d] ?? 0,
                        }))
                        const totalEtapa = chartData.reduce((s, r) => s + r.hrs, 0)
                        // Promedio de los dias CON produccion (linea de referencia)
                        const diasConProd = chartData.filter((r) => r.hrs > 0)
                        const avgEtapa = diasConProd.length > 0
                          ? totalEtapa / diasConProd.length
                          : 0
                        return (
                          <div
                            key={e}
                            className="rounded-md border overflow-hidden"
                          >
                            <div
                              className="px-3 py-1.5 text-sm font-bold flex items-center justify-between text-white gap-2"
                              style={{ backgroundColor: color }}
                            >
                              <span className="truncate" title={ETAPA_LABEL[e]}>{ETAPA_LABEL[e]}</span>
                              <span className="text-xs font-semibold whitespace-nowrap">
                                {totalEtapa.toFixed(1)} h · {toPersonas(totalEtapa).toFixed(1)} p
                              </span>
                            </div>
                            {/* Chart con padding lateral fijo para que el plot area coincida con las celdas de dia de la tabla */}
                            <div style={{ paddingLeft: 64, paddingRight: 64 }}>
                              <ResponsiveContainer width="100%" height={150}>
                                <BarChart
                                  data={chartData}
                                  margin={{ top: 18, right: 0, bottom: 4, left: 0 }}
                                >
                                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.12)" />
                                  <XAxis
                                    dataKey="dia"
                                    tick={{ fontSize: 12, fontWeight: 600, fill: 'currentColor' }}
                                    tickLine={false}
                                    axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                                  />
                                  <YAxis hide />
                                  <Tooltip
                                    formatter={(v: number | undefined) => {
                                      const h = v ?? 0
                                      return [`${h.toFixed(1)} h · ${toPersonas(h).toFixed(1)} p`, e]
                                    }}
                                    contentStyle={{ fontSize: 12, fontWeight: 600 }}
                                  />
                                  {avgEtapa > 0 && (
                                    <ReferenceLine
                                      y={avgEtapa}
                                      stroke="rgba(255,255,255,0.55)"
                                      strokeDasharray="4 3"
                                      strokeWidth={1.5}
                                      label={{
                                        value: `x̄ ${avgEtapa.toFixed(1)}h`,
                                        position: 'insideTopLeft',
                                        fill: 'currentColor',
                                        fontSize: 9,
                                        fontWeight: 700,
                                      }}
                                    />
                                  )}
                                  <Bar dataKey="hrs" fill={color} radius={[3, 3, 0, 0]}>
                                    <LabelList
                                      dataKey="hrs"
                                      position="top"
                                      formatter={(v) => {
                                        const h = Number(v ?? 0)
                                        if (h === 0) return ''
                                        return `${h.toFixed(1)}h · ${toPersonas(h).toFixed(1)}p`
                                      }}
                                      style={{ fontSize: 10, fontWeight: 700, fill: 'currentColor' }}
                                    />
                                  </Bar>
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                            {/* Tabla con table-fixed y col widths que matchean con el padding del chart */}
                            <table className="w-full text-xs border-t tabular-nums" style={{ tableLayout: 'fixed' }}>
                              <colgroup>
                                <col style={{ width: '64px' }} />
                                {chartData.map((row) => <col key={row.dia} />)}
                                <col style={{ width: '64px' }} />
                              </colgroup>
                              <thead>
                                <tr
                                  className="text-white"
                                  style={{ backgroundColor: color }}
                                >
                                  <th className="text-left px-2 py-1 font-semibold">Dia</th>
                                  {chartData.map((row) => (
                                    <th key={row.dia} className="text-center px-1 py-1 font-semibold">
                                      {row.dia}
                                    </th>
                                  ))}
                                  <th className="text-center px-2 py-1 font-semibold border-l border-white/30">
                                    Total
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr className="border-b">
                                  <td className="px-2 py-0.5 font-medium text-muted-foreground">Horas</td>
                                  {chartData.map((row) => (
                                    <td key={row.dia} className="px-1 py-0.5 text-center">
                                      {row.hrs.toFixed(1)}
                                    </td>
                                  ))}
                                  <td className="px-2 py-0.5 text-center font-semibold border-l">
                                    {totalEtapa.toFixed(1)}
                                  </td>
                                </tr>
                                <tr>
                                  <td className="px-2 py-0.5 font-medium text-muted-foreground">Personas</td>
                                  {chartData.map((row) => (
                                    <td key={row.dia} className="px-1 py-0.5 text-center">
                                      {toPersonas(row.hrs).toFixed(1)}
                                    </td>
                                  ))}
                                  <td className="px-2 py-0.5 text-center font-semibold border-l">
                                    {toPersonas(totalEtapa).toFixed(1)}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Chart comparativo: lineas por plan */}
          {visible.length > 1 && compareLineData.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <h2 className="font-semibold flex items-center gap-2 mb-3 text-sm">
                  <TrendingUp className="h-4 w-4" />
                  Carga total por dia — comparativo
                </h2>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={compareLineData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="dia" tick={{ fontSize: 12 }} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      label={{ value: 'Horas', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }}
                    />
                    <Tooltip
                      formatter={(v: number | undefined) => {
                        const h = v ?? 0
                        return `${h.toFixed(1)} h · ${toPersonas(h).toFixed(1)} p`
                      }}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {visible.map((p, idx) => (
                      <Line
                        key={p.id}
                        type="monotone"
                        dataKey={p.nombre}
                        stroke={planColor(idx)}
                        strokeWidth={2}
                        dot={{ r: 5, fill: planColor(idx) }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Tabla detallada (colapsable) */}
          <Card>
            <CardContent className="p-4">
              <button
                type="button"
                onClick={() => setShowTable((v) => !v)}
                className="flex items-center gap-2 text-sm font-semibold hover:text-primary transition-colors"
              >
                {showTable ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <Clock className="h-4 w-4" />
                Tabla detallada (horas por dia y etapa)
              </button>
              {showTable && (
                <div className="mt-4 space-y-4">
                  {visible.map((p) => {
                    const diasConDatos = DAY_ORDER.filter((d) =>
                      ETAPAS.some((e) => (p.hrsByEtapaByDay[e]?.[d] ?? 0) > 0),
                    )
                    const etapasConDatos = ETAPAS.filter((e) =>
                      diasConDatos.some((d) => (p.hrsByEtapaByDay[e]?.[d] ?? 0) > 0),
                    )
                    if (diasConDatos.length === 0) return null
                    return (
                      <div key={p.id} className="rounded-md border overflow-hidden">
                        <div className="px-3 py-1.5 bg-muted/30 border-b text-xs font-semibold">
                          {p.nombre}
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-[#1F4E79] text-white">
                                <th className="text-left py-1.5 px-3">Etapa</th>
                                {diasConDatos.map((d) => (
                                  <th key={d} className="text-center py-1.5 px-3 min-w-[90px]">{d}</th>
                                ))}
                                <th className="text-center py-1.5 px-3 min-w-[90px]">Total</th>
                              </tr>
                              <tr className="bg-[#1F4E79]/80 text-white text-[10px]">
                                <th></th>
                                {diasConDatos.map((d) => (
                                  <th key={d} className="text-center pb-1 px-3 font-normal">h · personas</th>
                                ))}
                                <th className="text-center pb-1 px-3 font-normal">h · personas</th>
                              </tr>
                            </thead>
                            <tbody>
                              {etapasConDatos.map((e) => {
                                const rowTotal = diasConDatos.reduce(
                                  (s, d) => s + (p.hrsByEtapaByDay[e]?.[d] ?? 0), 0,
                                )
                                return (
                                  <tr key={e} className="border-b">
                                    <td
                                      className="py-1 px-3 text-xs font-bold"
                                      style={{ color: ETAPA_COLOR[e] }}
                                      title={ETAPA_LABEL[e]}
                                    >
                                      {ETAPA_LABEL_SHORT[e]}
                                    </td>
                                    {diasConDatos.map((d) => {
                                      const v = p.hrsByEtapaByDay[e]?.[d] ?? 0
                                      return (
                                        <td key={d} className="py-1 px-3 text-center text-xs">
                                          {v > 0 ? `${v.toFixed(1)} · ${toPersonas(v).toFixed(1)}` : '-'}
                                        </td>
                                      )
                                    })}
                                    <td className="py-1 px-3 text-center text-xs font-medium">
                                      {rowTotal > 0 ? `${rowTotal.toFixed(1)} · ${toPersonas(rowTotal).toFixed(1)}` : '-'}
                                    </td>
                                  </tr>
                                )
                              })}
                              <tr className="bg-muted/40 font-semibold">
                                <td className="py-1.5 px-3 text-xs">TOTAL</td>
                                {diasConDatos.map((d) => {
                                  const colTotal = etapasConDatos.reduce(
                                    (s, e) => s + (p.hrsByEtapaByDay[e]?.[d] ?? 0), 0,
                                  )
                                  return (
                                    <td key={d} className="py-1.5 px-3 text-center text-xs">
                                      {colTotal > 0 ? `${colTotal.toFixed(1)} · ${toPersonas(colTotal).toFixed(1)}` : '-'}
                                    </td>
                                  )
                                })}
                                <td className="py-1.5 px-3 text-center text-xs">
                                  {`${p.totalHrs.toFixed(1)} · ${toPersonas(p.totalHrs).toFixed(1)}`}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
