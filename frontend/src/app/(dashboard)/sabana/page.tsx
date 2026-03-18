'use client'

import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { useAppStore } from '@/lib/store/useAppStore'
import { supabase } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { STAGE_COLORS, BLOCK_LABELS, DAY_ORDER } from '@/types'
import { useCatalogoImages, getModeloImageUrl } from '@/lib/hooks/useCatalogoImages'
import { Eye, EyeOff, FileSpreadsheet, FileText, Braces, Download, Check, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'
import { exportSabanaPDF, exportSabanaExcel } from '@/lib/export'
import type { SabanaDayData, SabanaExcelModelGroup } from '@/lib/export'

function getEtapaColor(etapa: string, inputProceso?: string): string {
  // Usar input_o_proceso como fuente primaria (mapea directo a STAGE_COLORS)
  if (inputProceso) {
    if (inputProceso.includes('N/A')) return STAGE_COLORS['N/A PRELIMINAR']
    if (inputProceso.includes('PRELIMINAR')) return STAGE_COLORS.PRELIMINAR
    if (inputProceso.includes('ROBOT')) return STAGE_COLORS.ROBOT
    if (inputProceso.includes('POST')) return STAGE_COLORS.POST
    if (inputProceso.includes('MAQUILA')) return STAGE_COLORS.MAQUILA
  }
  // Fallback a etapa con matching ampliado
  if (!etapa) return '#94A3B8'
  if (etapa.includes('N/A PRELIMINAR')) return STAGE_COLORS['N/A PRELIMINAR']
  if (etapa.includes('PRELIMINAR') || etapa.includes('PRE') || etapa === 'MESA') return STAGE_COLORS.PRELIMINAR
  if (etapa.includes('ROBOT')) return STAGE_COLORS.ROBOT
  if (etapa.includes('POST') || etapa.includes('ZIGZAG')) return STAGE_COLORS.POST
  if (etapa.includes('MAQUILA')) return STAGE_COLORS.MAQUILA
  return '#94A3B8'
}

const DAY_COLOR: Record<string, string> = {
  Lun: '#3b82f6', Mar: '#8b5cf6', Mie: '#06b6d4', Jue: '#f59e0b', Vie: '#10b981', Sab: '#ef4444',
}
const DAY_RGB: Record<string, [number, number, number]> = {
  Lun: [59, 130, 246], Mar: [139, 92, 246], Mie: [6, 182, 212], Jue: [245, 158, 11], Vie: [16, 185, 129], Sab: [239, 68, 68],
}

interface DayCell {
  blocks: number[]
  total: number
  operario: string
  etapa: string
  isSinAsignar: boolean
  adelanto?: boolean
}

interface OpRow {
  modelo: string
  fraccion: number
  operacion: string
  recurso: string
  etapa: string
  input_o_proceso: string
  imgUrl: string | null
  days: Record<string, DayCell>
  weekTotal: number
}

export default function SabanaPage() {
  const result = useAppStore((s) => s.currentResult)
  const [jsonCopied, setJsonCopied] = useState(false)
  const catImages = useCatalogoImages()
  const [showOperario, setShowOperario] = useState(false)
  const [showDeficit, setShowDeficit] = useState(false)
  const [inputProcesoMap, setInputProcesoMap] = useState<Map<string, string>>(new Map())

  // Load input_o_proceso from catalog for block coloring
  useEffect(() => {
    if (!result?.daily_results) { setInputProcesoMap(new Map()); return }
    const modelNums = new Set<string>()
    for (const dayData of Object.values(result.daily_results)) {
      for (const s of dayData.schedule || []) modelNums.add(s.modelo.split(' ')[0])
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

  const dayNames = useMemo(() => {
    if (!result?.daily_results) return []
    const keys = Object.keys(result.daily_results)
    return DAY_ORDER.filter((d) => keys.includes(d))
  }, [result])

  const numBlocks = useMemo(() => {
    if (!result?.daily_results) return 10
    let max = 0
    for (const d of dayNames) {
      const sched = result.daily_results[d]?.schedule || []
      for (const s of sched) max = Math.max(max, s.blocks?.length || 0)
    }
    return max || 10
  }, [result, dayNames])

  const blockLabels = useMemo(() => BLOCK_LABELS.slice(0, numBlocks), [numBlocks])

  const { modelGroups, modelWeeklyTotals } = useMemo(() => {
    if (!result?.daily_results) return { modelGroups: [] as { modelo: string; imgUrl: string | null; rows: OpRow[] }[], modelWeeklyTotals: new Map<string, Map<string, number>>() }

    const makeKey = (modelo: string, fraccion: number, operacion: string, recurso: string) =>
      `${modelo}||${fraccion}||${operacion}||${recurso}`

    const modelOrder: string[] = []
    const byModel = new Map<string, Map<string, OpRow>>()

    for (const day of dayNames) {
      const sched = result.daily_results![day]?.schedule || []
      for (const s of sched) {
        const modelo = s.modelo
        const recurso = s.robot || s.recurso
        const key = makeKey(modelo, s.fraccion, s.operacion, recurso)

        if (!byModel.has(modelo)) {
          modelOrder.push(modelo)
          byModel.set(modelo, new Map())
        }
        const opMap = byModel.get(modelo)!

        if (!opMap.has(key)) {
          const [num, ...cp] = modelo.split(' ')
          const imgUrl = getModeloImageUrl(catImages, num, cp.join(' '))
          opMap.set(key, {
            modelo, fraccion: s.fraccion, operacion: s.operacion, recurso,
            etapa: s.etapa || '',
            input_o_proceso: inputProcesoMap.get(`${modelo.split(' ')[0]}|${s.fraccion}`) || s.input_o_proceso || '',
            imgUrl, days: {}, weekTotal: 0,
          })
        }

        const opRow = opMap.get(key)!
        const blocks = s.blocks || []

        if (opRow.days[day]) {
          const existing = opRow.days[day]
          for (let bi = 0; bi < numBlocks; bi++) {
            existing.blocks[bi] = (existing.blocks[bi] || 0) + (blocks[bi] || 0)
          }
          existing.total += s.total
          if (s.operario === 'SIN ASIGNAR') existing.isSinAsignar = true
          if (!existing.operario && s.operario) existing.operario = s.operario
        } else {
          opRow.days[day] = {
            blocks: Array.from({ length: numBlocks }, (_, bi) => blocks[bi] || 0),
            total: s.total, operario: s.operario || '', etapa: s.etapa || '',
            isSinAsignar: s.operario === 'SIN ASIGNAR', adelanto: s.adelanto,
          }
        }
      }
    }

    const groups = modelOrder.map((modelo) => {
      const opMap = byModel.get(modelo)!
      const rows = Array.from(opMap.values())
      for (const row of rows) {
        row.weekTotal = Object.values(row.days).reduce((sum, d) => sum + d.total, 0)
      }
      rows.sort((a, b) => a.fraccion - b.fraccion || a.operacion.localeCompare(b.operacion))
      const [num, ...cp] = modelo.split(' ')
      const imgUrl = getModeloImageUrl(catImages, num, cp.join(' '))
      return { modelo, imgUrl, rows }
    })

    const totals = new Map<string, Map<string, number>>()
    if (result.weekly_schedule) {
      for (const e of result.weekly_schedule) {
        if (!totals.has(e.Modelo)) totals.set(e.Modelo, new Map())
        totals.get(e.Modelo)!.set(e.Dia, (totals.get(e.Modelo)!.get(e.Dia) || 0) + e.Pares)
      }
    }

    return { modelGroups: groups, modelWeeklyTotals: totals }
  }, [result, dayNames, catImages, numBlocks, inputProcesoMap])

  // ── Deficit: weekly planned vs daily actual ──
  const deficitData = useMemo(() => {
    if (!result?.weekly_schedule || !result?.daily_results) return { models: [] as { modelo: string; imgUrl: string | null; planned: number; actual: number; deficit: number; byDay: Record<string, { planned: number; actual: number }> }[], totalPlanned: 0, totalActual: 0 }

    // Weekly planned per model per day
    const weeklyByModel = new Map<string, Map<string, number>>()
    for (const e of result.weekly_schedule) {
      if (!weeklyByModel.has(e.Modelo)) weeklyByModel.set(e.Modelo, new Map())
      weeklyByModel.get(e.Modelo)!.set(e.Dia, (weeklyByModel.get(e.Modelo)!.get(e.Dia) || 0) + e.Pares)
    }

    // Daily actual per model per day: use first operation (lowest fraccion) total
    const dailyByModel = new Map<string, Map<string, number>>()
    for (const { modelo, rows } of modelGroups) {
      const dayMap = new Map<string, number>()
      if (rows.length > 0) {
        const firstOp = rows[0] // lowest fraccion (already sorted)
        for (const [d, cell] of Object.entries(firstOp.days)) {
          if (cell.total > 0) dayMap.set(d, cell.total)
        }
      }
      dailyByModel.set(modelo, dayMap)
    }

    let totalPlanned = 0
    let totalActual = 0
    const models: { modelo: string; imgUrl: string | null; planned: number; actual: number; deficit: number; byDay: Record<string, { planned: number; actual: number }> }[] = []

    for (const [modelo, dayMap] of weeklyByModel) {
      const planned = Array.from(dayMap.values()).reduce((a, b) => a + b, 0)
      const actualDayMap = dailyByModel.get(modelo)
      const actual = actualDayMap ? Array.from(actualDayMap.values()).reduce((a, b) => a + b, 0) : 0
      const deficit = planned - actual
      totalPlanned += planned
      totalActual += actual

      const byDay: Record<string, { planned: number; actual: number }> = {}
      for (const d of dayNames) {
        const p = dayMap.get(d) || 0
        const a = actualDayMap?.get(d) || 0
        if (p > 0 || a > 0) byDay[d] = { planned: p, actual: a }
      }

      const [num, ...cp] = modelo.split(' ')
      const imgUrl = getModeloImageUrl(catImages, num, cp.join(' '))
      models.push({ modelo, imgUrl, planned, actual, deficit, byDay })
    }

    models.sort((a, b) => b.deficit - a.deficit)
    return { models, totalPlanned, totalActual }
  }, [result, modelGroups, dayNames, catImages])

  // ── Export: Excel (styled with colors) ──
  const handleExcel = useCallback(() => {
    const excelGroups: SabanaExcelModelGroup[] = modelGroups.map(({ modelo, rows }) => {
      const dayTotals: Record<string, number> = {}
      const dt = modelWeeklyTotals.get(modelo)
      if (dt) for (const [d, p] of dt) dayTotals[d] = p
      const weekTotal = Object.values(dayTotals).reduce((a, b) => a + b, 0)
      return {
        modelo,
        dayTotals,
        weekTotal,
        rows: rows.map((r) => ({
          modelo: r.modelo,
          fraccion: r.fraccion,
          operacion: r.operacion,
          recurso: r.recurso,
          etapa: r.input_o_proceso || r.etapa,
          days: Object.fromEntries(dayNames.map((d) => {
            const cell = r.days[d]
            if (!cell || cell.total === 0) return [d, null]
            return [d, { blocks: cell.blocks, total: cell.total, operario: cell.operario, isSinAsignar: cell.isSinAsignar, adelanto: cell.adelanto }]
          })),
          weekTotal: r.weekTotal,
        })),
      }
    })
    exportSabanaExcel(`sabana_${result?.nombre || 'semanal'}`, dayNames, blockLabels as string[], excelGroups, showOperario)
  }, [modelGroups, modelWeeklyTotals, dayNames, blockLabels, showOperario, result])

  // ── Export: JSON (structured, per model with day detail) ──
  const handleJSON = useCallback(() => {
    const data = modelGroups.map(({ modelo, rows }) => ({
      modelo,
      weekTotal: rows.reduce((s, r) => s + r.weekTotal, 0),
      operaciones: rows.map((r) => ({
        fraccion: r.fraccion,
        operacion: r.operacion,
        recurso: r.recurso,
        etapa: r.etapa,
        weekTotal: r.weekTotal,
        dias: Object.fromEntries(
          dayNames.map((d) => {
            const cell = r.days[d]
            if (!cell || cell.total === 0) return [d, null]
            return [d, {
              bloques: Object.fromEntries(blockLabels.map((bl, bi) => [bl, cell.blocks[bi] || 0]).filter(([, v]) => Number(v) > 0)),
              total: cell.total,
              operario: cell.operario || null,
              sinAsignar: cell.isSinAsignar,
              adelanto: cell.adelanto || false,
            }]
          }).filter(([, v]) => v !== null)
        ),
      })),
    }))
    navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => {
      setJsonCopied(true)
      setTimeout(() => setJsonCopied(false), 2000)
    })
  }, [modelGroups, dayNames, blockLabels])

  // ── Export: PDF (one page per day with block columns) ──
  const handlePDF = useCallback(() => {
    const dayPages: SabanaDayData[] = dayNames.map((d) => {
      const headers = ['F', 'OPERACION', 'REC', ...blockLabels as string[], 'TOT']
      if (showOperario) headers.push('OP')
      const rows: (string | number)[][] = []
      const etapas: string[] = []
      const modelHeaders: { rowIdx: number; modelo: string; total: string }[] = []

      for (const { modelo, rows: opRows } of modelGroups) {
        const dayTot = modelWeeklyTotals.get(modelo)?.get(d) || 0
        if (!opRows.some((r) => r.days[d] && r.days[d].total > 0)) continue

        // Model header row
        modelHeaders.push({ rowIdx: rows.length, modelo, total: `${dayTot}p` })
        const mRow: (string | number)[] = [modelo, '', '']
        for (let i = 0; i < numBlocks; i++) mRow.push('')
        mRow.push(dayTot)
        if (showOperario) mRow.push('')
        rows.push(mRow)
        etapas.push('')

        // Operation rows for this day
        for (const r of opRows) {
          const cell = r.days[d]
          if (!cell || cell.total === 0) continue
          const row: (string | number)[] = [r.fraccion, r.operacion, r.recurso]
          for (let bi = 0; bi < numBlocks; bi++) {
            const v = cell.blocks[bi] || 0
            row.push(v > 0 ? v : '')
          }
          row.push(cell.total)
          if (showOperario) row.push(cell.isSinAsignar ? 'SIN ASIGNAR' : cell.operario || '-')
          rows.push(row)
          etapas.push(r.input_o_proceso || r.etapa)
        }
      }

      return { day: d, dayColor: DAY_RGB[d] || [100, 100, 100], headers, rows, etapas, modelHeaders }
    })

    exportSabanaPDF(`sabana_${result?.nombre || 'semanal'}`, dayPages)
  }, [dayNames, modelGroups, modelWeeklyTotals, blockLabels, numBlocks, showOperario, result])

  // Drag-to-scroll
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragState = useRef({ active: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 })

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const el = scrollRef.current
    if (!el) return
    dragState.current = { active: true, startX: e.pageX, startY: e.pageY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop }
    el.style.cursor = 'grabbing'
    el.style.userSelect = 'none'
  }, [])
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const ds = dragState.current
    if (!ds.active) return
    const el = scrollRef.current
    if (!el) return
    el.scrollLeft = ds.scrollLeft - (e.pageX - ds.startX)
    el.scrollTop = ds.scrollTop - (e.pageY - ds.startY)
  }, [])
  const onMouseUp = useCallback(() => {
    dragState.current.active = false
    const el = scrollRef.current
    if (el) { el.style.cursor = 'grab'; el.style.userSelect = '' }
  }, [])

  if (!result) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Ejecuta una optimizacion para ver la sabana semanal.
      </div>
    )
  }

  const daySummaries = dayNames.map((d) => {
    const dd = result.daily_results?.[d]
    return { day: d, pares: dd?.total_pares || 0, status: dd?.status || '?', sinOp: (dd?.unassigned_ops || []).length }
  })

  const colsPerDay = numBlocks + 1 + (showOperario ? 1 : 0)
  const fixedCols = 3
  const totalCols = fixedCols + dayNames.length * colsPerDay + 1

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Sabana Semanal</h1>
          <p className="text-sm text-muted-foreground">{result.nombre}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Toggle operario */}
          <Button
            variant={showOperario ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setShowOperario((v) => !v)}
          >
            {showOperario ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            Operario
          </Button>

          {/* Export buttons */}
          <div className="flex items-center gap-1 rounded-md border px-1 py-0.5">
            <Download className="h-3.5 w-3.5 text-muted-foreground mr-0.5" />
            <button
              onClick={handleExcel}
              className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
              title="Descargar Excel con todos los bloques"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Excel
            </button>
            <button
              onClick={handlePDF}
              className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
              title="Descargar PDF (una pagina por dia)"
            >
              <FileText className="h-3.5 w-3.5" />
              PDF
            </button>
            <button
              onClick={handleJSON}
              className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
              title="Copiar JSON al portapapeles"
            >
              {jsonCopied ? <Check className="h-3.5 w-3.5" /> : <Braces className="h-3.5 w-3.5" />}
              {jsonCopied ? 'Copiado' : 'JSON'}
            </button>
          </div>

          {/* Legend */}
          <div className="flex gap-2 flex-wrap">
            {Object.entries(STAGE_COLORS).map(([name, color]) => (
              <div key={name} className="flex items-center gap-1">
                <div className="h-2.5 w-2.5 rounded border" style={{ backgroundColor: name === 'N/A PRELIMINAR' ? '#fff' : color }} />
                <span className="text-[10px]">{name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Day summary strip */}
      <div className="flex gap-2 flex-wrap">
        {daySummaries.map((ds) => (
          <div key={ds.day} className="flex items-center gap-1.5 rounded border px-2 py-1" style={{ borderColor: `${DAY_COLOR[ds.day]}40` }}>
            <span className="text-xs font-bold" style={{ color: DAY_COLOR[ds.day] }}>{ds.day}</span>
            <span className="text-xs font-mono">{ds.pares.toLocaleString()}p</span>
            <span className={`text-[9px] font-bold ${ds.status === 'OPTIMAL' || ds.status === 'FEASIBLE' ? 'text-emerald-500' : ds.status === 'INFEASIBLE' ? 'text-destructive' : 'text-amber-500'}`}>
              {ds.status}
            </span>
            {ds.sinOp > 0 && <span className="text-[9px] font-bold text-red-500">{ds.sinOp} sin op.</span>}
          </div>
        ))}
      </div>

      {/* Deficit section */}
      {deficitData.totalPlanned > deficitData.totalActual && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5">
          <button
            onClick={() => setShowDeficit((v) => !v)}
            className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-amber-500/10 transition-colors rounded-lg"
          >
            {showDeficit ? <ChevronDown className="h-4 w-4 text-amber-500" /> : <ChevronRight className="h-4 w-4 text-amber-500" />}
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-semibold text-amber-500">
              Deficit Semanal: {(deficitData.totalPlanned - deficitData.totalActual).toLocaleString()}p sin completar
            </span>
            <span className="text-xs text-muted-foreground ml-2">
              ({deficitData.totalActual.toLocaleString()} de {deficitData.totalPlanned.toLocaleString()} planificados)
            </span>
          </button>
          {showDeficit && (
            <div className="px-3 pb-3">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border/40">
                    <th className="text-left py-1 px-2 font-medium">Modelo</th>
                    <th className="text-right py-1 px-1 font-medium">Semanal</th>
                    <th className="text-right py-1 px-1 font-medium">Diario</th>
                    <th className="text-right py-1 px-1 font-medium text-amber-500">Deficit</th>
                    {dayNames.map((d) => (
                      <th key={d} className="text-center py-1 px-1 font-medium text-[10px]" style={{ color: DAY_COLOR[d] }}>{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {deficitData.models.map(({ modelo, imgUrl, planned, actual, deficit, byDay }) => (
                    <tr key={modelo} className={`border-b border-border/20 ${deficit > 0 ? '' : 'opacity-50'}`}>
                      <td className="py-1 px-2">
                        <div className="flex items-center gap-1.5">
                          {imgUrl && <img src={imgUrl} alt="" className="h-4 w-auto rounded border object-contain bg-white shrink-0" />}
                          <span className="font-medium">{modelo}</span>
                        </div>
                      </td>
                      <td className="text-right py-1 px-1 font-mono">{planned.toLocaleString()}</td>
                      <td className="text-right py-1 px-1 font-mono">{actual.toLocaleString()}</td>
                      <td className={`text-right py-1 px-1 font-mono font-bold ${deficit > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                        {deficit > 0 ? `-${deficit.toLocaleString()}` : deficit === 0 ? '0' : `+${Math.abs(deficit).toLocaleString()}`}
                      </td>
                      {dayNames.map((d) => {
                        const dd = byDay[d]
                        if (!dd) return <td key={d} className="text-center py-1 px-1 text-[10px] text-muted-foreground">-</td>
                        const dayDef = dd.planned - dd.actual
                        return (
                          <td key={d} className="text-center py-1 px-1 text-[10px] font-mono">
                            {dayDef > 0 ? (
                              <span className="text-amber-500">-{dayDef}</span>
                            ) : dayDef < 0 ? (
                              <span className="text-emerald-500">+{Math.abs(dayDef)}</span>
                            ) : (
                              <span className="text-muted-foreground">{dd.planned > 0 ? '0' : '-'}</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border/40 font-bold">
                    <td className="py-1 px-2">TOTAL</td>
                    <td className="text-right py-1 px-1 font-mono">{deficitData.totalPlanned.toLocaleString()}</td>
                    <td className="text-right py-1 px-1 font-mono">{deficitData.totalActual.toLocaleString()}</td>
                    <td className="text-right py-1 px-1 font-mono text-amber-500">
                      -{(deficitData.totalPlanned - deficitData.totalActual).toLocaleString()}
                    </td>
                    {dayNames.map((d) => {
                      const dayPlanned = deficitData.models.reduce((s, m) => s + (m.byDay[d]?.planned || 0), 0)
                      const dayActual = deficitData.models.reduce((s, m) => s + (m.byDay[d]?.actual || 0), 0)
                      const dayDef = dayPlanned - dayActual
                      return (
                        <td key={d} className="text-center py-1 px-1 text-[10px] font-mono">
                          {dayDef > 0 ? <span className="text-amber-500">-{dayDef}</span> : dayDef < 0 ? <span className="text-emerald-500">+{Math.abs(dayDef)}</span> : <span>0</span>}
                        </td>
                      )
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Horizontal pivot table with block detail */}
      <div
        ref={scrollRef}
        className="overflow-auto cursor-grab rounded-lg border bg-card"
        style={{ maxHeight: 'calc(100vh - 180px)' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <table className="text-[10px] border-collapse" style={{ minWidth: totalCols * 32 }}>
          <thead className="sticky top-0 bg-card z-10">
            <tr className="border-b">
              <th colSpan={fixedCols} className="px-1 py-1 text-left font-medium border-r-2 border-border/40" />
              {dayNames.map((d) => (
                <th
                  key={d}
                  colSpan={colsPerDay}
                  className="px-0 py-1 text-center font-bold text-[11px] border-r-2 border-border/40"
                  style={{ color: DAY_COLOR[d], backgroundColor: `${DAY_COLOR[d]}10` }}
                >
                  {d}
                </th>
              ))}
              <th className="px-1 py-1 text-center font-bold text-[11px]">SEM</th>
            </tr>
            <tr className="border-b-2">
              <th className="px-1 py-0.5 text-left font-medium text-[8px]" style={{ minWidth: 18 }}>F</th>
              <th className="px-1 py-0.5 text-left font-medium text-[8px]" style={{ minWidth: 90 }}>OPERACION</th>
              <th className="px-1 py-0.5 text-left font-medium text-[8px] border-r-2 border-border/40" style={{ minWidth: 45 }}>REC</th>
              {dayNames.map((d) => (
                <React.Fragment key={d}>
                  {blockLabels.map((bl) => (
                    <th key={`${d}-${bl}`} className="px-0 py-0.5 text-center font-medium text-[7px] w-7" style={{ color: `${DAY_COLOR[d]}90` }}>
                      {bl}
                    </th>
                  ))}
                  <th className={`px-0 py-0.5 text-center font-bold text-[8px] ${showOperario ? '' : 'border-r-2 border-border/40'}`} style={{ color: DAY_COLOR[d], minWidth: 30 }}>
                    TOT
                  </th>
                  {showOperario && (
                    <th className="px-0 py-0.5 text-center font-medium text-[7px] border-r-2 border-border/40" style={{ color: `${DAY_COLOR[d]}90`, minWidth: 55 }}>
                      OP
                    </th>
                  )}
                </React.Fragment>
              ))}
              <th className="px-1 py-0.5 text-center font-bold text-[8px]" style={{ minWidth: 30 }}>TOT</th>
            </tr>
          </thead>
          <tbody>
            {modelGroups.map(({ modelo, imgUrl, rows }) => {
              const dayTotals = modelWeeklyTotals.get(modelo)
              const weekTotal = dayTotals ? Array.from(dayTotals.values()).reduce((a, b) => a + b, 0) : 0

              return (
                <React.Fragment key={modelo}>
                  <tr className="border-t-2 border-foreground/20 bg-accent/40">
                    <td colSpan={fixedCols} className="px-2 py-1 border-r-2 border-border/40">
                      <div className="flex items-center gap-2">
                        {imgUrl && <img src={imgUrl} alt="" className="h-5 w-auto rounded border object-contain bg-white shrink-0" />}
                        <span className="font-bold text-[11px]">{modelo}</span>
                      </div>
                    </td>
                    {dayNames.map((d) => {
                      const p = dayTotals?.get(d) || 0
                      return (
                        <td key={d} colSpan={colsPerDay} className="px-1 py-1 text-center font-mono text-[10px] font-bold border-r-2 border-border/40"
                          style={{ color: p > 0 ? DAY_COLOR[d] : undefined, backgroundColor: p > 0 ? `${DAY_COLOR[d]}08` : undefined }}>
                          {p > 0 ? `${p.toLocaleString()}p` : ''}
                        </td>
                      )
                    })}
                    <td className="px-1 py-1 text-center font-mono text-[10px] font-bold">
                      {weekTotal > 0 ? weekTotal.toLocaleString() : ''}
                    </td>
                  </tr>
                  {rows.map((r, i) => {
                    const bgColor = getEtapaColor(r.etapa, r.input_o_proceso)
                    const hasSinAsignar = Object.values(r.days).some((d) => d.isSinAsignar)

                    return (
                      <tr key={i} className={`border-b border-border/20 hover:bg-accent/20 ${hasSinAsignar ? 'animate-pulse-alert bg-red-500/10' : ''}`}>
                        <td className="px-1 py-0 font-mono">{r.fraccion}</td>
                        <td className="px-1 py-0 max-w-[150px]">
                          <div className="flex items-center gap-1">
                            <div className="h-2 w-2 rounded-sm shrink-0" style={{ backgroundColor: bgColor }} />
                            <span className="truncate block">{r.operacion}</span>
                          </div>
                        </td>
                        <td className="px-1 py-0 font-mono text-[8px] border-r-2 border-border/40">{r.recurso}</td>

                        {dayNames.map((d) => {
                          const cell = r.days[d]
                          const hasData = cell && cell.total > 0
                          const isSin = cell?.isSinAsignar
                          const isAdel = cell?.adelanto

                          return (
                            <React.Fragment key={d}>
                              {Array.from({ length: numBlocks }, (_, bi) => {
                                const val = hasData ? cell.blocks[bi] || 0 : 0
                                return (
                                  <td key={bi}
                                    className={`px-0 py-0 text-center ${isSin && val > 0 ? 'ring-1 ring-inset ring-red-500/50' : ''}`}
                                    style={{
                                      backgroundColor: val > 0 ? isSin ? 'rgba(239,68,68,0.25)' : isAdel ? 'rgba(59,130,246,0.20)' : `${bgColor}30` : undefined,
                                      color: val > 0 ? isSin ? '#ef4444' : isAdel ? '#3b82f6' : bgColor : undefined,
                                      fontWeight: val > 0 ? 600 : 400,
                                    }}>
                                    {val > 0 ? val : ''}
                                  </td>
                                )
                              })}
                              <td className={`px-0 py-0 text-center font-bold font-mono ${!showOperario ? 'border-r-2 border-border/40' : ''}`}
                                style={{
                                  color: hasData ? isSin ? '#ef4444' : isAdel ? '#3b82f6' : DAY_COLOR[d] : undefined,
                                  backgroundColor: hasData ? isSin ? 'rgba(239,68,68,0.10)' : isAdel ? 'rgba(59,130,246,0.08)' : `${DAY_COLOR[d]}08` : undefined,
                                }}>
                                {hasData ? cell.total : ''}
                              </td>
                              {showOperario && (
                                <td className="px-0 py-0 text-center text-[7px] border-r-2 border-border/40 max-w-[55px]">
                                  {isSin ? <span className="text-red-500 font-bold">SIN</span>
                                    : hasData && cell.operario ? <span className="truncate block px-0.5">{cell.operario}</span> : ''}
                                </td>
                              )}
                            </React.Fragment>
                          )
                        })}

                        <td className="px-1 py-0 text-center font-bold font-mono">{r.weekTotal}</td>
                      </tr>
                    )
                  })}
                </React.Fragment>
              )
            })}
            {modelGroups.length === 0 && (
              <tr>
                <td colSpan={totalCols} className="text-center text-muted-foreground py-8">No hay datos en este resultado.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
