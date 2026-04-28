'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { KpiCard } from '@/components/shared/KpiCard'
import { cn } from '@/lib/utils'
import { STAGE_COLORS, CHART_COLORS } from '@/types'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ComposedChart, Line, LabelList, Cell, ReferenceLine,
} from 'recharts'
import { BarChart3, Bot, Layers, TrendingUp, X, ChevronRight, ChevronDown } from 'lucide-react'

const ETAPAS = ['MAQ', 'PREL', 'ROBOT', 'POST', 'N/A'] as const
type Etapa = typeof ETAPAS[number]

const ETAPA_COLOR: Record<Etapa, string> = {
  PREL: STAGE_COLORS.PRELIMINAR,
  ROBOT: STAGE_COLORS.ROBOT,
  POST: STAGE_COLORS.POST,
  'N/A': STAGE_COLORS['N/A PRELIMINAR'],
  MAQ: STAGE_COLORS.MAQUILA,
}

// Display labels — N/A se muestra mas descriptivo en UI sin tocar el enum
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

// Paleta vibrante para detalle por modelo (independiente de CHART_COLORS
// que representan semanas)
const DETAIL_COLORS = [
  '#ef4444', // red
  '#f59e0b', // amber
  '#10b981', // emerald
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#f97316', // orange
  '#6366f1', // indigo
]

const PROCESO_TO_ETAPA: Record<string, Etapa> = {
  PRELIMINARES: 'PREL',
  ROBOT: 'ROBOT',
  POST: 'POST',
  MAQUILA: 'MAQ',
  'N/A PRELIMINAR': 'N/A',
}

interface RobotOpContribution {
  modelo_num: string
  color: string
  fraccion: number
  operacion: string
  hrs: number
  /** solo en vista asignada: porcentaje del robot en esa op */
  pct?: number
}

interface RobotLoad {
  total: number
  byOp: RobotOpContribution[]
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
  /** Carga por robot: reparto equitativo entre los robots con estado=TIENE */
  loadByRobotAuto: Record<string, RobotLoad>
  /** Carga por robot: segun asignacion manual (plan_robot_asignacion) */
  loadByRobotAsignado: Record<string, RobotLoad>
  /** Horas ROBOT del plan que no se pudieron distribuir (ninguna entrada en matriz) */
  horasRobotSinMatriz: number
}

interface RobotLite { id: string; nombre: string; estado: string }

