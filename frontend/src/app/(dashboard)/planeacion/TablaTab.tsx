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

  // Total general (con y sin maquila)
  const grandTotal = useMemo(() => {
    let total = 0
    let totalSinMaq = 0
    const byDay: Record<string, number> = {}
    for (const p of visible) {
      total += p.totalHrs
      for (const e of ETAPAS) {
        const ed = p.hrsByEtapaByDay[e]
        const sumEtapa = (Object.values(ed ?? {}) as number[]).reduce((a, b) => a + b, 0)
        if (e !== 'MAQ') totalSinMaq += sumEtapa
        for (const d of diasActivos) {
          byDay[d] = (byDay[d] ?? 0) + (ed?.[d] ?? 0)
        }
      }
    }
    return { total, totalSinMaq, byDay }
  }, [visible, diasActivos])

  const handleExportExcel = async () => {
    const XLSX = await import('xlsx-js-style')
    const round1 = (x: number) => Number(x.toFixed(1))
    const toP = (h: number) => h / HRS_POR_PERSONA
    // Cada semana ocupa: (dias × 2 cols h+p) + (Total × 2 cols h+p)
    const colsPerWeek = diasActivos.length * 2 + 2
    const wsData: (string | number | null)[][] = []

    // Row 0: 'Etapa' (merge vertical) + nombre semana
    const row0: (string | number)[] = ['Etapa']
    for (const p of visible) {
      row0.push(p.nombre)
      for (let j = 1; j < colsPerWeek; j++) row0.push('')
    }
    wsData.push(row0)

    // Row 1: '' + dias + Total
    const row1: (string | number)[] = ['']
    for (let _i = 0; _i < visible.length; _i++) {
      for (const d of diasActivos) row1.push(d, '')
      row1.push('Total', '')
    }
    wsData.push(row1)

    // Row 2: '' + (h, personas)
    const row2: (string | number)[] = ['']
    for (let _i = 0; _i < visible.length; _i++) {
      for (let _j = 0; _j < diasActivos.length; _j++) row2.push('h', 'personas')
      row2.push('h', 'personas')
    }
    wsData.push(row2)

    // Body: una fila por etapa
    const etapasConDatos = ETAPAS.filter((e) =>
      visible.some((p) => diasActivos.some((d) => (p.hrsByEtapaByDay[e]?.[d] ?? 0) > 0)),
    )
    for (const e of etapasConDatos) {
      const row: (string | number)[] = [ETAPA_LABEL_SHORT[e]]
      for (const p of visible) {
        const ed = p.hrsByEtapaByDay[e] ?? {}
        const rowTotal = diasActivos.reduce((s, d) => s + (ed[d] ?? 0), 0)
        for (const d of diasActivos) {
          const v = ed[d] ?? 0
          row.push(v > 0 ? round1(v) : '')
          row.push(v > 0 ? round1(toP(v)) : '')
        }
        row.push(rowTotal > 0 ? round1(rowTotal) : '')
        row.push(rowTotal > 0 ? round1(toP(rowTotal)) : '')
      }
      wsData.push(row)
    }

    // TOTAL
    const totalRow: (string | number)[] = ['TOTAL']
    for (const p of visible) {
      for (const d of diasActivos) {
        const colTot = ETAPAS.reduce((s, e) => s + (p.hrsByEtapaByDay[e]?.[d] ?? 0), 0)
        totalRow.push(colTot > 0 ? round1(colTot) : '')
        totalRow.push(colTot > 0 ? round1(toP(colTot)) : '')
      }
      totalRow.push(round1(p.totalHrs))
      totalRow.push(round1(toP(p.totalHrs)))
    }
    wsData.push(totalRow)

    // TOTAL S/MAQ
    const etapasInternas = ETAPAS.filter((e) => e !== 'MAQ')
    const totalSinMaqRow: (string | number)[] = ['TOTAL S/MAQ']
    for (const p of visible) {
      const planTotalSinMaq = etapasInternas.reduce(
        (s, e) => s + (Object.values(p.hrsByEtapaByDay[e] ?? {}) as number[]).reduce((a, b) => a + b, 0),
        0,
      )
      for (const d of diasActivos) {
        const colTot = etapasInternas.reduce((s, e) => s + (p.hrsByEtapaByDay[e]?.[d] ?? 0), 0)
        totalSinMaqRow.push(colTot > 0 ? round1(colTot) : '')
        totalSinMaqRow.push(colTot > 0 ? round1(toP(colTot)) : '')
      }
      totalSinMaqRow.push(round1(planTotalSinMaq))
      totalSinMaqRow.push(round1(toP(planTotalSinMaq)))
    }
    wsData.push(totalSinMaqRow)

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(wsData)

    // Anchos: Etapa, luego por cada semana (h+p por dia + h+p total)
    const cols: { wch: number }[] = [{ wch: 30 }]
    for (let _i = 0; _i < visible.length; _i++) {
      for (let _j = 0; _j < diasActivos.length; _j++) cols.push({ wch: 7 }, { wch: 9 })
      cols.push({ wch: 9 }, { wch: 10 })
    }
    ws['!cols'] = cols

    // Alturas de filas para los headers
    ws['!rows'] = [
      { hpx: 26 }, // row 0 - week name
      { hpx: 22 }, // row 1 - day/total
      { hpx: 18 }, // row 2 - h/personas
    ]

    // Helper: ultima columna de la semana i (Total personas)
    const weekLastCol = (i: number) => 1 + (i + 1) * colsPerWeek - 1

    // Merges
    const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = []
    merges.push({ s: { r: 0, c: 0 }, e: { r: 2, c: 0 } })
    for (let i = 0; i < visible.length; i++) {
      const start = 1 + i * colsPerWeek
      merges.push({ s: { r: 0, c: start }, e: { r: 0, c: start + colsPerWeek - 1 } })
      for (let j = 0; j < diasActivos.length; j++) {
        const dayStart = start + j * 2
        merges.push({ s: { r: 1, c: dayStart }, e: { r: 1, c: dayStart + 1 } })
      }
      const totalStart = start + diasActivos.length * 2
      merges.push({ s: { r: 1, c: totalStart }, e: { r: 1, c: totalStart + 1 } })
    }
    ws['!merges'] = merges

    // ---- Estilos ----
    // Paleta sin '#'
    const ETAPA_HEX: Record<Etapa, string> = {
      MAQ: 'F43F5E', PREL: 'FBBF24', ROBOT: '10B981', POST: 'EC4899', 'N/A': '60A5FA',
    }
    const HEADER_BG = '1F4E79'
    const SUBHEADER_BG = 'D9D9D9'
    const TOTAL_BG = 'E7E6E6'
    const BORDER = '808080'
    const BORDER_THICK = '1F4E79'

    type BorderEdge = { style: string; color: { rgb: string } }
    const thin: BorderEdge = { style: 'thin', color: { rgb: BORDER } }
    const mediumBlue: BorderEdge = { style: 'medium', color: { rgb: BORDER_THICK } }
    // Linea negra gruesa que separa semanas (no es celda, es border)
    const separator: BorderEdge = { style: 'thick', color: { rgb: '000000' } }

    const numRows = wsData.length
    const numCols = wsData[0].length

    // Cols que son ULTIMA de una semana (excepto la ultima) → borde derecho grueso negro
    // Cols que son PRIMERA de una semana (excepto la primera) → borde izquierdo grueso negro
    const rightEdgeCols = new Set<number>()
    const leftEdgeCols = new Set<number>()
    for (let i = 0; i < visible.length - 1; i++) {
      rightEdgeCols.add(weekLastCol(i))
      leftEdgeCols.add(weekLastCol(i) + 1)
    }

    const numHeaderRows = 3
    const totalRowIdx = numHeaderRows + etapasConDatos.length
    const totalSinMaqRowIdx = totalRowIdx + 1

    const computeBorder = (rTop: BorderEdge, rBottom: BorderEdge, c: number) => ({
      top: rTop,
      bottom: rBottom,
      left: leftEdgeCols.has(c) ? separator : thin,
      right: rightEdgeCols.has(c) ? separator : thin,
    })

    for (let r = 0; r < numRows; r++) {
      for (let c = 0; c < numCols; c++) {
        const addr = XLSX.utils.encode_cell({ r, c })
        if (!ws[addr]) ws[addr] = { t: 's', v: '' }

        // Header rows 0-1: bg azul oscuro, texto blanco bold
        if (r === 0 || r === 1) {
          ws[addr].s = {
            font: { name: 'Calibri', sz: r === 0 ? 12 : 10, bold: true, color: { rgb: 'FFFFFF' } },
            fill: { patternType: 'solid', fgColor: { rgb: HEADER_BG } },
            alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
            border: computeBorder(thin, thin, c),
          }
          continue
        }
        // Sub-header row 2: bg gris claro, italic
        if (r === 2) {
          ws[addr].s = {
            font: { name: 'Calibri', sz: 9, italic: true, color: { rgb: '4A4A4A' } },
            fill: { patternType: 'solid', fgColor: { rgb: SUBHEADER_BG } },
            alignment: { horizontal: 'center', vertical: 'center' },
            border: computeBorder(thin, thin, c),
          }
          continue
        }
        // Etapa rows (body)
        if (r >= numHeaderRows && r < totalRowIdx) {
          const etapaIdx = r - numHeaderRows
          const etapa = etapasConDatos[etapaIdx]
          if (c === 0) {
            ws[addr].s = {
              font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
              fill: { patternType: 'solid', fgColor: { rgb: ETAPA_HEX[etapa] } },
              alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
              border: computeBorder(thin, thin, c),
            }
          } else {
            ws[addr].s = {
              font: { name: 'Calibri', sz: 10, color: { rgb: '1F1F1F' } },
              alignment: { horizontal: 'center', vertical: 'center' },
              border: computeBorder(thin, thin, c),
            }
          }
          continue
        }
        // TOTAL row
        if (r === totalRowIdx) {
          ws[addr].s = {
            font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: '1F1F1F' } },
            fill: { patternType: 'solid', fgColor: { rgb: TOTAL_BG } },
            alignment: { horizontal: c === 0 ? 'left' : 'center', vertical: 'center', indent: c === 0 ? 1 : 0 },
            border: computeBorder(mediumBlue, thin, c),
          }
          continue
        }
        // TOTAL S/MAQ row
        if (r === totalSinMaqRowIdx) {
          ws[addr].s = {
            font: { name: 'Calibri', sz: 11, bold: true, italic: true, color: { rgb: '1F1F1F' } },
            fill: { patternType: 'solid', fgColor: { rgb: TOTAL_BG } },
            alignment: { horizontal: c === 0 ? 'left' : 'center', vertical: 'center', indent: c === 0 ? 1 : 0 },
            border: computeBorder(thin, thin, c),
          }
          continue
        }
      }
    }

    // Freeze panes: primera columna y header rows
    ws['!freeze'] = { xSplit: 1, ySplit: numHeaderRows }

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
                          className="px-3 py-1 text-xs font-bold sticky left-0 bg-background border-r-4 border-primary/60 whitespace-nowrap"
                          style={{ color: ETAPA_COLOR[e] }}
                          title={ETAPA_LABEL[e]}
                        >
                          {ETAPA_LABEL_SHORT[e]}
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
                  {/* Fila TOTAL S/MAQ: misma logica pero excluyendo MAQ */}
                  <tr className="bg-muted/30 font-semibold border-t">
                    <td
                      className="px-3 py-1.5 text-xs sticky left-0 bg-muted/30 border-r-4 border-primary/60 whitespace-nowrap"
                      title="Total sin Maquila — solo lo que se hace en planta"
                    >
                      TOTAL S/MAQ
                    </td>
                    {visible.map((p, planIdx) => {
                      const etapasInternas = ETAPAS.filter((e) => e !== 'MAQ')
                      const planTotalSinMaq = etapasInternas.reduce(
                        (s, e) => s + (Object.values(p.hrsByEtapaByDay[e] ?? {}) as number[]).reduce((a, b) => a + b, 0),
                        0,
                      )
                      return [
                        ...diasActivos.map((d, dIdx) => {
                          const colTot = etapasInternas.reduce((s, e) => s + (p.hrsByEtapaByDay[e]?.[d] ?? 0), 0)
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
                            'px-2 py-1.5 text-center text-xs border-l bg-muted/50',
                            planIdx < visible.length - 1 && 'border-r-4 border-primary/60',
                          )}
                        >
                          {renderCell(planTotalSinMaq)}
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
              <div className="px-4 py-2 border-t bg-muted/20 text-xs text-muted-foreground space-y-0.5 text-right">
                <div>
                  Suma de las {visible.length} semanas seleccionadas:{' '}
                  <span className="font-semibold text-foreground">{grandTotal.total.toFixed(1)} h</span>
                  {' · '}
                  <span className="font-semibold text-foreground">{(grandTotal.total / HRS_POR_PERSONA).toFixed(1)} personas</span>
                </div>
                <div>
                  Sin Maquila:{' '}
                  <span className="font-semibold text-foreground">{grandTotal.totalSinMaq.toFixed(1)} h</span>
                  {' · '}
                  <span className="font-semibold text-foreground">{(grandTotal.totalSinMaq / HRS_POR_PERSONA).toFixed(1)} personas</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
