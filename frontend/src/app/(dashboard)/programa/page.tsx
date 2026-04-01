'use client'

import { useState, useMemo, useEffect } from 'react'
import { useAppStore } from '@/lib/store/useAppStore'
import { supabase } from '@/lib/supabase/client'
import { KpiCard } from '@/components/shared/KpiCard'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { DaySelector } from '@/components/shared/DaySelector'
import { TableExport } from '@/components/shared/TableExport'
import { STAGE_COLORS, BLOCK_LABELS, DAY_ORDER, SKILL_GROUPS, SKILL_LABELS, type SkillType } from '@/types'
import type { DailyResult, DailyScheduleEntry, AsignacionMaquila, WeeklyScheduleEntry } from '@/types'
import { Truck, ArrowDownWideNarrow, User, Cpu, UserX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCatalogoImages, getModeloImageUrl } from '@/lib/hooks/useCatalogoImages'
import { exportProgramaPDF, preloadModeloImages, type ProgramaDayGroup, type MaquilaCard, type DayKpis } from '@/lib/export'

interface MaquilaEntry {
  modelo: string
  fabrica: string
  pares: number
}

interface OpMaquilaEntry {
  modelo: string
  maquila: string
  pares: number
  fracciones: number[]
  fecha_entrega: string | null
}

/** Catalog-level: models that have MAQUILA operations (from catalogo_operaciones) */
interface CatalogMaquilaOp {
  modelo_num: string
  fraccion: number
  operacion: string
  rate: number
}

