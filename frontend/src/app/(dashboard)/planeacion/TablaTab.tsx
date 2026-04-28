'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { STAGE_COLORS, DAY_ORDER } from '@/types'
import type { DayName } from '@/types'
import { Download, Layers, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const ETAPAS = ['MAQ', 'PREL', 'ROBOT', 'POST', 'N/A'] as const
type Etapa = typeof ETAPAS[number]

const ETAPA_COLOR: Record<Etapa, string> = {
  MAQ: '#f43f5e',
  PREL: '#fbbf24',
  ROBOT: '#10b981',
  POST: '#ec4899',
  'N/A': '#60a5fa',
}

const PROCESO_TO_ETAPA: Record<string, Etapa> = {
  PRELIMINARES: 'PREL',
  ROBOT: 'ROBOT',
  POST: 'POST',
  MAQUILA: 'MAQ',
  'N/A PRELIMINAR': 'N/A',
}

const HRS_POR_PERSONA = 9

interface PlanDayStats {
  id: string
  nombre: string
  hrsByEtapaByDay: Record<Etapa, Partial<Record<DayName, number>>>
  totalHrs: number
}

export function TablaTab() {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<PlanDayStats[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

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

  // Dias activos en cualquier plan visible (al menos una etapa con > 0)
  const diasActivos = useMemo(() => {
    return DAY_ORDER.filter((d) =>
      visible.some((p) => ETAPAS.some((e) => (p.hrsByEtapaByDay[e]?.[d] ?? 0) > 0)),
    )
  }, [visible])

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Renderiza una celda con horas y personas apilados
  const renderCell = (h: number) => {
    if (h === 0) {
      return <span className="text-muted-foreground">—</span>
    }
    const p = h / HRS_POR_PERSONA
    return (
      <div className="flex flex-col leading-tight">
        <span className="font-medium">{h.toFixed(1)} h</span>
        <span className="text-[10px] text-muted-foreground">{p.toFixed(1)} p</span>
      </div>
    )
  }

  // Total general
  const grandTotal = useMemo(() => {
    let total = 0
    const byDay: Record<string, number> = {}
    for (const p of visible) {
      total += p.totalHrs
      for (const e of ETAPAS) {
        const ed = p.hrsByEtapaByDay[e]
        for (const d of diasActivos) {
          byDay[d] = (byDay[d] ?? 0) + (ed?.[d] ?? 0)
        }
      }
    }
    return { total, byDay }
  }, [visible, diasActivos])

  const handleExportExcel = async () => {
    const XLSX = await import('xlsx-js-style')
    const wsData: (string | number | null)[][] = []
    const round1 = (x: number) => Number(x.toFixed(1))
    const toP = (h: number) => h / HRS_POR_PERSONA

    // 2 filas de header: dia (col span 2) y abajo h/p
    const header1: (string | number)[] = ['Semana', 'Etapa']
    const header2: (string | number)[] = ['', '']
    for (const d of diasActivos) {
      header1.push(d, '')
      header2.push('h', 'personas')
    }
    header1.push('Total', '')
    header2.push('h', 'personas')
    wsData.push(header1)
    wsData.push(header2)

    for (const p of visible) {
      for (const e of ETAPAS) {
        const ed = p.hrsByEtapaByDay[e] ?? {}
        const rowTotal = diasActivos.reduce((s, d) => s + (ed[d] ?? 0), 0)
        if (rowTotal === 0) continue
        const row: (string | number)[] = [p.nombre, e]
        for (const d of diasActivos) {
          const v = ed[d] ?? 0
          row.push(v > 0 ? round1(v) : '')
          row.push(v > 0 ? round1(toP(v)) : '')
        }
        row.push(round1(rowTotal))
        row.push(round1(toP(rowTotal)))
        wsData.push(row)
      }
      // Total por plan
      const planTotalRow: (string | number)[] = [p.nombre, 'TOTAL']
      for (const d of diasActivos) {
        const colTot = ETAPAS.reduce((s, e) => s + (p.hrsByEtapaByDay[e]?.[d] ?? 0), 0)
        planTotalRow.push(colTot > 0 ? round1(colTot) : '')
        planTotalRow.push(colTot > 0 ? round1(toP(colTot)) : '')
      }
      planTotalRow.push(round1(p.totalHrs))
      planTotalRow.push(round1(toP(p.totalHrs)))
      wsData.push(planTotalRow)
    }

    if (visible.length > 1) {
      const gt: (string | number)[] = ['GRAN TOTAL', '']
      for (const d of diasActivos) {
        const v = grandTotal.byDay[d] ?? 0
        gt.push(v > 0 ? round1(v) : '')
        gt.push(v > 0 ? round1(toP(v)) : '')
      }
      gt.push(round1(grandTotal.total))
      gt.push(round1(toP(grandTotal.total)))
      wsData.push(gt)
    }

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(wsData)
    // Ancho columnas: Semana, Etapa, luego (h, p) por dia + (h, p) total
    ws['!cols'] = [
      { wch: 22 }, { wch: 8 },
      ...diasActivos.flatMap(() => [{ wch: 7 }, { wch: 8 }]),
      { wch: 9 }, { wch: 10 },
    ]
    // Merge de los headers de dia (h+personas → 2 cols)
    ws['!merges'] = [
      ...diasActivos.map((_, idx) => ({
        s: { r: 0, c: 2 + idx * 2 },
        e: { r: 0, c: 2 + idx * 2 + 1 },
      })),
      { s: { r: 0, c: 2 + diasActivos.length * 2 }, e: { r: 0, c: 2 + diasActivos.length * 2 + 1 } },
    ]
    XLSX.utils.book_append_sheet(wb, ws, 'Tabla')
    XLSX.writeFile(wb, `tabla_dia_etapa_horas_personas.xlsx`)
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
      {/* Selector de planes + toggle unidad + export */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-sm">
              <Layers className="h-4 w-4" />
              Planes a comparar
              <span className="text-xs text-muted-foreground font-normal">
                ({selected.size} / {stats.length})
              </span>
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportExcel}
                disabled={visible.length === 0 || diasActivos.length === 0}
              >
                <Download className="h-4 w-4 mr-1" />
                Excel
              </Button>
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

      {/* Tabla horizontal: cada semana = un bloque de columnas, separados por linea gruesa */}
      {visible.length === 0 || diasActivos.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            {visible.length === 0
              ? 'Selecciona al menos un plan arriba.'
              : 'Los planes seleccionados no tienen produccion.'}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="text-sm tabular-nums border-collapse">
                <thead>
                  {/* Fila 1: nombre de la semana abarcando sus columnas (dias + total) */}
                  <tr>
                    <th
                      className="text-left py-2 px-3 sticky left-0 bg-background z-10 border-r-4 border-primary/60"
                      rowSpan={2}
                    >
                      Etapa
                    </th>
                    {visible.map((p, idx) => (
                      <th
                        key={p.id}
                        colSpan={diasActivos.length + 1}
                        className={cn(
                          'text-center py-2 px-3 bg-[#1F4E79] text-white text-sm font-semibold',
                          idx < visible.length - 1 && 'border-r-4 border-primary/60',
                        )}
                      >
                        {p.nombre}
                      </th>
                    ))}
                  </tr>
                  {/* Fila 2: dias y total para cada semana */}
                  <tr className="bg-[#1F4E79]/80 text-white text-xs">
                    {visible.map((p, planIdx) =>
                      [
                        ...diasActivos.map((d, dIdx) => (
                          <th
                            key={`${p.id}-${d}`}
                            className={cn(
                              'text-center py-1.5 px-2 min-w-[72px] font-semibold',
                              dIdx === 0 && 'border-l border-white/20',
                            )}
                          >
                            {d}
                            <div className="text-[9px] font-normal opacity-70 leading-tight">h · personas</div>
                          </th>
                        )),
                        <th
                          key={`${p.id}-total`}
                          className={cn(
                            'text-center py-1.5 px-2 min-w-[80px] font-semibold border-l border-white/30 bg-[#1F4E79]',
                            planIdx < visible.length - 1 && 'border-r-4 border-primary/60',
                          )}
                        >
                          Total
                          <div className="text-[9px] font-normal opacity-70 leading-tight">h · personas</div>
                        </th>,
                      ],
                    )}
                  </tr>
                </thead>
                <tbody>
                  {/* Una fila por etapa, con datos de todas las semanas en horizontal */}
                  {ETAPAS.map((e) => {
                    // Skip etapa si ningun plan visible la tiene
                    const tieneAlgun = visible.some((p) =>
                      diasActivos.some((d) => (p.hrsByEtapaByDay[e]?.[d] ?? 0) > 0),
                    )
                    if (!tieneAlgun) return null
                    return (
                      <tr key={e} className="border-b">
                        <td
                          className="px-3 py-1 text-xs font-bold sticky left-0 bg-background border-r-4 border-primary/60"
                          style={{ color: ETAPA_COLOR[e] }}
                        >
                          {e}
                        </td>
                        {visible.map((p, planIdx) => {
                          const ed = p.hrsByEtapaByDay[e] ?? {}
                          const rowTotal = diasActivos.reduce((s, d) => s + (ed[d] ?? 0), 0)
                          return [
                            ...diasActivos.map((d, dIdx) => (
                              <td
                                key={`${p.id}-${d}`}
                                className={cn(
                                  'px-2 py-1 text-center text-xs',
                                  dIdx === 0 && 'border-l',
                                )}
                              >
                                {renderCell(ed[d] ?? 0)}
                              </td>
                            )),
                            <td
                              key={`${p.id}-total`}
                              className={cn(
                                'px-2 py-1 text-center text-xs font-medium border-l bg-muted/20',
                                planIdx < visible.length - 1 && 'border-r-4 border-primary/60',
                              )}
                            >
                              {renderCell(rowTotal)}
                            </td>,
                          ]
                        })}
                      </tr>
                    )
                  })}
                  {/* Fila TOTAL: por dia y total general por plan */}
                  <tr className="bg-muted/40 font-semibold border-t-2">
                    <td className="px-3 py-1.5 text-xs sticky left-0 bg-muted/40 border-r-4 border-primary/60">
                      TOTAL
                    </td>
                    {visible.map((p, planIdx) => {
                      return [
                        ...diasActivos.map((d, dIdx) => {
                          const colTot = ETAPAS.reduce((s, e) => s + (p.hrsByEtapaByDay[e]?.[d] ?? 0), 0)
                          return (
                            <td
                              key={`${p.id}-${d}`}
                              className={cn(
                                'px-2 py-1.5 text-center text-xs',
                                dIdx === 0 && 'border-l',
                              )}
                            >
                              {renderCell(colTot)}
                            </td>
                          )
                        }),
                        <td
                          key={`${p.id}-total`}
                          className={cn(
                            'px-2 py-1.5 text-center text-xs border-l bg-muted/60',
                            planIdx < visible.length - 1 && 'border-r-4 border-primary/60',
                          )}
                        >
                          {renderCell(p.totalHrs)}
                        </td>,
                      ]
                    })}
                  </tr>
                  {/* Fila GRAN TOTAL: solo si >1 plan, suma cross-semanas por dia */}
                  {visible.length > 1 && (
                    <tr className="bg-primary/15 font-bold border-t-4 border-primary">
                      <td className="px-3 py-2 text-xs sticky left-0 bg-primary/15 border-r-4 border-primary/60">
                        GRAN TOTAL
                      </td>
                      {visible.map((p, planIdx) => {
                        return [
                          ...diasActivos.map((d, dIdx) => (
                            // Por dia dentro de la semana — repite el total del plan para ese dia
                            <td
                              key={`${p.id}-${d}`}
                              className={cn(
                                'px-2 py-2 text-center text-[10px] text-muted-foreground italic',
                                dIdx === 0 && 'border-l',
                              )}
                            >
                              —
                            </td>
                          )),
                          <td
                            key={`${p.id}-total`}
                            className={cn(
                              'px-2 py-2 text-center text-xs border-l',
                              planIdx < visible.length - 1 && 'border-r-4 border-primary/60',
                            )}
                          >
                            {renderCell(p.totalHrs)}
                          </td>,
                        ]
                      })}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {visible.length > 1 && (
              <div className="px-4 py-2 border-t bg-muted/20 text-xs text-muted-foreground text-right">
                Suma de las {visible.length} semanas seleccionadas:{' '}
                <span className="font-semibold text-foreground">{grandTotal.total.toFixed(1)} h</span>
                {' · '}
                <span className="font-semibold text-foreground">{(grandTotal.total / HRS_POR_PERSONA).toFixed(1)} personas</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