export function ComparativoTab() {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<PlanStats[]>([])
  const [robots, setRobots] = useState<RobotLite[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedEtapa, setSelectedEtapa] = useState<Etapa | null>(null)
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set())

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const [planesRes, itemsRes, modsRes, opsRes, robotsRes, programaRes, asignRes] = await Promise.all([
        supabase.from('planes_semanales').select('id, nombre, semana, created_at'),
        supabase.from('plan_semanal_items').select('plan_id, modelo_num, color, pares'),
        supabase.from('catalogo_modelos').select('id, modelo_num'),
        supabase.from('catalogo_operaciones').select('modelo_id, fraccion, operacion, input_o_proceso, rate').order('fraccion'),
        supabase.from('robots').select('id, nombre, estado').order('nombre'),
        supabase.from('robot_programa').select('robot_id, modelo_num, fraccion, estado'),
        supabase.from('plan_robot_asignacion').select('plan_id, modelo_num, fraccion, robot_id, porcentaje'),
      ])
      const planes = (planesRes.data || []) as { id: string; nombre: string; semana: string | null; created_at: string }[]
      const items = (itemsRes.data || []) as { plan_id: string; modelo_num: string; color: string | null; pares: number }[]
      const mods = (modsRes.data || []) as { id: string; modelo_num: string }[]
      const ops = (opsRes.data || []) as { modelo_id: string; fraccion: number; operacion: string; input_o_proceso: string; rate: number | string }[]
      const robotsData = (robotsRes.data || []) as RobotLite[]
      const programaData = (programaRes.data || []) as { robot_id: string; modelo_num: string; fraccion: number; estado: 'TIENE' | 'FALTA' }[]
      const asignData = (asignRes.data || []) as { plan_id: string; modelo_num: string; fraccion: number; robot_id: string; porcentaje: number }[]

      // Matriz[modelo_num][fraccion] = lista de robot_id con estado TIENE
      const matrizTiene = new Map<string, Map<number, string[]>>()
      const robotIdsEnMatriz = new Set<string>()
      for (const p of programaData) {
        robotIdsEnMatriz.add(p.robot_id)
        if (p.estado !== 'TIENE') continue
        let porModelo = matrizTiene.get(p.modelo_num)
        if (!porModelo) { porModelo = new Map(); matrizTiene.set(p.modelo_num, porModelo) }
        const arr = porModelo.get(p.fraccion) ?? []
        arr.push(p.robot_id)
        porModelo.set(p.fraccion, arr)
      }

      // Filtrar robots a los que aparecen en la matriz (excluir plana/zigzag/pintura)
      const robotsFiltrados = robotsData.filter((r) => robotIdsEnMatriz.has(r.id))
      setRobots(robotsFiltrados)

      // Asignaciones por plan
      const asignByPlan = new Map<string, { modelo_num: string; fraccion: number; robot_id: string; porcentaje: number }[]>()
      for (const a of asignData) {
        if (!asignByPlan.has(a.plan_id)) asignByPlan.set(a.plan_id, [])
        asignByPlan.get(a.plan_id)!.push(a)
      }

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
        // Pares por (modelo, color) → sirve para mostrar el color en el detalle.
        // Pares por modelo (consolida alternativas) para el calculo de hrs por op.
        const paresByModelo = new Map<string, number>()
        const colorsByModelo = new Map<string, Set<string>>()
        for (const { modelo_num, pares } of paresByKey.values()) {
          paresByModelo.set(modelo_num, (paresByModelo.get(modelo_num) ?? 0) + pares)
        }
        for (const [key, { modelo_num }] of paresByKey) {
          const color = key.startsWith(modelo_num + ' ') ? key.slice(modelo_num.length + 1) : ''
          if (!colorsByModelo.has(modelo_num)) colorsByModelo.set(modelo_num, new Set())
          colorsByModelo.get(modelo_num)!.add(color)
        }

        function colorLabelFor(modelo_num: string): string {
          const cs = [...(colorsByModelo.get(modelo_num) ?? [])].filter(Boolean)
          return cs.join('/')
        }

        function pushLoad(map: Record<string, RobotLoad>, robotId: string, contribution: RobotOpContribution) {
          let bucket = map[robotId]
          if (!bucket) { bucket = { total: 0, byOp: [] }; map[robotId] = bucket }
          bucket.total += contribution.hrs
          bucket.byOp.push(contribution)
        }

        // Vista automatica: reparto equitativo entre robots con TIENE
        const loadByRobotAuto: Record<string, RobotLoad> = {}
        let horasRobotSinMatriz = 0
        for (const [modelo_num, paresModelo] of paresByModelo) {
          const modOps = opsByNum.get(modelo_num) ?? []
          const colorLabel = colorLabelFor(modelo_num)
          for (const op of modOps) {
            if (op.etapa !== 'ROBOT' || op.rate <= 0) continue
            const hrsOp = paresModelo / op.rate
            const robotsTiene = matrizTiene.get(modelo_num)?.get(op.fraccion) ?? []
            if (robotsTiene.length === 0) {
              horasRobotSinMatriz += hrsOp
              continue
            }
            const share = hrsOp / robotsTiene.length
            for (const rid of robotsTiene) {
              pushLoad(loadByRobotAuto, rid, {
                modelo_num, color: colorLabel, fraccion: op.fraccion, operacion: op.operacion, hrs: share,
              })
            }
          }
        }

        // Vista asignada (plan_robot_asignacion)
        const loadByRobotAsignado: Record<string, RobotLoad> = {}
        const asignsPlan = asignByPlan.get(p.id) ?? []
        for (const a of asignsPlan) {
          const paresModelo = paresByModelo.get(a.modelo_num) ?? 0
          if (paresModelo === 0) continue
          const opsMod = opsByNum.get(a.modelo_num) ?? []
          const op = opsMod.find((o) => o.fraccion === a.fraccion)
          if (!op || op.rate <= 0) continue
          const hrsOp = paresModelo / op.rate
          const pct = Number(a.porcentaje)
          pushLoad(loadByRobotAsignado, a.robot_id, {
            modelo_num: a.modelo_num,
            color: colorLabelFor(a.modelo_num),
            fraccion: a.fraccion,
            operacion: op.operacion,
            hrs: hrsOp * (pct / 100),
            pct,
          })
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
          loadByRobotAuto,
          loadByRobotAsignado,
          horasRobotSinMatriz,
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
                <KpiCard key={e} label={ETAPA_LABEL_SHORT[e]} value={summary.agg[e].toFixed(1) + ' hrs'} />
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
                            className="py-1.5 px-3 text-xs font-bold whitespace-nowrap"
                            style={{ color: ETAPA_COLOR[e] }}
                            title={ETAPA_LABEL[e]}
                          >
                            {ETAPA_LABEL_SHORT[e]}
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
                      title={ETAPA_LABEL[selectedEtapa]}
                    >
                      {ETAPA_LABEL_SHORT[selectedEtapa]}
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

          {/* --- CARGA POR ROBOT: detalle del plan activo --- */}
          {drillPlan && (
            <RobotLoadSection
              plans={visible}
              defaultPlanId={drillPlan.id}
              robots={robots}
            />
          )}

          {/* --- CARGA POR ROBOT: comparativo entre semanas --- */}
          {visible.length > 0 && robots.length > 0 && (
            <RobotComparativeSection visible={visible} robots={robots} />
          )}
        </>
      )}
    </div>
  )
}