export default function ProgramaPage() {
  const result = useAppStore((s) => s.currentResult)
  const pedidoNombre = useAppStore((s) => s.currentPedidoNombre)
  const catImages = useCatalogoImages()
  const [selectedDay, setSelectedDay] = useState<string>('')
  const [cascadeSort, setCascadeSort] = useState(false)
  const [maquilaFabricas, setMaquilaFabricas] = useState<Set<string>>(new Set())
  const [opMaquilaEntries, setOpMaquilaEntries] = useState<OpMaquilaEntry[]>([])
  const [catalogMaquilaOps, setCatalogMaquilaOps] = useState<CatalogMaquilaOp[]>([])
  const [inputProcesoMap, setInputProcesoMap] = useState<Map<string, string>>(new Map())

  // Load input_o_proceso from catalog for all models in the result (used for block coloring)
  useEffect(() => {
    if (!result) { setInputProcesoMap(new Map()); return }
    const modelNums = new Set<string>()
    if (result.weekly_schedule) {
      for (const e of result.weekly_schedule) modelNums.add(e.Modelo.split(' ')[0])
    }
    if (result.daily_results) {
      for (const dayData of Object.values(result.daily_results)) {
        for (const s of dayData.schedule || []) modelNums.add(s.modelo.split(' ')[0])
      }
    }
    if (modelNums.size === 0) { setInputProcesoMap(new Map()); return }
    supabase
      .from('catalogo_operaciones')
      .select('fraccion, input_o_proceso, catalogo_modelos!inner(modelo_num)')
      .in('catalogo_modelos.modelo_num', [...modelNums])
      .then(({ data }) => {
        const map = new Map<string, string>()
        for (const op of data || []) {
          const cm = op.catalogo_modelos as unknown as { modelo_num: string }
          map.set(`${cm.modelo_num}|${op.fraccion}`, op.input_o_proceso || '')
        }
        setInputProcesoMap(map)
      })
  }, [result])

  // Load maquila fabrica names
  useEffect(() => {
    supabase
      .from('fabricas')
      .select('nombre')
      .eq('es_maquila', true)
      .then(({ data }) => {
        setMaquilaFabricas(new Set((data || []).map((f: { nombre: string }) => f.nombre)))
      })
  }, [])

  // Load MAQUILA operations from catalog for models in the result
  useEffect(() => {
    if (!result) { setCatalogMaquilaOps([]); return }

    // Collect unique base model numbers from the result (strip color suffix)
    const modelNums = new Set<string>()
    if (result.weekly_schedule) {
      for (const e of result.weekly_schedule) modelNums.add(e.Modelo.split(' ')[0])
    }
    if (result.daily_results) {
      for (const dayData of Object.values(result.daily_results)) {
        for (const s of dayData.schedule || []) modelNums.add(s.modelo.split(' ')[0])
      }
    }
    if (modelNums.size === 0) { setCatalogMaquilaOps([]); return }

    // Query catalog for MAQUILA operations of these models
    supabase
      .from('catalogo_operaciones')
      .select('fraccion, operacion, rate, catalogo_modelos!inner(modelo_num)')
      .eq('recurso', 'MAQUILA')
      .in('catalogo_modelos.modelo_num', [...modelNums])
      .order('fraccion')
      .then(({ data }) => {
        setCatalogMaquilaOps(
          (data || []).map((op: { fraccion: number; operacion: string; rate: number; catalogo_modelos: unknown }) => ({
            modelo_num: (op.catalogo_modelos as { modelo_num: string }).modelo_num,
            fraccion: op.fraccion,
            operacion: op.operacion,
            rate: op.rate || 0,
          }))
        )
      })
  }, [result])

  // Load maquila assignments from pedido
  useEffect(() => {
    if (!pedidoNombre) { setOpMaquilaEntries([]); return }

    supabase
      .from('pedidos')
      .select('id')
      .eq('nombre', pedidoNombre)
      .single()
      .then(({ data: ped }) => {
        if (!ped) return
        supabase
          .from('pedido_items')
          .select('id, modelo_num')
          .eq('pedido_id', ped.id)
          .then(({ data: items }) => {
            if (!items || items.length === 0) { setOpMaquilaEntries([]); return }
            const itemIds = items.map((it: { id: string }) => it.id)
            supabase
              .from('asignaciones_maquila')
              .select('*')
              .in('pedido_item_id', itemIds)
              .then(({ data: asigs }) => {
                const itemMap = new Map(
                  items.map((it: { id: string; modelo_num: string }) => [it.id, it.modelo_num])
                )
                setOpMaquilaEntries(
                  (asigs || []).map((a: AsignacionMaquila) => ({
                    modelo: itemMap.get(a.pedido_item_id) || '?',
                    maquila: a.maquila,
                    pares: a.pares,
                    fracciones: a.fracciones,
                    fecha_entrega: a.fecha_entrega || null,
                  }))
                )
              })
          })
      })
  }, [pedidoNombre, result])

  // Fabrica-level maquila from weekly_schedule
  const maquilaEntries = useMemo(() => {
    if (!result?.weekly_schedule || maquilaFabricas.size === 0) return []
    const entries: MaquilaEntry[] = []
    for (const e of result.weekly_schedule) {
      if (maquilaFabricas.has(e.Fabrica)) {
        entries.push({ modelo: e.Modelo, fabrica: e.Fabrica, pares: e.Pares })
      }
    }
    return entries
  }, [result, maquilaFabricas])

  // Group fabrica-level by fabrica → modelos
  const maquilaByFabrica = useMemo(() => {
    const map = new Map<string, Map<string, number>>()
    for (const e of maquilaEntries) {
      if (!map.has(e.fabrica)) map.set(e.fabrica, new Map())
      const modelMap = map.get(e.fabrica)!
      modelMap.set(e.modelo, (modelMap.get(e.modelo) || 0) + e.pares)
    }
    return map
  }, [maquilaEntries])

  // Group assignments by maquila → modelo → { fracciones, pares }
  const opMaquilaByFactory = useMemo(() => {
    const map = new Map<string, Map<string, { fracciones: number[]; pares: number }>>()
    for (const e of opMaquilaEntries) {
      if (!map.has(e.maquila)) map.set(e.maquila, new Map())
      const modelMap = map.get(e.maquila)!
      const existing = modelMap.get(e.modelo)
      if (existing) {
        existing.fracciones = [...new Set([...existing.fracciones, ...e.fracciones])].sort((a, b) => a - b)
        existing.pares += e.pares
      } else {
        modelMap.set(e.modelo, { fracciones: [...e.fracciones], pares: e.pares })
      }
    }
    return map
  }, [opMaquilaEntries])

  // Catalog-level: models with MAQUILA ops (unassigned detection)
  const catalogMaquilaByModel = useMemo(() => {
    const map = new Map<string, CatalogMaquilaOp[]>()
    for (const op of catalogMaquilaOps) {
      if (!map.has(op.modelo_num)) map.set(op.modelo_num, [])
      map.get(op.modelo_num)!.push(op)
    }
    return map
  }, [catalogMaquilaOps])

  // Map modelo|fraccion → operacion name (for resolving F1→name)
  const fracToOpName = useMemo(() => {
    const map = new Map<string, string>()
    for (const op of catalogMaquilaOps) {
      map.set(`${op.modelo_num}|${op.fraccion}`, op.operacion)
    }
    return map
  }, [catalogMaquilaOps])

  // Models with unassigned MAQUILA ops (in catalog but not yet assigned)
  const assignedSet = useMemo(() => {
    const set = new Set<string>()
    for (const e of opMaquilaEntries) {
      for (const f of e.fracciones) set.add(`${e.modelo}|${f}`)
    }
    return set
  }, [opMaquilaEntries])

  const unassignedMaquilaByModel = useMemo(() => {
    const map = new Map<string, CatalogMaquilaOp[]>()
    for (const [modelo, ops] of catalogMaquilaByModel) {
      const unassigned = ops.filter((op) => !assignedSet.has(`${modelo}|${op.fraccion}`))
      if (unassigned.length > 0) map.set(modelo, unassigned)
    }
    return map
  }, [catalogMaquilaByModel, assignedSet])

  // All maquila modelos (all three types)
  const maquilaModelos = useMemo(() => {
    const set = new Set(maquilaEntries.map((e) => e.modelo))
    for (const e of opMaquilaEntries) set.add(e.modelo)
    for (const modelo of catalogMaquilaByModel.keys()) set.add(modelo)
    return set
  }, [maquilaEntries, opMaquilaEntries, catalogMaquilaByModel])

  // Map of post-maquila dependencies: "modeloBase|fraccion" → {maquila, fecha_entrega}
  // Post-maquila = fractions that come AFTER maquila fractions (depend on maquila delivery)
  const maquilaDeps = useMemo(() => {
    const map = new Map<string, { maquila: string; fecha_entrega: string | null }>()
    for (const [modelo, maqOps] of catalogMaquilaByModel) {
      const maxMaqFrac = Math.max(...maqOps.map((op) => op.fraccion))
      // Find assignment with latest delivery date for this model
      const asigs = opMaquilaEntries.filter((e) => e.modelo === modelo)
      const latestAsig = asigs.reduce<OpMaquilaEntry | null>((best, a) => {
        if (!best) return a
        if (a.fecha_entrega && (!best.fecha_entrega || a.fecha_entrega > best.fecha_entrega)) return a
        return best
      }, null)
      const maquilaName = latestAsig?.maquila || 'MAQUILA'
      const fechaEntrega = latestAsig?.fecha_entrega || null

      // Get all internal fractions for this model from the schedule
      // Any fraction > maxMaqFrac is post-maquila
      if (result?.daily_results) {
        for (const dayData of Object.values(result.daily_results)) {
          for (const s of dayData.schedule || []) {
            const baseNum = s.modelo.split(' ')[0]
            if (baseNum === modelo && s.fraccion > maxMaqFrac) {
              map.set(`${baseNum}|${s.fraccion}`, { maquila: maquilaName, fecha_entrega: fechaEntrega })
            }
          }
        }
      }
    }
    return map
  }, [catalogMaquilaByModel, opMaquilaEntries, result])

  const totalMaquilaPares = maquilaEntries.reduce((s, e) => s + e.pares, 0)
  const hasFabricaMaquila = maquilaEntries.length > 0
  const hasOpMaquila = opMaquilaEntries.length > 0
  const hasUnassignedMaquila = unassignedMaquilaByModel.size > 0
  const showBanner = hasFabricaMaquila || hasOpMaquila || hasUnassignedMaquila

  const dayNames = useMemo(() => {
    if (!result?.daily_results) return []
    const keys = Object.keys(result.daily_results)
    return DAY_ORDER.filter((d) => keys.includes(d))
  }, [result])

  // Global export: all days combined
  const globalExport = useMemo(() => {
    if (!result?.daily_results) return { headers: [], rows: [] }
    const allSchedules = dayNames.flatMap((d) => {
      const dayData = result.daily_results![d]
      if (!dayData?.schedule) return []
      return dayData.schedule.map((s) => ({ ...s, dia: d }))
    })
    const maxBlocks = allSchedules.reduce((max, s) => Math.max(max, s.blocks?.length || 0), 0)
    const blockLbls = BLOCK_LABELS.slice(0, maxBlocks || 10)
    const headers = ['DIA', 'MODELO', 'FRACC', 'OPERACION', 'RECURSO', 'OPERARIO', 'RATE', 'HC', ...blockLbls, 'TOTAL']
    const rows = allSchedules.map((s) => [
      s.dia, s.modelo, s.fraccion, s.operacion, s.robot || s.recurso,
      s.operario || '-', s.rate, s.hc,
      ...(s.blocks || []).map((v: number) => (v > 0 ? v : '')),
      s.total,
    ] as (string | number)[])
    return { headers, rows }
  }, [result, dayNames])

  async function handleGlobalPDF() {
    if (!result?.daily_results) return
    const maxBlocks = dayNames.reduce((max, d) => {
      const sched = result.daily_results![d]?.schedule || []
      return sched.reduce((m, s) => Math.max(m, s.blocks?.length || 0), max)
    }, 0)
    const blockLbls = BLOCK_LABELS.slice(0, maxBlocks || 10)
    const headers = ['MODELO', 'FRACC', 'OPERACION', 'RECURSO', 'OPERARIO', 'RATE', 'HC', ...blockLbls, 'TOTAL']

    // Build maquila cards for PDF
    const cards: MaquilaCard[] = []
    for (const [fab, models] of maquilaByFabrica) {
      for (const [m, p] of models.entries()) {
        cards.push({ factory: fab, modelo: m, pares: p, operations: [] })
      }
    }
    for (const [maq, models] of opMaquilaByFactory) {
      for (const [m, d] of models.entries()) {
        const baseM = m.split(' ')[0]
        const ops = d.fracciones.map((f) => `${f}.- ${fracToOpName.get(`${baseM}|${f}`) || `F${f}`}`)
        cards.push({ factory: maq, modelo: m, pares: d.pares, operations: ops })
      }
    }
    for (const [modelo, ops] of unassignedMaquilaByModel) {
      cards.push({
        factory: 'Sin asignar',
        modelo,
        pares: 0,
        operations: ops.map((o) => `${o.fraccion}.- ${o.operacion}`),
        unassigned: true,
      })
    }

    const groups: ProgramaDayGroup[] = dayNames
      .filter((d) => result.daily_results![d]?.schedule?.length)
      .map((d) => {
        const dayD = result.daily_results![d]
        const raw = dayD.schedule
        const sched = cascadeSort
          ? [...raw].sort((a, b) => {
              const startA = (a.blocks || []).findIndex((v) => v > 0)
              const startB = (b.blocks || []).findIndex((v) => v > 0)
              const sA = startA === -1 ? 999 : startA
              const sB = startB === -1 ? 999 : startB
              if (sA !== sB) return sA - sB
              const lastA = (a.blocks || []).findLastIndex((v) => v > 0)
              const lastB = (b.blocks || []).findLastIndex((v) => v > 0)
              if (lastA !== lastB) return lastA - lastB
              const mCmp = a.modelo.localeCompare(b.modelo)
              if (mCmp !== 0) return mCmp
              return a.fraccion - b.fraccion
            })
          : raw
        // Compute KPIs for this day
        const wPares = (result.weekly_schedule || [])
          .filter((e) => e.Dia === d)
          .reduce((sum, e) => sum + e.Pares, 0)
        const kpis: DayKpis = {
          totalPares: dayD.total_pares || 0,
          weeklyPares: wPares,
          paresAdelantados: dayD.pares_adelantados || 0,
          paresRezago: dayD.pares_rezago || 0,
          tardiness: dayD.total_tardiness || 0,
          maxHc: raw.reduce((max, s) => Math.max(max, s.hc), 0),
          plantilla: dayD.plantilla || 0,
          status: dayD.status || '?',
          unassignedCount: (dayD.unassigned_ops || []).length,
        }
        return {
          day: d,
          rows: sched.map((s) => [
            s.modelo, s.fraccion, s.operacion, s.robot || s.recurso,
            s.operario || '-', s.rate, s.hc,
            ...(s.blocks || []).map((v: number) => (v > 0 ? v : '')),
            s.total,
          ] as (string | number)[]),
          etapas: sched.map((s) => inputProcesoMap.get(`${s.modelo.split(' ')[0]}|${s.fraccion}`) || s.input_o_proceso || s.etapa || ''),
          maquilaCards: cards.length > 0 ? cards : undefined,
          kpis,
        }
      })
    // Pre-load modelo images for PDF
    const allModelos = dayNames.flatMap((d) =>
      (result.daily_results![d]?.schedule || []).map((s) => s.modelo)
    )
    const imgMap = await preloadModeloImages(allModelos, catImages, (num, color) =>
      getModeloImageUrl(catImages, num, color)
    )

    const suffix = cascadeSort ? '_cascada' : ''
    exportProgramaPDF(`programa_completo${suffix}`, headers, groups, imgMap)
  }

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
        <div className="flex items-center gap-3">
          <TableExport title="programa_completo" headers={globalExport.headers} rows={globalExport.rows} onCustomPDF={handleGlobalPDF} />
          <DaySelector dayNames={dayNames} selectedDay={day} onDayChange={setSelectedDay} />
        </div>
      </div>

      {/* MAQUILA Banner */}
      {showBanner && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-3">
            <div className="flex items-center gap-3">
              <Truck className="h-5 w-5 text-destructive shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-destructive">
                  Produccion Externa (Maquila)
                  {totalMaquilaPares > 0 && ` — ${totalMaquilaPares.toLocaleString()} pares`}
                </p>

                {/* Fabrica-level maquila */}
                {hasFabricaMaquila && (
                  <div className="mt-2 space-y-1">
                    {[...maquilaByFabrica.entries()].map(([fabrica, modelMap]) => (
                      <div key={fabrica} className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="border-destructive/40 text-destructive text-xs">
                          {fabrica}
                        </Badge>
                        {[...modelMap.entries()].map(([modelo, pares]) => (
                          <span key={modelo} className="text-xs text-destructive/70 font-mono">
                            {modelo}: {pares.toLocaleString()} pares
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                )}

                {/* Operation-level maquila — grid layout */}
                {(hasOpMaquila || hasUnassignedMaquila) && (
                  <div className={hasFabricaMaquila ? 'mt-2 pt-2 border-t border-destructive/20' : 'mt-2'}>
                    {hasOpMaquila && (
                      <p className="text-xs font-medium text-destructive/70 mb-2">Operaciones Asignadas:</p>
                    )}
                    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {/* Assigned maquila cards */}
                      {hasOpMaquila && [...opMaquilaByFactory.entries()].flatMap(([maquila, models]) =>
                        [...models.entries()].map(([modelo, info]) => (
                          <div key={`${maquila}-${modelo}`} className="rounded border border-destructive/30 bg-destructive/10 p-2">
                            <div className="flex items-center gap-1.5 mb-1">
                              <Badge variant="outline" className="border-destructive/40 text-destructive text-xs">
                                {maquila}
                              </Badge>
                              <span className="text-xs text-destructive font-medium truncate">
                                {modelo} — {info.pares}p
                              </span>
                            </div>
                            <ul className="list-none space-y-0">
                              {info.fracciones.map((f) => {
                                const baseModel = modelo.split(' ')[0]
                                const name = fracToOpName.get(`${baseModel}|${f}`) || `Fraccion ${f}`
                                return (
                                  <li key={f} className="text-xs text-foreground/70 font-mono pl-1">
                                    {f}.- {name}
                                  </li>
                                )
                              })}
                            </ul>
                          </div>
                        ))
                      )}

                      {/* Unassigned maquila cards */}
                      {hasUnassignedMaquila && [...unassignedMaquilaByModel.entries()].map(([modelo, ops]) => (
                        <div key={`unassigned-${modelo}`} className="rounded border border-amber-500/30 bg-amber-500/10 p-2">
                          <div className="flex items-center gap-1.5 mb-1">
                            <Badge variant="outline" className="border-amber-500/40 text-amber-500 text-xs">
                              Sin asignar
                            </Badge>
                            <span className="text-xs text-amber-500 font-medium truncate">{modelo}</span>
                          </div>
                          <ul className="list-none space-y-0">
                            {ops.map((o) => (
                              <li key={o.fraccion} className="text-xs text-foreground/70 font-mono pl-1">
                                {o.fraccion}.- {o.operacion}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {dayData && <DayView dayName={day} data={dayData} weeklySchedule={result.weekly_schedule} maquilaModelos={maquilaModelos} maquilaDeps={maquilaDeps} cascadeSort={cascadeSort} onToggleCascade={() => setCascadeSort((v) => !v)} catImages={catImages} inputProcesoMap={inputProcesoMap} />}
    </div>
  )
}

function DayView({ dayName, data, weeklySchedule, maquilaModelos, maquilaDeps, cascadeSort, onToggleCascade, catImages, inputProcesoMap }: { dayName: string; data: DailyResult; weeklySchedule?: WeeklyScheduleEntry[]; maquilaModelos: Set<string>; maquilaDeps: Map<string, { maquila: string; fecha_entrega: string | null }>; cascadeSort: boolean; onToggleCascade: () => void; catImages: ReturnType<typeof useCatalogoImages>; inputProcesoMap: Map<string, string> }) {
  const rawSchedule = data.schedule || []
  const [selectedOperario, setSelectedOperario] = useState<string | null>(null)
  const [selectedRecurso, setSelectedRecurso] = useState<string | null>(null)
  const [viewTab, setViewTab] = useState<'programa' | 'operario' | 'recurso'>('programa')

  // Clear selection when day changes
  useEffect(() => { setSelectedOperario(null); setSelectedRecurso(null) }, [dayName])

  // Load all operarios with habilidades for idle operators display
  const _PESPUNTE_SKILLS = new Set(['ZIGZAG', 'PLANA_RECTA', 'DOS_AGUJAS', 'POSTE_CONV', 'RIBETE', 'CODO'])
  const [allOperarios, setAllOperarios] = useState<{
    nombre: string; activo: boolean; dias: string[]; habilidades: SkillType[]
  }[]>([])

  useEffect(() => {
    async function load() {
      const { data: ops } = await supabase
        .from('operarios')
        .select('id, nombre, activo')
        .order('nombre')
      if (!ops) return
      const ids = ops.map((o: { id: string }) => o.id)
      const [diasRes, habRes] = await Promise.all([
        supabase.from('operario_dias').select('operario_id, dia').in('operario_id', ids),
        supabase.from('operario_habilidades').select('operario_id, habilidad').in('operario_id', ids),
      ])
      const diasMap = new Map<string, string[]>()
      for (const d of diasRes.data || []) {
        if (!diasMap.has(d.operario_id)) diasMap.set(d.operario_id, [])
        diasMap.get(d.operario_id)!.push(d.dia)
      }
      const habMap = new Map<string, Set<SkillType>>()
      for (const h of habRes.data || []) {
        if (!habMap.has(h.operario_id)) habMap.set(h.operario_id, new Set())
        const skill: SkillType = _PESPUNTE_SKILLS.has(h.habilidad) ? 'PESPUNTE' : h.habilidad as SkillType
        habMap.get(h.operario_id)!.add(skill)
      }
      setAllOperarios(ops.map((o: { id: string; nombre: string; activo: boolean }) => ({
        nombre: o.nombre,
        activo: o.activo,
        dias: diasMap.get(o.id) || [],
        habilidades: [...(habMap.get(o.id) || [])],
      })))
    }
    load()
  }, [])

  // Maquila info is shown in the banner above, not as rows in the table

  // Consolidate rows with same modelo+fraccion+operario into one row
  // Merges blocks arrays by summing pares per block index
  const consolidatedSchedule = useMemo(() => {
    const NB = BLOCK_LABELS.length  // fixed 10 blocks, no circular dependency
    const map = new Map<string, DailyScheduleEntry>()
    for (const s of rawSchedule) {
      const op = (s.operario || '').trim()
      const key = `${s.modelo}|${s.fraccion}|${op}`
      const existing = map.get(key)
      if (existing) {
        const sBlocks = s.blocks || []
        for (let i = 0; i < NB; i++) {
          existing.blocks[i] = (existing.blocks[i] || 0) + (sBlocks[i] || 0)
        }
        existing.total = existing.blocks.reduce((sum, v) => sum + (v || 0), 0)
        if (!existing.robot && s.robot) existing.robot = s.robot
        if (s.motivos_por_bloque) {
          const motivos = { ...(existing.motivos_por_bloque || {}) }
          for (const [bi, m] of Object.entries(s.motivos_por_bloque)) {
            if (!motivos[bi]) motivos[bi] = m as string
          }
          existing.motivos_por_bloque = motivos
        }
      } else {
        const initBlocks = new Array(NB).fill(0)
        const sBlocks = s.blocks || []
        for (let i = 0; i < sBlocks.length && i < NB; i++) {
          initBlocks[i] = sBlocks[i] || 0
        }
        map.set(key, { ...s, operario: op, blocks: initBlocks, total: s.total })
      }
    }
    return [...map.values()]
  }, [rawSchedule])

  const schedule = useMemo(() => {
    if (!cascadeSort) return consolidatedSchedule
    return [...consolidatedSchedule].sort((a, b) => {
      const firstA = (a.blocks || []).findIndex((v) => v > 0)
      const firstB = (b.blocks || []).findIndex((v) => v > 0)
      const startA = firstA === -1 ? 999 : firstA
      const startB = firstB === -1 ? 999 : firstB
      if (startA !== startB) return startA - startB
      // Secondary: last active block (earlier end first)
      const lastA = (a.blocks || []).findLastIndex((v) => v > 0)
      const lastB = (b.blocks || []).findLastIndex((v) => v > 0)
      if (lastA !== lastB) return lastA - lastB
      // Tertiary: modelo + fraccion
      const mCmp = a.modelo.localeCompare(b.modelo)
      if (mCmp !== 0) return mCmp
      return a.fraccion - b.fraccion
    })
  }, [consolidatedSchedule, cascadeSort])

  const totalPares = data.total_pares || 0
  const paresAdelantados = data.pares_adelantados || 0
  const paresRezago = data.pares_rezago || 0
  const weeklyPares = useMemo(() => {
    if (!weeklySchedule) return 0
    return weeklySchedule
      .filter((e) => e.Dia === dayName)
      .reduce((sum, e) => sum + e.Pares, 0)
  }, [weeklySchedule, dayName])
  const tardiness = data.total_tardiness || 0
  const tardinessByModel = data.tardiness_by_model || {}

  // Compute adelanto detail by model from schedule entries flagged as adelanto
  const adelantoByModel = useMemo(() => {
    const map: Record<string, number> = {}
    for (const s of rawSchedule) {
      if (s.adelanto && s.total > 0) {
        map[s.modelo] = (map[s.modelo] || 0) + s.total
      }
    }
    return map
  }, [rawSchedule])
  const plantilla = data.plantilla || 0
  const status = data.status || '?'
  const maxHc = schedule.reduce((max, s) => Math.max(max, s.hc), 0)
  const unassignedCount = (data.unassigned_ops || []).length

  // Per-model production summary from weekly schedule (real pares per model)
  const modelSummary = useMemo(() => {
    if (!weeklySchedule) return []
    const map: Record<string, number> = {}
    for (const e of weeklySchedule) {
      if (e.Dia === dayName) {
        map[e.Modelo] = (map[e.Modelo] || 0) + e.Pares
      }
    }
    // Adelanto pares per model: min total across operations (bottleneck = actual output)
    const adelantoMap: Record<string, number> = {}
    for (const s of rawSchedule) {
      if (s.adelanto && s.total > 0) {
        const prev = adelantoMap[s.modelo]
        adelantoMap[s.modelo] = prev === undefined ? s.total : Math.min(prev, s.total)
      }
    }
    return Object.entries(map)
      .map(([modelo, pares]) => ({ modelo, pares, adelanto: adelantoMap[modelo] || 0 }))
      .sort((a, b) => (b.pares + b.adelanto) - (a.pares + a.adelanto))
  }, [weeklySchedule, dayName, rawSchedule])

  // Detect block labels from first schedule entry with blocks
  const blockLabels = useMemo(() => {
    const maxBlocks = schedule.reduce((max, s) => Math.max(max, s.blocks?.length || 0), 0)
    return BLOCK_LABELS.slice(0, maxBlocks || 10)
  }, [schedule])

  // Export data for TableExport
  const exportHeaders = useMemo(
    () => ['MODELO', 'FRACC', 'OPERACION', 'ETAPA', 'RECURSO', 'OPERARIO', 'RATE', 'HC', ...blockLabels, 'TOTAL'],
    [blockLabels]
  )
  const exportRows = useMemo(
    () =>
      schedule.map((s) => [
        s.modelo,
        s.fraccion,
        s.operacion,
        s.etapa || s.input_o_proceso || '',
        s.robot || s.recurso,
        s.operario || '-',
        s.rate,
        s.hc,
        ...(s.blocks || []).map((v) => (v > 0 ? v : '')),
        s.total,
      ] as (string | number)[]),
    [schedule]
  )

  /** Resolve color for a schedule entry using input_o_proceso from catalog */
  const getEtapaColor = useMemo(() => {
    function colorFromProceso(ip: string): string {
      if (!ip) return ''
      if (ip.includes('N/A')) return STAGE_COLORS['N/A PRELIMINAR']
      if (ip.includes('PRELIMINAR')) return STAGE_COLORS.PRELIMINAR
      if (ip.includes('ROBOT')) return STAGE_COLORS.ROBOT
      if (ip.includes('POST')) return STAGE_COLORS.POST
      if (ip.includes('MAQUILA')) return STAGE_COLORS.MAQUILA
      return ''
    }
    return (s: DailyScheduleEntry): string => {
      // Fuente primaria: input_o_proceso del catálogo
      const modeloNum = s.modelo.split(' ')[0]
      const catalogIp = inputProcesoMap.get(`${modeloNum}|${s.fraccion}`) || ''
      const fromCatalog = colorFromProceso(catalogIp)
      if (fromCatalog) return fromCatalog
      // Fallback: input_o_proceso del resultado (si existe)
      const fromResult = colorFromProceso(s.input_o_proceso || '')
      if (fromResult) return fromResult
      // Fallback final: etapa
      const etapa = s.etapa || ''
      if (!etapa) return '#94A3B8'
      if (etapa.includes('N/A PRELIMINAR')) return STAGE_COLORS['N/A PRELIMINAR']
      if (etapa.includes('PRELIMINAR') || etapa.includes('PRE') || etapa === 'MESA') return STAGE_COLORS.PRELIMINAR
      if (etapa.includes('ROBOT')) return STAGE_COLORS.ROBOT
      if (etapa.includes('POST') || etapa.includes('ZIGZAG')) return STAGE_COLORS.POST
      if (etapa.includes('MAQUILA')) return STAGE_COLORS.MAQUILA
      return '#94A3B8'
    }
  }, [inputProcesoMap])

  /** Lookup input_o_proceso from catalog for export */
  const getInputProceso = useMemo(() => {
    return (s: DailyScheduleEntry): string => {
      const modeloNum = s.modelo.split(' ')[0]
      return inputProcesoMap.get(`${modeloNum}|${s.fraccion}`) || ''
    }
  }, [inputProcesoMap])

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Pares del Dia</p>
            <p className="text-2xl font-bold">{totalPares.toLocaleString()}</p>
            {weeklyPares > 0 && (
              <div className="mt-1 space-y-0.5 text-[10px]">
                <div className="flex justify-between text-muted-foreground">
                  <span>Programados</span>
                  <span className="font-mono">{weeklyPares.toLocaleString()}</span>
                </div>
                {paresRezago > 0 && (
                  <div className="flex justify-between text-orange-500">
                    <span>Rezago dia ant.</span>
                    <span className="font-mono">+{paresRezago.toLocaleString()}</span>
                  </div>
                )}
                {paresAdelantados > 0 && (
                  <details className="group">
                    <summary className="flex justify-between text-blue-500 cursor-pointer list-none">
                      <span>Adelanto</span>
                      <span className="font-mono">+{paresAdelantados.toLocaleString()}</span>
                    </summary>
                    <div className="pl-2 mt-0.5 space-y-0.5 text-blue-400">
                      {Object.entries(adelantoByModel).map(([modelo, pares]) => (
                        <div key={modelo} className="flex justify-between">
                          <span className="truncate mr-2">{modelo}</span>
                          <span className="font-mono">{pares.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {tardiness > 0 && (
                  <details className="group">
                    <summary className="flex justify-between text-amber-500 cursor-pointer list-none">
                      <span>No alcanzados</span>
                      <span className="font-mono">−{tardiness.toLocaleString()}</span>
                    </summary>
                    <div className="pl-2 mt-0.5 space-y-0.5 text-amber-400">
                      {Object.entries(tardinessByModel).map(([modelo, pares]) => (
                        <div key={modelo} className="flex justify-between">
                          <span className="truncate mr-2">{modelo}</span>
                          <span className="font-mono">−{pares.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </CardContent>
        </Card>
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

      {/* Preliminares adelantadas del dia anterior */}
      {data.prelim_adelantadas && Object.keys(data.prelim_adelantadas).length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-blue-500/10 border border-blue-500/30 text-xs">
          <span className="font-semibold text-blue-500">Preliminares hechas ayer:</span>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(data.prelim_adelantadas as Record<string, number[]>).map(([modelo, fracs]) => (
              <span key={modelo} className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-mono text-[10px]">
                {modelo} F{(fracs as number[]).join(',F')}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Per-model production summary */}
      {modelSummary.length > 0 && (
        <Card>
          <CardContent className="pt-3 pb-2">
            <p className="text-xs font-semibold text-muted-foreground mb-2">Produccion por Modelo</p>
            <div className="flex flex-wrap gap-2">
              {modelSummary.map(({ modelo, pares, adelanto }) => (
                <div key={modelo} className="flex items-center gap-1.5 rounded-md border px-2 py-1">
                  <span className="text-xs font-medium truncate max-w-[140px]">{modelo}</span>
                  <Badge variant="secondary" className="text-xs font-mono">
                    {pares.toLocaleString()}
                  </Badge>
                  {adelanto > 0 && (
                    <Badge variant="outline" className="text-xs font-mono text-blue-500 border-blue-300">
                      +{adelanto.toLocaleString()}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Legend */}
      <div className="flex gap-4">
        {Object.entries(STAGE_COLORS).map(([name, color]) => (
          <div key={name} className="flex items-center gap-1">
            <div className="h-3 w-3 rounded border" style={{ backgroundColor: name === 'N/A PRELIMINAR' ? '#fff' : color }} />
            <span className="text-xs">{name}</span>
          </div>
        ))}
      </div>

      {/* View tabs */}
      <div className="flex items-center gap-1">
        {([
          { key: 'programa', label: 'Programa', icon: ArrowDownWideNarrow },
          { key: 'operario', label: 'Por Operario', icon: User },
          { key: 'recurso', label: 'Por Recurso', icon: Cpu },
        ] as const).map(({ key, label, icon: Icon }) => (
          <Button
            key={key}
            variant={viewTab === key ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setViewTab(key)}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Button>
        ))}
      </div>

      {/* Programa table view */}
      {viewTab === 'programa' && (
      <Card>
        <CardContent className="pt-4 overflow-x-auto">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Programa — {dayName}</h3>
              <Button
                variant={cascadeSort ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={onToggleCascade}
              >
                <ArrowDownWideNarrow className="h-3.5 w-3.5" />
                Cascada
              </Button>
            </div>
            <TableExport
              title={`Programa_${dayName}`}
              headers={exportHeaders}
              rows={exportRows}
            />
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse min-w-[700px]">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-1 text-left">MODELO</th>
                <th className="px-2 py-1 text-left">FRACC</th>
                <th className="px-2 py-1 text-left">OPERACION</th>
                <th className="px-2 py-1 text-left">ETAPA</th>
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
                const bgColor = getEtapaColor(s)
                const recursoKey = s.robot || s.recurso
                const isHighlighted = (selectedOperario != null && s.operario === selectedOperario) || (selectedRecurso != null && recursoKey === selectedRecurso)
                const isDimmed = (selectedOperario != null && s.operario !== selectedOperario) || (selectedRecurso != null && recursoKey !== selectedRecurso)
                const isSinAsignar = s.operario === 'SIN ASIGNAR'
                return (
                  <tr key={i} className={`border-b hover:bg-accent/30 transition-opacity ${isHighlighted ? 'bg-primary/10 ring-1 ring-primary/30' : ''} ${isDimmed ? 'opacity-25' : ''} ${isSinAsignar ? 'animate-pulse-alert bg-red-500/10 dark:bg-red-500/15' : ''}`}>
                    <td className="px-2 py-1 font-mono font-medium">
                      <span className="flex items-center gap-1">
                        {(() => { const [num, ...c] = s.modelo.split(' '); const u = getModeloImageUrl(catImages, num, c.join(' ')); return u ? <img src={u} alt={s.modelo} className="h-6 w-auto rounded border object-contain bg-white" /> : null })()}
                        {s.modelo}
                        {s.adelanto && (
                          <Badge variant="secondary" className="text-[8px] px-1 py-0 bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">ADL {s.adelanto_de}</Badge>
                        )}
                        {!s.adelanto && tardinessByModel[s.modelo] > 0 && s.fraccion === 1 && (
                          <Badge variant="secondary" className="text-[8px] px-1 py-0 bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">−{tardinessByModel[s.modelo]}p rezago</Badge>
                        )}
                        {maquilaModelos.has(s.modelo) && (
                          <Truck className="h-3 w-3 text-destructive" />
                        )}
                      </span>
                    </td>
                    <td className="px-2 py-1">{s.fraccion}</td>
                    <td className="px-2 py-1 max-w-[180px]">
                      <span className="truncate block">{s.operacion}</span>
                      {(() => {
                        const dep = maquilaDeps.get(`${s.modelo.split(' ')[0]}|${s.fraccion}`)
                        if (!dep) return null
                        const fecha = dep.fecha_entrega
                          ? new Date(dep.fecha_entrega).toLocaleString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                          : 'sin fecha'
                        return (
                          <span className="text-[9px] text-destructive/70 flex items-center gap-0.5">
                            <Truck className="h-2.5 w-2.5 inline" />
                            {dep.maquila} — llega {fecha}
                          </span>
                        )
                      })()}
                    </td>
                    <td className="px-2 py-1">
                      <span className="text-[9px] font-medium px-1 py-0.5 rounded" style={{ backgroundColor: `${bgColor}20`, color: bgColor }}>
                        {s.etapa || s.input_o_proceso || ''}
                      </span>
                    </td>
                    <td className="px-2 py-1">
                      <button
                        className="cursor-pointer"
                        onClick={() => { setSelectedOperario(null); setSelectedRecurso(selectedRecurso === recursoKey ? null : recursoKey) }}
                      >
                        <Badge variant="outline" className={`text-[10px] hover:bg-accent ${selectedRecurso === recursoKey ? 'ring-1 ring-primary bg-primary/10 font-bold' : ''}`}>
                          {recursoKey}
                        </Badge>
                      </button>
                    </td>
                    <td className="px-2 py-1">
                      {s.operario === 'SIN ASIGNAR' ? (
                        <OperarioSelector
                          entry={s}
                          entryIndex={i}
                          schedule={schedule}
                          allOperarios={allOperarios}
                          dayName={dayName}
                          blockLabels={blockLabels}
                          onAssign={async (operario) => {
                            // Update in the current result's daily_results
                            const currentResult = useAppStore.getState().currentResult
                            if (!currentResult) return
                            const dr = { ...currentResult.daily_results }
                            const dayData = dr[dayName]
                            if (!dayData) return
                            const newSchedule = [...dayData.schedule]
                            // Find and update this specific entry
                            const target = newSchedule.find((e, idx) =>
                              e.modelo === s.modelo && e.fraccion === s.fraccion &&
                              e.operario === 'SIN ASIGNAR' && idx === i
                            )
                            if (target) {
                              target.operario = operario
                              delete (target as unknown as Record<string, unknown>).motivo_sin_asignar
                              delete (target as unknown as Record<string, unknown>).motivos_por_bloque
                            }
                            const newDaily = { ...dr, [dayName]: { ...dayData, schedule: newSchedule } }
                            // Save to Supabase
                            await supabase
                              .from('resultados')
                              .update({ daily_results: newDaily })
                              .eq('id', currentResult.id)
                            // Update local state
                            useAppStore.getState().setCurrentResult({ ...currentResult, daily_results: newDaily })
                          }}
                        />
                      ) : s.operario ? (
                        <div className="flex items-center gap-1">
                          <button
                            className={`text-[10px] font-medium cursor-pointer hover:underline ${selectedOperario === s.operario ? 'underline text-primary font-bold' : ''}`}
                            onClick={() => { setSelectedRecurso(null); setSelectedOperario(selectedOperario === s.operario ? null : s.operario!) }}
                          >
                            {s.operario}
                          </button>
                          {(allOperarios.find(o => o.nombre === s.operario)?.habilidades || []).map((h) => {
                            const group = Object.values(SKILL_GROUPS).find(g => g.skills.includes(h))
                            return group ? (
                              <span key={h} className="text-[7px] px-0.5 rounded font-medium" style={{ backgroundColor: `${group.color}20`, color: group.color }}>
                                {group.short}
                              </span>
                            ) : null
                          })}
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">{s.rate}</td>
                    <td className="px-2 py-1 text-right">{s.hc}</td>
                    {(s.blocks || []).map((val, bi) => {
                      const blockMotivo = isSinAsignar && val > 0
                        ? (s.motivos_por_bloque?.[String(bi)] || s.motivo_sin_asignar || 'Sin operario disponible')
                        : undefined
                      return (
                        <td
                          key={bi}
                          className={`px-1 py-1 text-center ${isSinAsignar && val > 0 ? 'ring-1 ring-inset ring-red-500/50 font-bold cursor-help' : ''}`}
                          title={blockMotivo}
                          style={{
                            backgroundColor: val > 0
                              ? isSinAsignar ? 'rgba(239,68,68,0.25)' : `${bgColor}30`
                              : undefined,
                            color: val > 0
                              ? isSinAsignar ? '#ef4444' : bgColor
                              : undefined,
                            fontWeight: val > 0 ? 600 : 400,
                          }}
                        >
                          {val > 0 ? val : ''}
                        </td>
                      )
                    })}
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
          </div>
        </CardContent>
      </Card>
      )}

      {/* Operario cascade view */}
      {viewTab === 'operario' && (
        <CascadeByOperario schedule={schedule} blockLabels={blockLabels} getEtapaColor={getEtapaColor} dayName={dayName} allOperarios={allOperarios} />
      )}

      {/* Recurso cascade view */}
      {viewTab === 'recurso' && (
        <CascadeByRecurso schedule={schedule} blockLabels={blockLabels} getEtapaColor={getEtapaColor} dayName={dayName} />
      )}

      {/* Operarios no utilizados */}
      <IdleOperators schedule={schedule} dayName={dayName} allOperarios={allOperarios} />
    </div>
  )
}

/** Cascade view grouped by OPERARIO — each row is an operator, cells show what they do per block */
function CascadeByOperario({ schedule, blockLabels, getEtapaColor, dayName, allOperarios }: {
  schedule: DailyScheduleEntry[]; blockLabels: string[]; getEtapaColor: (s: DailyScheduleEntry) => string; dayName: string
  allOperarios: { nombre: string; habilidades: SkillType[] }[]
}) {
  const opSkillMap = useMemo(() => {
    const m = new Map<string, SkillType[]>()
    for (const op of allOperarios) m.set(op.nombre, op.habilidades)
    return m
  }, [allOperarios])
  const grouped = useMemo(() => {
    const map = new Map<string, { blocks: (DailyScheduleEntry | null)[] }>()
    for (const s of schedule) {
      const name = s.operario || 'SIN ASIGNAR'
      if (!map.has(name)) map.set(name, { blocks: new Array(blockLabels.length).fill(null) })
      const entry = map.get(name)!
      ;(s.blocks || []).forEach((val, bi) => {
        if (val > 0 && bi < blockLabels.length) {
          entry.blocks[bi] = s // last writer wins (most ops occupy 1-2 blocks per operator)
        }
      })
    }
    return [...map.entries()].sort((a, b) => {
      if (a[0] === 'SIN ASIGNAR') return 1
      if (b[0] === 'SIN ASIGNAR') return -1
      return a[0].localeCompare(b[0])
    })
  }, [schedule, blockLabels])

  const jsonData = useMemo(() => {
    return grouped.map(([name, data]) => {
      const row: Record<string, unknown> = {
        operario: name,
        habilidades: (opSkillMap.get(name) || []),
      }
      blockLabels.forEach((label, bi) => {
        const s = data.blocks[bi]
        if (s) {
          const pares = (s.blocks || [])[bi] || 0
          row[label] = `${s.modelo} F${s.fraccion} ${s.robot || s.recurso} ${pares}p`
        } else {
          row[label] = ''
        }
      })
      return row
    })
  }, [grouped, blockLabels, opSkillMap])

  const [copied, setCopied] = useState(false)
  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(jsonData, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card>
      <CardContent className="pt-4 overflow-x-auto">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Cascada por Operario — {dayName}</h3>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={handleCopyJson}>
            {copied ? '✓ Copiado' : '{ } JSON'}
          </Button>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse min-w-[700px]">
          <thead>
            <tr className="border-b">
              <th className="px-2 py-1 text-left min-w-[200px]">OPERARIO</th>
              {blockLabels.map((b) => (
                <th key={b} className="px-1 py-1 text-center w-[90px]">{b}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped.map(([name, data]) => (
              <tr key={name} className="border-b hover:bg-accent/30">
                <td className="px-2 py-1.5 font-medium text-[10px]">
                  <div className="flex items-center gap-1 flex-wrap">
                    {name === 'SIN ASIGNAR'
                      ? <span className="text-destructive">{name}</span>
                      : <span>{name}</span>}
                    {name !== 'SIN ASIGNAR' && (opSkillMap.get(name) || []).map((h) => {
                      const group = Object.values(SKILL_GROUPS).find(g => g.skills.includes(h))
                      return group ? (
                        <span
                          key={h}
                          className="text-[7px] px-0.5 rounded font-medium"
                          style={{ backgroundColor: `${group.color}20`, color: group.color }}
                        >
                          {group.short}
                        </span>
                      ) : null
                    })}
                  </div>
                </td>
                {data.blocks.map((s, bi) => {
                  if (!s) return <td key={bi} className="px-1 py-1.5 text-center text-muted-foreground/30">—</td>
                  const bgColor = getEtapaColor(s)
                  const pares = (s.blocks || [])[bi] || 0
                  return (
                    <td
                      key={bi}
                      className="px-1 py-0.5 text-center"
                      style={{ backgroundColor: `${bgColor}25` }}
                    >
                      <div className="text-[9px] font-medium truncate" style={{ color: bgColor }}>
                        {s.modelo}
                      </div>
                      <div className="text-[8px] text-muted-foreground truncate">
                        F{s.fraccion} · {(s.robot || s.recurso)}
                      </div>
                      <div className="text-[10px] font-bold" style={{ color: bgColor }}>
                        {pares}p
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </CardContent>
    </Card>
  )
}

/** Shows operators not utilized on this day with the reason and their skills */
function IdleOperators({ schedule, dayName, allOperarios }: {
  schedule: DailyScheduleEntry[]; dayName: string
  allOperarios: { nombre: string; activo: boolean; dias: string[]; habilidades: SkillType[] }[]
}) {
  const dayPrefix = dayName.split(' ')[0]

  const idle = useMemo(() => {
    const working = new Set<string>()
    for (const s of schedule) {
      if (s.operario && s.operario !== 'SIN ASIGNAR') working.add(s.operario)
    }

    const result: { nombre: string; motivo: string; habilidades: SkillType[] }[] = []
    for (const op of allOperarios) {
      if (working.has(op.nombre)) continue

      if (!op.activo) {
        result.push({ nombre: op.nombre, motivo: 'Inactivo', habilidades: op.habilidades })
      } else if (op.dias.length > 0 && !op.dias.some(d => d === dayName || dayName.startsWith(d) || d.startsWith(dayPrefix))) {
        result.push({ nombre: op.nombre, motivo: `No disponible ${dayPrefix}`, habilidades: op.habilidades })
      } else {
        result.push({ nombre: op.nombre, motivo: 'Disponible, sin asignación', habilidades: op.habilidades })
      }
    }
    return result
  }, [allOperarios, schedule, dayName, dayPrefix])

  if (idle.length === 0) return null

  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-2 mb-2">
          <UserX className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Operarios no utilizados — {dayName}</h3>
          <Badge variant="outline" className="text-[10px]">{idle.length}</Badge>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {idle.map((op) => (
            <div key={op.nombre} className="flex items-center gap-2 px-2 py-1.5 rounded bg-accent/30 text-xs">
              <span className="font-medium truncate min-w-0 shrink">{op.nombre}</span>
              <div className="flex items-center gap-1 flex-wrap shrink-0">
                {op.habilidades.map((h) => {
                  const group = Object.values(SKILL_GROUPS).find(g => g.skills.includes(h))
                  const color = group?.color || '#94A3B8'
                  return (
                    <span
                      key={h}
                      className="text-[8px] px-1 py-0 rounded font-medium"
                      style={{ backgroundColor: `${color}20`, color }}
                    >
                      {SKILL_LABELS[h] || h}
                    </span>
                  )
                })}
              </div>
              <Badge
                variant={op.motivo === 'Inactivo' ? 'destructive' : op.motivo.startsWith('No disponible') ? 'secondary' : 'outline'}
                className="text-[9px] ml-auto shrink-0"
              >
                {op.motivo}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

/** Cascade view grouped by RECURSO (robot/machine) — each row is a resource, cells show what it produces per block */
function CascadeByRecurso({ schedule, blockLabels, getEtapaColor, dayName }: {
  schedule: DailyScheduleEntry[]; blockLabels: string[]; getEtapaColor: (s: DailyScheduleEntry) => string; dayName: string
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, { blocks: (DailyScheduleEntry | null)[] }>()
    for (const s of schedule) {
      const recurso = s.robot || s.recurso
      if (!recurso) continue
      if (!map.has(recurso)) map.set(recurso, { blocks: new Array(blockLabels.length).fill(null) })
      const entry = map.get(recurso)!
      ;(s.blocks || []).forEach((val, bi) => {
        if (val > 0 && bi < blockLabels.length) {
          entry.blocks[bi] = s
        }
      })
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [schedule, blockLabels])

  return (
    <Card>
      <CardContent className="pt-4 overflow-x-auto">
        <h3 className="text-sm font-semibold mb-2">Cascada por Recurso — {dayName}</h3>
        <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse min-w-[700px]">
          <thead>
            <tr className="border-b">
              <th className="px-2 py-1 text-left min-w-[120px]">RECURSO</th>
              {blockLabels.map((b) => (
                <th key={b} className="px-1 py-1 text-center w-[90px]">{b}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped.map(([recurso, data]) => (
              <tr key={recurso} className="border-b hover:bg-accent/30">
                <td className="px-2 py-1.5">
                  <Badge variant="outline" className="text-[10px]">{recurso}</Badge>
                </td>
                {data.blocks.map((s, bi) => {
                  if (!s) return <td key={bi} className="px-1 py-1.5 text-center text-muted-foreground/30">—</td>
                  const bgColor = getEtapaColor(s)
                  const pares = (s.blocks || [])[bi] || 0
                  return (
                    <td
                      key={bi}
                      className="px-1 py-0.5 text-center"
                      style={{ backgroundColor: `${bgColor}25` }}
                    >
                      <div className="text-[9px] font-medium truncate" style={{ color: bgColor }}>
                        {s.modelo}
                      </div>
                      <div className="text-[8px] text-muted-foreground truncate">
                        F{s.fraccion} · {s.operario ? s.operario.split(' ').slice(0, 2).join(' ') : '-'}
                      </div>
                      <div className="text-[10px] font-bold" style={{ color: bgColor }}>
                        {pares}p
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </CardContent>
    </Card>
  )
}


// ============================================================
// Operario Selector — dropdown para asignar manualmente
// ============================================================

function OperarioSelector({
  entry, schedule, allOperarios, dayName, blockLabels, onAssign,
}: {
  entry: DailyScheduleEntry
  entryIndex: number
  schedule: DailyScheduleEntry[]
  allOperarios: { nombre: string; activo: boolean; dias: string[]; habilidades: SkillType[] }[]
  dayName: string
  blockLabels: string[]
  onAssign: (operario: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [assigning, setAssigning] = useState(false)

  const activeBlocks = (entry.blocks || []).map((v, i) => ({ idx: i, pares: v })).filter((b) => b.pares > 0)

  const busyInBlocks = useMemo(() => {
    const busy = new Map<string, Set<number>>()
    for (const s of schedule) {
      if (!s.operario || s.operario === 'SIN ASIGNAR') continue
      for (let bi = 0; bi < (s.blocks || []).length; bi++) {
        if ((s.blocks || [])[bi] > 0) {
          if (!busy.has(s.operario)) busy.set(s.operario, new Set())
          busy.get(s.operario)!.add(bi)
        }
      }
    }
    return busy
  }, [schedule])

  const dayPrefix = dayName.split(' ')[0] || dayName
  const available = useMemo(() => {
    return allOperarios
      .filter((op) => op.activo)
      .filter((op) => {
        if (op.dias.length === 0) return true
        return op.dias.some((d) => d === dayName || d.startsWith(dayPrefix) || dayName.startsWith(d))
      })
      .map((op) => {
        const busyBlocks = busyInBlocks.get(op.nombre) || new Set()
        const conflictBlocks = activeBlocks.filter((b) => busyBlocks.has(b.idx))
        const isFree = conflictBlocks.length === 0
        return { ...op, isFree, conflictBlocks }
      })
      .sort((a, b) => {
        if (a.isFree && !b.isFree) return -1
        if (!a.isFree && b.isFree) return 1
        return a.nombre.localeCompare(b.nombre)
      })
  }, [allOperarios, busyInBlocks, activeBlocks, dayName, dayPrefix])

  async function handleSelect(nombre: string) {
    setAssigning(true)
    try {
      await onAssign(nombre)
    } finally {
      setAssigning(false)
      setOpen(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-500 dark:text-red-400 ring-1 ring-red-500/40 hover:bg-red-500/30 transition-colors"
        title={entry.motivo_sin_asignar || 'Click para asignar operario'}
      >
        <UserX className="h-3 w-3" />
        SIN ASIGNAR
      </button>
    )
  }

  return (
    <div className="relative">
      <div className="fixed z-[100] w-80 max-h-60 overflow-y-auto rounded-lg border-2 shadow-2xl p-1" style={{ backgroundColor: 'hsl(var(--card))', top: '30%', left: '40%' }}>
        <div className="text-[9px] text-muted-foreground px-2 py-1 border-b mb-1">
          {entry.recurso} · Bloques: {activeBlocks.map((b) => blockLabels[b.idx]).join(', ')}
        </div>
        {available.map((op) => (
          <button
            key={op.nombre}
            disabled={!op.isFree || assigning}
            onClick={() => handleSelect(op.nombre)}
            className={`w-full text-left px-2 py-1 rounded text-[10px] flex items-center justify-between gap-1 ${
              op.isFree
                ? 'hover:bg-accent cursor-pointer'
                : 'opacity-40 cursor-not-allowed'
            }`}
          >
            <span className="truncate font-medium">{op.nombre}</span>
            {!op.isFree && (
              <span className="text-[8px] text-red-400 whitespace-nowrap">
                Ocupado {op.conflictBlocks.map((b) => blockLabels[b.idx]).join(',')}
              </span>
            )}
          </button>
        ))}
        <button
          onClick={() => setOpen(false)}
          className="w-full text-center text-[9px] text-muted-foreground hover:text-foreground py-1 mt-1 border-t"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
