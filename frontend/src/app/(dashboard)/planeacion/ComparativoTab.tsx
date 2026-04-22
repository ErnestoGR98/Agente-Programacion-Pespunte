'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { KpiCard } from '@/components/shared/KpiCard'
import { cn } from '@/lib/utils'
import { STAGE_COLORS, CHART_COLORS } from '@/types'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ComposedChart, Line,
} from 'recharts'
import { BarChart3, Layers, TrendingUp, X, ChevronRight, ChevronDown } from 'lucide-react'

const ETAPAS = ['MAQ', 'PREL', 'ROBOT', 'POST', 'N/A'] as const
type Etapa = typeof ETAPAS[number]

const ETAPA_COLOR: Record<Etapa, string> = {
  PREL: STAGE_COLORS.PRELIMINAR,
  ROBOT: STAGE_COLORS.ROBOT,
  POST: STAGE_COLORS.POST,
  'N/A': STAGE_COLORS['N/A PRELIMINAR'],
  MAQ: STAGE_COLORS.MAQUILA,
}

const PROCESO_TO_ETAPA: Record<string, Etapa> = {
  PRELIMINARES: 'PREL',
  ROBOT: 'ROBOT',
  POST: 'POST',
  MAQUILA: 'MAQ',
  'N/A PRELIMINAR': 'N/A',
}

interface PlanStats {
  id: string
  nombre: string
  semana: string | null
  hrs: Record<Etapa, number>
  /** horas por etapa × modeloKey: total + desglose por fraccion/operacion */
  hrsByEtapaModelo: Record<Etapa, Record<string, {
    total: number
    ops: { fraccion: number; operacion: string; hrs: number }[]
  }>>
  totalHrs: number
  totalPares: number
  modelosActivos: number
}