/** Custom tick para XAxis: parte el nombre del robot en lineas
 *  - "2A-3020-M1" -> "2A-3020" / "M1"
 *  - "M048-CHACHE" -> "M048" / "CHACHE"
 *  - "6040-M5"    -> "6040"    / "M5"
 */
interface RobotTickProps {
  x?: number
  y?: number
  payload?: { value?: string }
}
function RobotTick(props: RobotTickProps) {
  const { x = 0, y = 0, payload } = props
  const raw = payload?.value ?? ''
  const parts = raw.split('-')
  const lines = parts.length >= 3
    ? [parts.slice(0, -1).join('-'), parts[parts.length - 1]]
    : parts
  return (
    <g transform={`translate(${x}, ${y})`}>
      {lines.map((line, i) => (
        <text
          key={i}
          x={0}
          y={14 + i * 13}
          textAnchor="middle"
          fontSize={11}
          fontFamily="var(--font-mono, monospace)"
          fill="currentColor"
          className="fill-muted-foreground"
        >
          {line}
        </text>
      ))}
    </g>
  )
}

/** Custom tick para el mini chart del detalle: "65413 NE F3" →
 *  linea 1 = "65413 NE" / linea 2 = "F3". En horizontal. */
function DetailOpTick(props: RobotTickProps) {
  const { x = 0, y = 0, payload } = props
  const raw = payload?.value ?? ''
  const match = raw.match(/^(.+?)\s+(F\d+)$/)
  const lines = match ? [match[1], match[2]] : [raw]
  return (
    <g transform={`translate(${x}, ${y})`}>
      {lines.map((line, i) => (
        <text
          key={i}
          x={0}
          y={14 + i * 13}
          textAnchor="middle"
          fontSize={11}
          fontFamily="var(--font-mono, monospace)"
          fill="currentColor"
          className="fill-muted-foreground"
        >
          {line}
        </text>
      ))}
    </g>
  )
}

// ─── Comparativo entre semanas: Carga por Robot ──────────────────────────

