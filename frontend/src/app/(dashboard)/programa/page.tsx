'use client'

import { useState, useMemo, useEffect } from 'react'
import { useAppStore } from '@/lib/store/useAppStore'
import { supabase } from '@/lib/supabase/client'
import { KpiCard } from '@/components/shared/KpiCard'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { DaySelector } from '@/components/shared/DaySelector'
import { STAGE_COLORS, BLOCK_LABELS, DAY_ORDER } from '@/types'
import type { DailyResult, AsignacionMaquila } from '@/types'
import { Truck } from 'lucide-react'

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
}

/** Catalog-level: models that have MAQUILA operations (from catalogo_operaciones) */
interface CatalogMaquilaOp {
  modelo_num: string
  fraccion: number
  operacion: string
}

export default function ProgramaPage() {
  const result = useAppStore((s) => s.currentResult)
  const pedidoNombre = useAppStore((s) => s.currentPedidoNombre)
  const [selectedDay, setSelectedDay] = useState<string>('')
  const [maquilaFabricas, setMaquilaFabricas] = useState<Set<string>>(new Set())
  const [opMaquilaEntries, setOpMaquilaEntries] = useState<OpMaquilaEntry[]>([])
  const [catalogMaquilaOps, setCatalogMaquilaOps] = useState<CatalogMaquilaOp[]>([])

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

    // Collect unique model codes from the result
    const modelCodes = new Set<string>()
    if (result.weekly_schedule) {
      for (const e of result.weekly_schedule) modelCodes.add(e.Modelo)
    }
    if (result.daily_results) {
      for (const dayData of Object.values(result.daily_results)) {
        for (const s of dayData.schedule || []) modelCodes.add(s.modelo)
      }
    }
    if (modelCodes.size === 0) { setCatalogMaquilaOps([]); return }

    // Query catalog for MAQUILA operations of these models
    supabase
      .from('catalogo_operaciones')
      .select('fraccion, operacion, catalogo_modelos!inner(modelo_num)')
      .eq('recurso', 'MAQUILA')
      .in('catalogo_modelos.modelo_num', [...modelCodes])
      .order('fraccion')
      .then(({ data }) => {
        setCatalogMaquilaOps(
          (data || []).map((op: { fraccion: number; operacion: string; catalogo_modelos: unknown }) => ({
            modelo_num: (op.catalogo_modelos as { modelo_num: string }).modelo_num,
            fraccion: op.fraccion,
            operacion: op.operacion,
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

                {/* Operation-level assigned maquila */}
                {hasOpMaquila && (
                  <div className={hasFabricaMaquila ? 'mt-2 pt-2 border-t border-destructive/20' : 'mt-2'}>
                    <p className="text-xs font-medium text-destructive/70 mb-1">
                      Operaciones Asignadas:
                    </p>
                    <div className="space-y-1">
                      {[...opMaquilaByFactory.entries()].map(([maquila, models]) => (
                        <div key={maquila} className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="border-destructive/40 text-destructive text-xs">
                            {maquila}
                          </Badge>
                          {[...models.entries()].map(([modelo, info]) => (
                            <span key={modelo} className="text-xs text-destructive/70 font-mono">
                              {modelo}: {info.pares} pares (F{info.fracciones.join(', F')})
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Unassigned MAQUILA operations (from catalog, not yet assigned) */}
                {hasUnassignedMaquila && (
                  <div className={(hasFabricaMaquila || hasOpMaquila) ? 'mt-2 pt-2 border-t border-destructive/20' : 'mt-2'}>
                    <p className="text-xs font-medium text-amber-600 mb-1">
                      Sin Asignar Maquila (ir a Datos &gt; Pedido):
                    </p>
                    <div className="space-y-1">
                      {[...unassignedMaquilaByModel.entries()].map(([modelo, ops]) => (
                        <div key={modelo} className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-amber-600 font-mono font-medium">{modelo}</span>
                          <span className="text-xs text-amber-600/70">
                            F{ops.map((o) => o.fraccion).join(', F')} — {ops.map((o) => o.operacion).join(', ')}
                          </span>
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

      {dayData && <DayView dayName={day} data={dayData} maquilaModelos={maquilaModelos} />}
    </div>
  )
}

function DayView({ dayName, data, maquilaModelos }: { dayName: string; data: DailyResult; maquilaModelos: Set<string> }) {
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
    if (etapa.includes('N/A PRELIMINAR')) return STAGE_COLORS['N/A PRELIMINAR']
    if (etapa.includes('PRELIMINAR') || etapa.includes('PRE')) return STAGE_COLORS.PRELIMINAR
    if (etapa.includes('ROBOT')) return STAGE_COLORS.ROBOT
    if (etapa.includes('POST')) return STAGE_COLORS.POST
    if (etapa.includes('MAQUILA')) return STAGE_COLORS.MAQUILA
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
            <div className="h-3 w-3 rounded border" style={{ backgroundColor: name === 'N/A PRELIMINAR' ? '#fff' : color }} />
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
                    <td className="px-2 py-1 font-mono font-medium">
                      <span className="flex items-center gap-1">
                        {s.modelo}
                        {maquilaModelos.has(s.modelo) && (
                          <Truck className="h-3 w-3 text-destructive" />
                        )}
                      </span>
                    </td>
                    <td className="px-2 py-1">{s.fraccion}</td>
                    <td className="px-2 py-1 max-w-[120px] truncate">{s.operacion}</td>
                    <td className="px-2 py-1">
                      <Badge variant="outline" className="text-[10px]">
                        {s.robot || s.recurso}
                      </Badge>
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