export function ComparativoTab() {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<PlanStats[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedEtapa, setSelectedEtapa] = useState<Etapa | null>(null)
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set())

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const [planesRes, itemsRes, modsRes, opsRes] = await Promise.all([
        supabase.from('planes_semanales').select('id, nombre, semana, created_at'),
        supabase.from('plan_semanal_items').select('plan_id, modelo_num, color, pares'),
        supabase.from('catalogo_modelos').select('id, modelo_num'),
        supabase.from('catalogo_operaciones').select('modelo_id, fraccion, operacion, input_o_proceso, rate').order('fraccion'),
      ])
      const planes = (planesRes.data || []) as { id: string; nombre: string; semana: string | null; created_at: string }[]
      const items = (itemsRes.data || []) as { plan_id: string; modelo_num: string; color: string | null; pares: number }[]
      const mods = (modsRes.data || []) as { id: string; modelo_num: string }[]
      const ops = (opsRes.data || []) as { modelo_id: string; fraccion: number; operacion: string; input_o_proceso: string; rate: number | string }[]

      const modIdToNum = new Map<string, string>()
      for (const m of mods) modIdToNum.set(m.id, m.modelo_num)

      const opsByNum = new Map<string, { fraccion: number; operacion: string; etapa: Etapa; rate: number }[]>()
      for (const op of ops) {
        const num = modIdToNum.get(op.modelo_id)
        if (!num) continue
        const etapa = PROCESO_TO_ETAPA[op.input_o_proceso]
        if (!etapa) continue
        const rate = Number(op.rate)
        if (!opsByNum.has(num)) opsByNum.set(num, [])
        opsByNum.get(num)!.push({ fraccion: op.fraccion, operacion: op.operacion, etapa, rate })
      }

      const itemsByPlan = new Map<string, typeof items>()
      for (const it of items) {
        if (!itemsByPlan.has(it.plan_id)) itemsByPlan.set(it.plan_id, [])
        itemsByPlan.get(it.plan_id)!.push(it)
      }

      const planStats: PlanStats[] = []
      for (const p of planes) {
        const planItems = itemsByPlan.get(p.id) ?? []
        const hrs: Record<Etapa, number> = { PREL: 0, ROBOT: 0, POST: 0, 'N/A': 0, MAQ: 0 }
        const hrsByEtapaModelo: PlanStats['hrsByEtapaModelo'] = {
          PREL: {}, ROBOT: {}, POST: {}, 'N/A': {}, MAQ: {},
        }
        const paresByKey = new Map<string, { modelo_num: string; pares: number }>()
        let totalPares = 0
        for (const it of planItems) {
          if (!it.pares || it.pares <= 0) continue
          const key = it.color ? `${it.modelo_num} ${it.color}` : it.modelo_num
          const prev = paresByKey.get(key)
          paresByKey.set(key, {
            modelo_num: it.modelo_num,
            pares: (prev?.pares ?? 0) + it.pares,
          })
          totalPares += it.pares
        }
        for (const [key, { modelo_num, pares }] of paresByKey) {
          const modOps = opsByNum.get(modelo_num) ?? []
          for (const op of modOps) {
            if (op.rate <= 0) continue
            const h = pares / op.rate
            hrs[op.etapa] += h
            let entry = hrsByEtapaModelo[op.etapa][key]
            if (!entry) {
              entry = { total: 0, ops: [] }
              hrsByEtapaModelo[op.etapa][key] = entry
            }
            entry.total += h
            entry.ops.push({ fraccion: op.fraccion, operacion: op.operacion, hrs: h })
          }
        }
        const totalHrs = Object.values(hrs).reduce((s, v) => s + v, 0)
        planStats.push({
          id: p.id,
          nombre: p.nombre,
          semana: p.semana,
          hrs,
          hrsByEtapaModelo,
          totalHrs,
          totalPares,
          modelosActivos: paresByKey.size,
        })
      }

      planStats.sort((a, b) => a.nombre.localeCompare(b.nombre, undefined, { numeric: true }))
      setStats(planStats)
      setSelected(new Set(planStats.map((p) => p.id)))
      setLoading(false)
    })()
  }, [])

  const visible = useMemo(
    () => stats.filter((p) => selected.has(p.id)),
    [stats, selected],
  )

  // Chart 1: barras agrupadas — X=etapa, series=plan (semana)
  const etapasConDatos = useMemo(
    () => ETAPAS.filter((e) => visible.some((p) => p.hrs[e] > 0)),
    [visible],
  )

  const etapaChartData = useMemo(
    () => etapasConDatos.map((e) => {
      const row: Record<string, string | number> = { etapa: e }
      for (const p of visible) {
        row[p.nombre] = Math.round(p.hrs[e] * 10) / 10
      }
      return row
    }),
    [etapasConDatos, visible],
  )

  // Chart 2: combo — X=plan, bar=pares (right axis), line=carga total (left axis)
  const semanaChartData = useMemo(
    () => visible.map((p) => ({
      nombre: p.nombre,
      carga: Math.round(p.totalHrs * 10) / 10,
      pares: p.totalPares,
      modelos: p.modelosActivos,
    })),
    [visible],
  )

  // Plan unico que alimenta el drill. Si no hay seleccion explicita, usa el primero visible.
  const drillPlan = useMemo(() => {
    if (!visible.length) return null
    if (selectedPlanId) {
      const p = visible.find((x) => x.id === selectedPlanId)
      if (p) return p
    }
    return visible[0]
  }, [visible, selectedPlanId])

  // Drill-down: para selectedEtapa + drillPlan, modelos ordenados desc con desglose por fraccion.
  const drillData = useMemo(() => {
    if (!selectedEtapa || !drillPlan) return null
    const etapaMap = drillPlan.hrsByEtapaModelo[selectedEtapa]
    const rows = Object.entries(etapaMap).map(([key, entry]) => {
      // Agrupar ops por (fraccion, operacion) para ese plan
      const opsMap = new Map<string, { fraccion: number; operacion: string; total: number }>()
      for (const op of entry.ops) {
        const opKey = `${op.fraccion}|${op.operacion}`
        const bucket = opsMap.get(opKey)
        if (bucket) bucket.total += op.hrs
        else opsMap.set(opKey, { fraccion: op.fraccion, operacion: op.operacion, total: op.hrs })
      }
      const ops = Array.from(opsMap.values()).sort((a, b) => b.total - a.total)
      return { key, total: entry.total, ops }
    }).filter((r) => r.total > 0)
    rows.sort((a, b) => b.total - a.total)
    const totalEtapa = rows.reduce((s, r) => s + r.total, 0)
    const maxTotal = rows[0]?.total ?? 0
    return { rows, totalEtapa, maxTotal }
  }, [selectedEtapa, drillPlan])

  const summary = useMemo(() => {
    const agg: Record<Etapa, number> = { PREL: 0, ROBOT: 0, POST: 0, 'N/A': 0, MAQ: 0 }
    let hrs = 0
    let pares = 0
    let modsSum = 0
    for (const p of visible) {
      for (const e of ETAPAS) agg[e] += p.hrs[e]
      hrs += p.totalHrs
      pares += p.totalPares
      modsSum += p.modelosActivos
    }
    return { agg, hrs, pares, modsSum }
  }, [visible])

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
        <CardContent className="p-12 text-center text-muted-foreground">
          <Layers className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No hay planes guardados para comparar.</p>
          <p className="text-xs mt-1">Crea al menos uno en el tab &quot;Editor&quot; y guarda.</p>
        </CardContent>
      </Card>
    )
  }

  const toggleAll = () => {
    if (selected.size === stats.length) setSelected(new Set())
    else setSelected(new Set(stats.map((p) => p.id)))
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const planColor = (idx: number) => CHART_COLORS[idx % CHART_COLORS.length]

  return (
    <div className="space-y-6">
      {/* Plan selector */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Planes a comparar
              <span className="text-xs text-muted-foreground font-normal">
                ({selected.size} / {stats.length})
              </span>
            </h2>
            <button
              onClick={toggleAll}
              className="text-xs text-primary hover:underline"
            >
              {selected.size === stats.length ? 'Desmarcar todos' : 'Marcar todos'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {stats.map((p) => {
              const isOn = selected.has(p.id)
              return (
                <button
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  className={cn(
                    'px-3 py-1 rounded-full text-xs border transition-colors',
                    isOn
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-muted-foreground border-input hover:bg-accent',
                  )}
                >
                  {p.nombre}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground text-sm">
            Selecciona al menos un plan para comparar
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <KpiCard label="Planes" value={String(visible.length)} />
            <KpiCard label="Total Horas" value={summary.hrs.toFixed(1)} />
            <KpiCard label="Total Pares" value={summary.pares.toLocaleString()} />
            <KpiCard label="Modelos activos" value={String(summary.modsSum)} />
            {ETAPAS.map((e) =>
              summary.agg[e] > 0 ? (
                <KpiCard key={e} label={e} value={summary.agg[e].toFixed(1) + ' hrs'} />
              ) : null,
            )}
          </div>

          {/* Tablas + charts en grid 2 columnas */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Tabla 1: etapa × semana */}
            <Card>
              <CardContent className="p-4">
                <h2 className="font-semibold text-sm mb-3">Horas por etapa</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[#1F4E79] text-white">
                        <th className="text-left py-2 px-3">Etapa</th>
                        {visible.map((p) => (
                          <th key={p.id} className="text-center py-2 px-3 min-w-[80px]">
                            {p.nombre}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {etapasConDatos.map((e) => (
                        <tr key={e} className="border-b">
                          <td
                            className="py-1.5 px-3 text-xs font-bold"
                            style={{ color: ETAPA_COLOR[e] }}
                          >
                            {e}
                          </td>
                          {visible.map((p) => (
                            <td key={p.id} className="py-1.5 px-3 text-center text-xs">
                              {p.hrs[e] > 0 ? p.hrs[e].toFixed(1) : '-'}
                            </td>
                          ))}
                        </tr>
                      ))}
                      <tr className="border-b bg-muted/40 font-semibold">
                        <td className="py-2 px-3 text-xs">TOTAL</td>
                        {visible.map((p) => (
                          <td key={p.id} className="py-2 px-3 text-center text-xs">
                            {p.totalHrs.toFixed(1)}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Tabla 2: resumen por semana */}
            <Card>
              <CardContent className="p-4">
                <h2 className="font-semibold text-sm mb-3">Resumen por semana</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[#1F4E79] text-white">
                        <th className="text-left py-2 px-3">Semana</th>
                        <th className="text-center py-2 px-3">Carga total (h)</th>
                        <th className="text-center py-2 px-3">Pares totales</th>
                        <th className="text-center py-2 px-3">Modelos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((p) => (
                        <tr key={p.id} className="border-b">
                          <td className="py-1.5 px-3 text-xs font-medium">{p.nombre}</td>
                          <td className="py-1.5 px-3 text-center text-xs">
                            {p.totalHrs.toFixed(1)}
                          </td>
                          <td className="py-1.5 px-3 text-center text-xs">
                            {p.totalPares.toLocaleString()}
                          </td>
                          <td className="py-1.5 px-3 text-center text-xs">
                            {p.modelosActivos}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-b bg-muted/40 font-semibold">
                        <td className="py-2 px-3 text-xs">TOTAL</td>
                        <td className="py-2 px-3 text-center text-xs">
                          {summary.hrs.toFixed(1)}
                        </td>
                        <td className="py-2 px-3 text-center text-xs">
                          {summary.pares.toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-center text-xs">
                          {summary.modsSum}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Chart 1: barras agrupadas etapa × semana */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold flex items-center gap-2 text-sm">
                    <BarChart3 className="h-4 w-4" />
                    Horas por etapa — {visible.map((p) => p.nombre).join(' vs ')}
                  </h2>
                  <span className="text-[10px] text-muted-foreground italic">
                    Click en una barra para ver detalle
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={etapaChartData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="etapa" />
                    <YAxis label={{ value: 'Horas', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
                    <Tooltip
                      formatter={(v) => (typeof v === 'number' ? v.toFixed(1) + ' hrs' : String(v))}
                    />
                    <Legend />
                    {visible.map((p, idx) => (
                      <Bar
                        key={p.id}
                        dataKey={p.nombre}
                        fill={planColor(idx)}
                        radius={[3, 3, 0, 0]}
                        style={{ cursor: 'pointer' }}
                        onClick={(data: unknown) => {
                          const etapa = (data as { etapa?: string } | null)?.etapa
                          if (etapa && (ETAPAS as readonly string[]).includes(etapa)) {
                            setSelectedEtapa(etapa as Etapa)
                            setSelectedPlanId(p.id)
                            setExpandedModels(new Set())
                          }
                        }}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Chart 2: combo carga + pares por semana */}
            <Card>
              <CardContent className="p-4">
                <h2 className="font-semibold flex items-center gap-2 mb-3 text-sm">
                  <TrendingUp className="h-4 w-4" />
                  Carga total (h) vs Pares totales por semana
                </h2>
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={semanaChartData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="nombre" />
                    <YAxis
                      yAxisId="left"
                      orientation="left"
                      label={{ value: 'Horas', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      label={{ value: 'Pares', angle: 90, position: 'insideRight', style: { fontSize: 11 } }}
                    />
                    <Tooltip />
                    <Legend />
                    <Bar
                      yAxisId="right"
                      dataKey="pares"
                      name="Pares totales"
                      fill="#C0504D"
                      radius={[3, 3, 0, 0]}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="carga"
                      name="Carga total (h)"
                      stroke="#4472C4"
                      strokeWidth={2}
                      dot={{ r: 6, fill: '#4472C4' }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Drill-down panel: UNA semana a la vez */}
          {selectedEtapa && drillData && drillPlan && (() => {
            const drillPlanIdx = visible.findIndex((p) => p.id === drillPlan.id)
            const drillColor = planColor(drillPlanIdx >= 0 ? drillPlanIdx : 0)
            return (
            <Card className="border-2" style={{ borderColor: ETAPA_COLOR[selectedEtapa] }}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                  <h2 className="font-semibold text-sm flex items-center gap-2 flex-wrap">
                    Detalle
                    <span
                      className="inline-block px-2 py-0.5 rounded text-xs font-bold text-white"
                      style={{ backgroundColor: ETAPA_COLOR[selectedEtapa] }}
                    >
                      {selectedEtapa}
                    </span>
                    <span className="text-muted-foreground font-normal">en</span>
                    <span
                      className="inline-block px-2 py-0.5 rounded text-xs font-bold text-white"
                      style={{ backgroundColor: drillColor }}
                    >
                      {drillPlan.nombre}
                    </span>
                    <span className="text-xs text-muted-foreground font-normal">
                      — {drillData.rows.length} modelo(s), {drillData.totalEtapa.toFixed(1)} hrs
                    </span>
                  </h2>
                  <div className="flex items-center gap-2">
                    {visible.length > 1 && (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-muted-foreground mr-1">Cambiar semana:</span>
                        {visible.map((p, idx) => {
                          const isActive = p.id === drillPlan.id
                          return (
                            <button
                              key={p.id}
                              onClick={() => {
                                setSelectedPlanId(p.id)
                                setExpandedModels(new Set())
                              }}
                              className={cn(
                                'px-2 py-0.5 rounded text-[11px] border transition-colors',
                                isActive ? 'text-white border-transparent font-semibold' : 'text-muted-foreground border-input hover:bg-accent',
                              )}
                              style={isActive ? { backgroundColor: planColor(idx) } : undefined}
                            >
                              {p.nombre}
                            </button>
                          )
                        })}
                      </div>
                    )}
                    <button
                      onClick={() => {
                        setSelectedEtapa(null)
                        setSelectedPlanId(null)
                      }}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      aria-label="Cerrar"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {drillData.rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    Ningun modelo aporta horas a esta etapa en {drillPlan.nombre}.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {drillData.rows.map((row) => {
                      const pct = drillData.totalEtapa > 0
                        ? (row.total / drillData.totalEtapa) * 100
                        : 0
                      const widthPct = drillData.maxTotal > 0
                        ? (row.total / drillData.maxTotal) * 100
                        : 0
                      const isExpanded = expandedModels.has(row.key)
                      const toggleExpand = () => {
                        setExpandedModels((prev) => {
                          const next = new Set(prev)
                          if (next.has(row.key)) next.delete(row.key)
                          else next.add(row.key)
                          return next
                        })
                      }
                      const maxOpTotal = row.ops[0]?.total ?? 0
                      return (
                        <div key={row.key} className="rounded overflow-hidden">
                          <button
                            onClick={toggleExpand}
                            className="w-full flex items-center gap-3 py-1 px-1 hover:bg-muted/30 text-left"
                          >
                            <div className="w-5 shrink-0 text-muted-foreground">
                              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            </div>
                            <div className="w-28 shrink-0 text-xs font-medium truncate" title={row.key}>
                              {row.key}
                            </div>
                            <div className="flex-1 relative h-6 bg-muted/20 rounded overflow-hidden">
                              <div
                                className="h-full flex items-center justify-end pr-2 text-[11px] font-semibold text-white"
                                style={{
                                  width: `${widthPct}%`,
                                  backgroundColor: drillColor,
                                }}
                              >
                                {widthPct >= 15 ? row.total.toFixed(1) : ''}
                              </div>
                            </div>
                            <div className="w-20 shrink-0 text-right text-xs font-bold">
                              {row.total.toFixed(1)} h
                            </div>
                            <div className="w-12 shrink-0 text-right text-[11px] text-muted-foreground">
                              {pct.toFixed(1)}%
                            </div>
                          </button>

                          {isExpanded && row.ops.length > 0 && (
                            <div
                              className="pl-10 pr-1 py-2 space-y-1 bg-muted/10 border-l-2"
                              style={{ borderColor: ETAPA_COLOR[selectedEtapa] }}
                            >
                              <div className="flex items-center gap-3 pb-1 text-[10px] text-muted-foreground uppercase tracking-wider">
                                <div className="w-6 shrink-0" />
                                <div className="w-52 shrink-0">Fraccion · Operacion</div>
                                <div className="flex-1">Distribucion</div>
                                <div className="w-20 text-right">Horas</div>
                                <div className="w-12 text-right">% mod</div>
                              </div>
                              {row.ops.map((op) => {
                                const opPct = row.total > 0 ? (op.total / row.total) * 100 : 0
                                const opWidth = maxOpTotal > 0 ? (op.total / maxOpTotal) * 100 : 0
                                return (
                                  <div
                                    key={`${op.fraccion}-${op.operacion}`}
                                    className="flex items-center gap-3 py-0.5"
                                  >
                                    <div className="w-6 shrink-0 text-[10px] text-muted-foreground font-mono text-right">
                                      {op.fraccion}
                                    </div>
                                    <div className="w-52 shrink-0 text-xs truncate" title={op.operacion}>
                                      {op.operacion}
                                    </div>
                                    <div className="flex-1 relative h-4 bg-muted/20 rounded overflow-hidden">
                                      <div
                                        className="h-full flex items-center justify-end pr-1.5 text-[10px] font-semibold text-white"
                                        style={{
                                          width: `${opWidth}%`,
                                          backgroundColor: drillColor,
                                        }}
                                      >
                                        {opWidth >= 25 ? op.total.toFixed(1) : ''}
                                      </div>
                                    </div>
                                    <div className="w-20 shrink-0 text-right text-xs font-semibold">
                                      {op.total.toFixed(1)} h
                                    </div>
                                    <div className="w-12 shrink-0 text-right text-[10px] text-muted-foreground">
                                      {opPct.toFixed(0)}%
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
            )
          })()}
        </>
      )}
    </div>
  )
}