function RobotComparativeSection({
  visible, robots,
}: {
  visible: PlanStats[]
  robots: RobotLite[]
}) {
  const ROBOT_WEEKLY_CAPACITY = 50
  const [vista, setVista] = useState<'auto' | 'asignado'>('auto')
  const [selected, setSelected] = useState<{ planId: string; robotName: string } | null>(null)

  function handleBarClick(planId: string, robotName: string) {
    setSelected((prev) => (prev?.planId === planId && prev?.robotName === robotName ? null : { planId, robotName }))
  }

  // Solo mostrar la opcion 'asignado' si al menos un plan tiene asignaciones
  const hayAsignaciones = visible.some((p) => Object.keys(p.loadByRobotAsignado).length > 0)

  // Construir data para el BarChart: filas = robots con carga > 0
  // y una columna por cada plan visible con el valor en horas
  const chartData = useMemo(() => {
    const pick = (p: PlanStats) => vista === 'auto' ? p.loadByRobotAuto : p.loadByRobotAsignado
    const rows: Record<string, string | number>[] = []
    for (const r of robots) {
      const row: Record<string, string | number> = { robot: r.nombre }
      let totalAcrossWeeks = 0
      for (const p of visible) {
        const v = Math.round((pick(p)[r.id]?.total ?? 0) * 10) / 10
        row[p.nombre] = v
        totalAcrossWeeks += v
      }
      if (totalAcrossWeeks > 0) rows.push(row)
    }
    // Ordenar por suma total descendente
    rows.sort((a, b) => {
      const sumA = visible.reduce((s, p) => s + (Number(a[p.nombre]) || 0), 0)
      const sumB = visible.reduce((s, p) => s + (Number(b[p.nombre]) || 0), 0)
      return sumB - sumA
    })
    return rows
  }, [robots, visible, vista])

  if (chartData.length === 0) {
    return null
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Carga por Robot — Comparativo entre semanas
            <span className="text-xs text-muted-foreground font-normal ml-2">
              Capacidad ~{ROBOT_WEEKLY_CAPACITY} h/semana
            </span>
          </h3>
          {hayAsignaciones && (
            <div className="inline-flex rounded-md border text-xs overflow-hidden">
              <button
                className={cn('px-3 py-1 transition-colors', vista === 'asignado' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
                onClick={() => setVista('asignado')}
              >
                Asignada
              </button>
              <button
                className={cn('px-3 py-1 transition-colors', vista === 'auto' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
                onClick={() => setVista('auto')}
              >
                Automatica
              </button>
            </div>
          )}
        </div>
        <div style={{ width: '100%', height: 520 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 10, right: 24, left: 8, bottom: 60 }}
              barGap={4}
              barCategoryGap="25%"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="robot"
                type="category"
                interval={0}
                height={56}
                tickMargin={6}
                tick={<RobotTick />}
              />
              <YAxis
                type="number"
                tick={{ fontSize: 11 }}
                label={{ value: 'Horas', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: 'var(--muted-foreground)' } }}
              />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', fontSize: 12 }}
                formatter={(v) => `${Number(v ?? 0).toFixed(1)} h`}
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} verticalAlign="top" />
              {visible.map((p, i) => (
                <Bar
                  key={p.id}
                  dataKey={p.nombre}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                  maxBarSize={60}
                  cursor="pointer"
                  onClick={(data) => {
                    const payload = (data as { payload?: { robot?: string } })?.payload
                    if (payload?.robot) handleBarClick(p.id, payload.robot)
                  }}
                >
                  <LabelList
                    dataKey={p.nombre}
                    position="top"
                    formatter={(v) => {
                      const n = Number(v ?? 0)
                      return n > 0 ? n.toFixed(1) : ''
                    }}
                    style={{ fontSize: 10, fill: 'var(--foreground)', fontWeight: 600 }}
                  />
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Panel de detalle al hacer click en una barra */}
        {selected && (() => {
          const planIndex = visible.findIndex((p) => p.id === selected.planId)
          const plan = visible[planIndex]
          const robot = robots.find((r) => r.nombre === selected.robotName)
          if (!plan || !robot) return null
          const color = CHART_COLORS[planIndex % CHART_COLORS.length]
          const load = vista === 'auto' ? plan.loadByRobotAuto[robot.id] : plan.loadByRobotAsignado[robot.id]
          if (!load || load.total === 0) {
            return (
              <div className="rounded border overflow-hidden">
                <div
                  className="flex items-center justify-between px-3 py-2 text-xs text-white"
                  style={{ backgroundColor: color }}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold">{robot.nombre}</span>
                    <span className="opacity-70">·</span>
                    <span>{plan.nombre}</span>
                  </div>
                  <button type="button" onClick={() => setSelected(null)} title="Cerrar"><X className="h-3.5 w-3.5" /></button>
                </div>
                <div className="p-3 text-xs text-muted-foreground">Sin carga en esta vista.</div>
              </div>
            )
          }
          const sortedOps = [...load.byOp].sort((a, b) => b.hrs - a.hrs)
          // Dataset para el mini chart vertical: una entrada por op
          const miniData = sortedOps.map((c, i) => ({
            idx: i,
            label: `${c.modelo_num}${c.color ? ' ' + c.color : ''} F${c.fraccion}`,
            modelo_num: c.modelo_num,
            color_var: c.color,
            fraccion: c.fraccion,
            operacion: c.operacion,
            hrs: Math.round(c.hrs * 100) / 100,
            pct: c.pct,
          }))
          return (
            <div className="rounded border overflow-hidden">
              <div
                className="flex items-center justify-between px-3 py-2 text-xs text-white"
                style={{ backgroundColor: color }}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold">{robot.nombre}</span>
                  <span className="opacity-70">·</span>
                  <span>{plan.nombre}</span>
                  <span className="opacity-70">·</span>
                  <span className="font-semibold">{load.total.toFixed(1)} h</span>
                </div>
                <button type="button" onClick={() => setSelected(null)} title="Cerrar">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {/* Mini bar chart vertical: una barra por operacion */}
              <div style={{ width: '100%', height: Math.max(360, 120 + miniData.length * 14) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={miniData}
                    margin={{ top: 28, right: 24, left: 16, bottom: 52 }}
                    barCategoryGap="10%"
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="label"
                      interval={0}
                      height={52}
                      tickMargin={6}
                      tick={<DetailOpTick />}
                    />
                    <YAxis
                      type="number"
                      tick={{ fontSize: 11 }}
                      label={{ value: 'Horas', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: 'var(--muted-foreground)' } }}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', fontSize: 12 }}
                      formatter={(v) => `${Number(v ?? 0).toFixed(2)} h`}
                      labelFormatter={(_, payload) => {
                        const d = payload?.[0]?.payload as typeof miniData[number] | undefined
                        if (!d) return ''
                        return `${d.modelo_num}${d.color_var ? ' ' + d.color_var : ''} F${d.fraccion} — ${d.operacion}`
                      }}
                    />
                    <Bar dataKey="hrs" fill={color} maxBarSize={90}>
                      <LabelList
                        dataKey="hrs"
                        position="top"
                        formatter={(v) => {
                          const n = Number(v ?? 0)
                          return n > 0 ? n.toFixed(2) : ''
                        }}
                        style={{ fontSize: 11, fill: 'var(--foreground)', fontWeight: 600 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {/* Tabla compacta con nombres completos */}
              <div className="overflow-x-auto border-t">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/20 text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-1 w-28">Modelo</th>
                      <th className="text-left px-3 py-1 w-12">Frac</th>
                      <th className="text-left px-3 py-1">Operacion</th>
                      {vista === 'asignado' && <th className="text-right px-3 py-1 w-12">%</th>}
                      <th className="text-right px-3 py-1 w-16">Horas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedOps.map((c, i) => (
                      <tr key={i} className="border-t border-border/30">
                        <td className="px-3 py-1 font-mono">
                          {c.modelo_num}{c.color ? ` ${c.color}` : ''}
                        </td>
                        <td className="px-3 py-1 font-mono text-muted-foreground">F{c.fraccion}</td>
                        <td className="px-3 py-1 truncate" title={c.operacion}>{c.operacion}</td>
                        {vista === 'asignado' && (
                          <td className="px-3 py-1 text-right font-mono">
                            {c.pct !== undefined ? `${c.pct.toFixed(0)}%` : '—'}
                          </td>
                        )}
                        <td className="px-3 py-1 text-right font-mono">{c.hrs.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border/50 bg-muted/20 font-semibold">
                      <td className="px-3 py-1" colSpan={vista === 'asignado' ? 4 : 3}>Total</td>
                      <td className="px-3 py-1 text-right font-mono">{load.total.toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )
        })()}
      </CardContent>
    </Card>
  )
}

// ─── Carga por Robot (2 vistas: automatica y asignada) ───────────────────

function RobotLoadSection({
  plans, defaultPlanId, robots,
}: {
  plans: PlanStats[]
  defaultPlanId: string
  robots: RobotLite[]
}) {
  const ROBOT_WEEKLY_CAPACITY = 50
  // Selector interno de plan. Si el default externo cambia (por click en otro
  // chart), sincronizamos; si el usuario ya eligio uno, lo respetamos mientras
  // siga existiendo en la lista.
  const [localPlanId, setLocalPlanId] = useState<string>(defaultPlanId)
  useEffect(() => {
    if (!plans.some((p) => p.id === localPlanId)) {
      setLocalPlanId(defaultPlanId)
    }
  }, [plans, defaultPlanId, localPlanId])

  const plan = plans.find((p) => p.id === localPlanId) ?? plans.find((p) => p.id === defaultPlanId) ?? plans[0]

  // Se mantiene un solo estado de expansion por vista para que cada una
  // pueda tener su propio detalle abierto sin interferirse.
  const [expandedAsignado, setExpandedAsignado] = useState<string | null>(null)
  const [expandedAuto, setExpandedAuto] = useState<string | null>(null)

  if (!plan) return null

  const hasAsignado = Object.keys(plan.loadByRobotAsignado).length > 0
  const hasAuto = Object.keys(plan.loadByRobotAuto).length > 0

  const totalAsignado = Object.values(plan.loadByRobotAsignado).reduce((s, v) => s + v.total, 0)
  const totalAuto = Object.values(plan.loadByRobotAuto).reduce((s, v) => s + v.total, 0)

  function buildRows(load: Record<string, RobotLoad>) {
    const arr: { id: string; nombre: string; estado: string; load: RobotLoad }[] = []
    for (const r of robots) {
      const entry = load[r.id]
      if (!entry || entry.total <= 0) continue
      arr.push({ id: r.id, nombre: r.nombre, estado: r.estado, load: entry })
    }
    return arr.sort((a, b) => b.load.total - a.load.total)
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-5">
        <div className="flex items-center gap-2 flex-wrap">
          <Bot className="h-4 w-4 shrink-0" />
          <h3 className="font-semibold shrink-0">Carga por Robot</h3>
          <select
            value={localPlanId}
            onChange={(e) => setLocalPlanId(e.target.value)}
            className="ml-1 text-sm bg-background border rounded-md px-2 py-1 hover:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            {plans.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground ml-auto">
            Capacidad ~{ROBOT_WEEKLY_CAPACITY} h/semana por robot
          </span>
        </div>

        {/* Vista ASIGNADA — principal */}
        <div className="space-y-2">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h4 className="text-sm font-semibold">Segun asignacion del plan</h4>
            {hasAsignado && (
              <span className="text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                Total: {totalAsignado.toFixed(1)} h
              </span>
            )}
            {!hasAsignado && (
              <span className="text-xs text-muted-foreground">
                (sin asignaciones capturadas todavia)
              </span>
            )}
          </div>
          {hasAsignado ? (
            <RobotBars
              rows={buildRows(plan.loadByRobotAsignado)}
              capacity={ROBOT_WEEKLY_CAPACITY}
              expandedId={expandedAsignado}
              onToggle={(id) => setExpandedAsignado((cur) => (cur === id ? null : id))}
              showPct
            />
          ) : (
            <div className="text-xs text-muted-foreground italic py-2">
              Captura los robots reales por fraccion en el tab Editor para ver esta vista.
            </div>
          )}
        </div>

        {/* Vista AUTOMATICA — informativa */}
        <div className="space-y-2 pt-3 border-t border-border/50">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Distribucion automatica (informativa)
            </h4>
            {hasAuto && (
              <span className="text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded bg-muted text-foreground/80">
                Total: {totalAuto.toFixed(1)} h
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">
              Reparto equitativo entre robots con programa cargado
            </span>
          </div>
          {hasAuto ? (
            <div className="opacity-80">
              <RobotBars
                rows={buildRows(plan.loadByRobotAuto)}
                capacity={ROBOT_WEEKLY_CAPACITY}
                muted
                expandedId={expandedAuto}
                onToggle={(id) => setExpandedAuto((cur) => (cur === id ? null : id))}
              />
            </div>
          ) : (
            <div className="text-xs text-muted-foreground italic py-2">
              Ninguna operacion ROBOT del plan tiene entrada en la matriz.
            </div>
          )}
          {plan.horasRobotSinMatriz > 0 && (
            <p className="text-[10px] text-yellow-500">
              {plan.horasRobotSinMatriz.toFixed(1)} horas ROBOT no se distribuyeron (sin datos en la matriz para esas fracciones).
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function RobotBars({
  rows, capacity, muted, expandedId, onToggle, showPct,
}: {
  rows: { id: string; nombre: string; estado: string; load: RobotLoad }[]
  capacity: number
  muted?: boolean
  expandedId?: string | null
  onToggle?: (id: string) => void
  showPct?: boolean
}) {
  if (rows.length === 0) return null

  // Data con color por robot (paleta vibrante). Barras en rojo si exceden capacidad.
  const chartData = rows.map((r, i) => ({
    id: r.id,
    nombre: r.nombre,
    estado: r.estado,
    total: Math.round(r.load.total * 100) / 100,
    load: r.load,
    _fill: r.load.total > capacity ? '#ef4444' : DETAIL_COLORS[i % DETAIL_COLORS.length],
  }))

  const selected = expandedId ? rows.find((r) => r.id === expandedId) : null
  const selectedIdx = expandedId ? rows.findIndex((r) => r.id === expandedId) : -1

  return (
    <div className="space-y-3">
      {/* Chart vertical: una barra por robot */}
      <div style={{ width: '100%', height: 380 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 28, right: 40, left: 16, bottom: 52 }}
            barCategoryGap="15%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="nombre"
              interval={0}
              height={52}
              tickMargin={6}
              tick={<RobotTick />}
            />
            <YAxis
              type="number"
              tick={{ fontSize: 11 }}
              label={{ value: 'Horas', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: 'var(--muted-foreground)' } }}
            />
            <ReferenceLine
              y={capacity}
              stroke="var(--foreground)"
              strokeDasharray="4 4"
              label={{ value: `Cap ${capacity}h`, position: 'right', fontSize: 10, fill: 'var(--muted-foreground)' }}
            />
            <Tooltip
              contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', fontSize: 12 }}
              formatter={(v) => `${Number(v ?? 0).toFixed(1)} h`}
              labelFormatter={(l) => String(l)}
            />
            <Bar
              dataKey="total"
              maxBarSize={90}
              cursor={onToggle ? 'pointer' : undefined}
              onClick={(data) => {
                const payload = (data as { payload?: { id?: string } })?.payload
                if (payload?.id) onToggle?.(payload.id)
              }}
            >
              {chartData.map((d, i) => (
                <Cell
                  key={d.id}
                  fill={d._fill}
                  fillOpacity={muted ? 0.55 : (selectedIdx === -1 || selectedIdx === i ? 1 : 0.4)}
                  stroke={selectedIdx === i ? 'var(--foreground)' : undefined}
                  strokeWidth={selectedIdx === i ? 2 : 0}
                />
              ))}
              <LabelList
                dataKey="total"
                position="top"
                formatter={(v) => {
                  const n = Number(v ?? 0)
                  return n > 0 ? n.toFixed(1) : ''
                }}
                style={{ fontSize: 11, fill: 'var(--foreground)', fontWeight: 600 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Detalle del robot seleccionado */}
      {selected && (() => {
        const color = chartData.find((d) => d.id === selected.id)?._fill ?? DETAIL_COLORS[0]
        const activo = selected.estado === 'ACTIVO'
        const sorted = [...selected.load.byOp].sort((a, b) => b.hrs - a.hrs)
        const modelColor = new Map<string, string>()
        let colorIdx = 0
        for (const c of sorted) {
          if (!modelColor.has(c.modelo_num)) {
            modelColor.set(c.modelo_num, DETAIL_COLORS[colorIdx % DETAIL_COLORS.length])
            colorIdx++
          }
        }
        const miniData = sorted.map((c, i) => ({
          idx: i,
          label: `${c.modelo_num}${c.color ? ' ' + c.color : ''} F${c.fraccion}`,
          modelo_num: c.modelo_num,
          color_var: c.color,
          fraccion: c.fraccion,
          operacion: c.operacion,
          hrs: Math.round(c.hrs * 100) / 100,
          pct: c.pct,
          _fill: modelColor.get(c.modelo_num) ?? DETAIL_COLORS[0],
        }))
        return (
          <div className="rounded border overflow-hidden">
            <div
              className="flex items-center justify-between px-3 py-2 text-xs text-white"
              style={{ backgroundColor: color }}
            >
              <div className={cn('flex items-center gap-2', !activo && 'line-through opacity-80')}>
                <span className="font-mono font-semibold">{selected.nombre}</span>
                <span className="opacity-70">·</span>
                <span className="font-semibold">{selected.load.total.toFixed(1)} h</span>
                {!activo && <span className="opacity-70 text-[10px]">(fuera de servicio)</span>}
              </div>
              <button type="button" onClick={() => onToggle?.(selected.id)} title="Cerrar">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {/* Mini bar chart vertical: una barra por operacion, coloreada por modelo */}
            <div style={{ width: '100%', height: Math.max(320, 120 + miniData.length * 12) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={miniData}
                  margin={{ top: 28, right: 24, left: 16, bottom: 52 }}
                  barCategoryGap="10%"
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    interval={0}
                    height={52}
                    tickMargin={6}
                    tick={<DetailOpTick />}
                  />
                  <YAxis
                    type="number"
                    tick={{ fontSize: 11 }}
                    label={{ value: 'Horas', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: 'var(--muted-foreground)' } }}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', fontSize: 12 }}
                    formatter={(v) => `${Number(v ?? 0).toFixed(2)} h`}
                    labelFormatter={(_, payload) => {
                      const d = payload?.[0]?.payload as typeof miniData[number] | undefined
                      if (!d) return ''
                      return `${d.modelo_num}${d.color_var ? ' ' + d.color_var : ''} F${d.fraccion} — ${d.operacion}`
                    }}
                  />
                  <Bar dataKey="hrs" maxBarSize={80}>
                    {miniData.map((d) => (
                      <Cell key={d.idx} fill={d._fill} />
                    ))}
                    <LabelList
                      dataKey="hrs"
                      position="top"
                      formatter={(v) => {
                        const n = Number(v ?? 0)
                        return n > 0 ? n.toFixed(2) : ''
                      }}
                      style={{ fontSize: 11, fill: 'var(--foreground)', fontWeight: 600 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {/* Tabla compacta con nombres completos */}
            <div className="border-t overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="text-left px-2 py-1 w-28">Modelo</th>
                    <th className="text-left px-2 py-1 w-12">Frac</th>
                    <th className="text-left px-2 py-1">Operacion</th>
                    {showPct && <th className="text-right px-2 py-1 w-12">%</th>}
                    <th className="text-right px-2 py-1 w-16">Horas</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((c, i) => {
                    const col = modelColor.get(c.modelo_num) ?? DETAIL_COLORS[0]
                    return (
                      <tr key={i} className="border-t border-border/30 hover:bg-muted/20">
                        <td className="px-2 py-1 font-mono font-semibold" style={{ color: col }}>
                          {c.modelo_num}{c.color ? ` ${c.color}` : ''}
                        </td>
                        <td className="px-2 py-1 font-mono text-muted-foreground">F{c.fraccion}</td>
                        <td className="px-2 py-1 truncate" title={c.operacion}>{c.operacion}</td>
                        {showPct && (
                          <td className="px-2 py-1 text-right font-mono">
                            {c.pct !== undefined ? `${c.pct.toFixed(0)}%` : '—'}
                          </td>
                        )}
                        <td className="px-2 py-1 text-right font-mono font-semibold">{c.hrs.toFixed(2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="bg-muted/30">
                  <tr className="border-t border-border/50 font-semibold">
                    <td className="px-2 py-1" colSpan={showPct ? 4 : 3}>Total</td>
                    <td className="px-2 py-1 text-right font-mono">{selected.load.total.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
