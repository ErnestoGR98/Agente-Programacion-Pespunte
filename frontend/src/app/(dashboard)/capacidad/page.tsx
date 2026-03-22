'use client'

import React, { useState, useCallback, useMemo } from 'react'
import { useAppStore } from '@/lib/store/useAppStore'
import { runCapacityPlan } from '@/lib/api/fastapi'
import { supabase } from '@/lib/supabase/client'
import { KpiCard } from '@/components/shared/KpiCard'
import { BLOCK_LABELS, STAGE_COLORS, DAY_ORDER } from '@/types'
import type { CapacityResponse } from '@/types'
import { useCatalogoImages, getModeloImageUrl } from '@/lib/hooks/useCatalogoImages'
import { exportToExcel, exportToPDF } from '@/lib/export'

// ============================================================
// Capacidad Instalada — Vista teorica sin restricciones de HC
// ============================================================

export default function CapacidadPage() {
  const pedidoNombre = useAppStore((s) => s.currentPedidoNombre)
  const semana = useAppStore((s) => s.currentSemana)
  const currentResult = useAppStore((s) => s.currentResult)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [capResult, setCapResult] = useState<Record<string, unknown> | null>(null)
  const [capSummary, setCapSummary] = useState<Record<string, unknown> | null>(null)
  const [capVersions, setCapVersions] = useState<Array<{ nombre: string; version: number }>>([])
  const [selectedCapVersion, setSelectedCapVersion] = useState<string>('')
  const catImages = useCatalogoImages()

  // Load all capacity versions
  const loadCapVersions = useCallback(async () => {
    if (!semana && !pedidoNombre) return
    const baseName = `cap_${semana || pedidoNombre}`
    const { data } = await supabase
      .from('resultados')
      .select('nombre,version')
      .eq('base_name', baseName)
      .order('version', { ascending: false })
    if (data?.length) {
      setCapVersions(data)
      if (!selectedCapVersion) setSelectedCapVersion(data[0].nombre)
    }
  }, [semana, pedidoNombre, selectedCapVersion])

  // Load specific version
  const loadCapResult = useCallback(async (versionName?: string) => {
    if (!semana && !pedidoNombre) return
    const baseName = `cap_${semana || pedidoNombre}`
    let query = supabase.from('resultados').select('*').eq('base_name', baseName)
    if (versionName) {
      query = query.eq('nombre', versionName)
    } else {
      query = query.order('version', { ascending: false }).limit(1)
    }
    const { data } = await query
    if (data?.[0]) {
      setCapResult(data[0])
      setCapSummary(data[0].weekly_summary)
      setSelectedCapVersion(data[0].nombre)
    }
  }, [semana, pedidoNombre])

  // Auto-load versions and latest result on mount
  React.useEffect(() => {
    loadCapVersions()
    loadCapResult()
  }, [loadCapVersions, loadCapResult])

  // Handle version change
  const handleVersionChange = async (nombre: string) => {
    setSelectedCapVersion(nombre)
    await loadCapResult(nombre)
  }

  const handleCalculate = async () => {
    if (!pedidoNombre) return
    setLoading(true)
    setError('')
    try {
      await runCapacityPlan({
        pedido_nombre: pedidoNombre,
        semana: semana || '',
      })
      await loadCapVersions()
      await loadCapResult()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al calcular')
    } finally {
      setLoading(false)
    }
  }

  // Extract data for comparison
  const actualPares = currentResult?.weekly_summary?.total_pares || 0
  const capPares = capSummary?.total_pares || 0
  const gap = Math.max(0, (capPares as number) - (actualPares as number))
  const gapPct = capPares ? ((gap / (capPares as number)) * 100).toFixed(1) : '0'

  // Weekly schedule
  const weeklySchedule = (capResult as Record<string, unknown>)?.weekly_schedule as Array<Record<string, unknown>> || []

  // Daily results
  const dailyResults = (capResult as Record<string, unknown>)?.daily_results as Record<string, Record<string, unknown>> || {}
  // (dayData used for individual day queries if needed later)

  // Pivot: modelo × dia
  const pivotData: Record<string, Record<string, number>> = {}
  for (const entry of weeklySchedule) {
    const modelo = entry.Modelo as string
    const dia = entry.Dia as string
    const pares = entry.Pares as number
    if (!pivotData[modelo]) pivotData[modelo] = {}
    pivotData[modelo][dia] = pares
  }

  // Comparison with actual
  const actualWeekly = (currentResult?.weekly_schedule || []) as unknown as Array<Record<string, unknown>>
  const actualByModel: Record<string, number> = {}
  for (const entry of actualWeekly) {
    const m = entry.Modelo as string
    actualByModel[m] = (actualByModel[m] || 0) + (entry.Pares as number)
  }

  // Sabana: days available
  const sabanadays = DAY_ORDER.filter(d =>
    dailyResults[d] && (dailyResults[d].total_pares as number) > 0
  )

  // Block labels: dinámicos desde params_snapshot, fallback a BLOCK_LABELS
  const paramsSnapshot = (capResult as Record<string, unknown>)?.params_snapshot as Record<string, unknown> | undefined
  const dynamicBlockLabels: string[] = useMemo(() => {
    const tb = paramsSnapshot?.time_blocks as Array<{ label: string }> | undefined
    if (tb?.length) return tb.map(b => b.label)
    return [...BLOCK_LABELS]
  }, [paramsSnapshot])

  // Build sabana model groups (same format as /sabana page)
  const sabanaGroups = useMemo(() => {
    if (!dailyResults || sabanadays.length === 0) return []

    const numBlocks = dynamicBlockLabels.length
    const makeKey = (modelo: string, fracc: number, op: string, rec: string) =>
      `${modelo}||${fracc}||${op}||${rec}`

    const modelOrder: string[] = []
    const byModel = new Map<string, Map<string, {
      modelo: string; fraccion: number; operacion: string; recurso: string
      input_o_proceso: string; days: Record<string, { blocks: number[]; total: number }>
      weekTotal: number
    }>>()

    for (const day of sabanadays) {
      const sched = (dailyResults[day]?.schedule || []) as Array<Record<string, unknown>>
      for (const s of sched) {
        const modelo = s.modelo as string
        const recurso = (s.robot as string) || (s.recurso as string)
        const key = makeKey(modelo, s.fraccion as number, s.operacion as string, recurso)

        if (!byModel.has(modelo)) {
          modelOrder.push(modelo)
          byModel.set(modelo, new Map())
        }
        const opMap = byModel.get(modelo)!

        if (!opMap.has(key)) {
          opMap.set(key, {
            modelo, fraccion: s.fraccion as number, operacion: s.operacion as string,
            recurso, input_o_proceso: (s.input_o_proceso as string) || '',
            days: {}, weekTotal: 0,
          })
        }

        const opRow = opMap.get(key)!
        const blocks = (s.blocks || []) as number[]

        if (opRow.days[day]) {
          const existing = opRow.days[day]
          for (let bi = 0; bi < numBlocks; bi++) {
            existing.blocks[bi] = (existing.blocks[bi] || 0) + (blocks[bi] || 0)
          }
          existing.total += (s.total as number)
        } else {
          opRow.days[day] = {
            blocks: Array.from({ length: numBlocks }, (_, bi) => blocks[bi] || 0),
            total: s.total as number,
          }
        }
      }
    }

    return modelOrder.map((modelo) => {
      const opMap = byModel.get(modelo)!
      const rows = Array.from(opMap.values())
      for (const row of rows) {
        row.weekTotal = Object.values(row.days).reduce((sum, d) => sum + d.total, 0)
      }
      rows.sort((a, b) => a.fraccion - b.fraccion)
      const [num, ...cp] = modelo.split(' ')
      const imgUrl = getModeloImageUrl(catImages, num, cp.join(' '))
      const dayTotals: Record<string, number> = {}
      for (const [d, p] of Object.entries(pivotData[modelo] || {})) dayTotals[d] = p
      return { modelo, imgUrl, rows, dayTotals }
    })
  }, [dailyResults, sabanadays, catImages, pivotData])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Capacidad Instalada</h1>
          <p className="text-sm text-muted-foreground">
            Techo teorico de produccion — solo restricciones fisicas (robots, maquinas, precedencias)
          </p>
        </div>
        <div className="flex items-center gap-3">
          {capVersions.length > 0 && (
            <select
              value={selectedCapVersion}
              onChange={(e) => handleVersionChange(e.target.value)}
              className="h-9 px-3 rounded-md border bg-background text-sm"
            >
              {capVersions.map((v) => (
                <option key={v.nombre} value={v.nombre}>
                  {v.nombre}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={handleCalculate}
            disabled={loading || !pedidoNombre}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Calculando...' : 'Calcular Capacidad'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-destructive/10 text-destructive rounded-md text-sm">{error}</div>
      )}

      {!capResult && !loading && (
        <div className="p-8 text-center text-muted-foreground border border-dashed rounded-lg">
          Haz click en &quot;Calcular Capacidad&quot; para ver el techo teorico de la planta
        </div>
      )}

      {capResult && (
        <>
          {/* KPI Cards — Comparison */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard label="Maximo Teorico" value={(capPares as number).toLocaleString()} />
            <KpiCard label="Produccion Actual" value={(actualPares as number).toLocaleString()} />
            <KpiCard
              label="Gap por HC/Skills"
              value={`${gap.toLocaleString()} (${gapPct}%)`}
            />
            <KpiCard
              label="Estado"
              value={capSummary?.status as string || 'N/A'}
            />
          </div>

          {/* Weekly Pivot Table */}
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Asignacion Semanal — Capacidad</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const days = DAY_ORDER.filter(d => d !== 'Sab')
                    const headers = ['Modelo', ...days, 'TOTAL']
                    const rows = Object.entries(pivotData).map(([modelo, dias]) => {
                      const total = Object.values(dias).reduce((a, b) => a + b, 0)
                      return [modelo, ...days.map(d => dias[d] || 0), total]
                    })
                    const totals = ['TOTAL', ...days.map(d =>
                      Object.values(pivotData).reduce((sum, dias) => sum + (dias[d] || 0), 0)
                    ), Object.values(pivotData).reduce((sum, dias) =>
                      sum + Object.values(dias).reduce((a, b) => a + b, 0), 0
                    )]
                    rows.push(totals)
                    exportToExcel(`Capacidad_${selectedCapVersion}`, headers, rows)
                  }}
                  className="text-xs px-2 py-1 rounded border hover:bg-muted"
                >📊 Excel</button>
                <button
                  onClick={() => {
                    const days = DAY_ORDER.filter(d => d !== 'Sab')
                    const headers = ['Modelo', ...days, 'TOTAL']
                    const rows = Object.entries(pivotData).map(([modelo, dias]) => {
                      const total = Object.values(dias).reduce((a, b) => a + b, 0)
                      return [modelo, ...days.map(d => dias[d] || 0), total]
                    })
                    exportToPDF(`Capacidad_${selectedCapVersion}`, headers, rows)
                  }}
                  className="text-xs px-2 py-1 rounded border hover:bg-muted"
                >📄 PDF</button>
                <button
                  onClick={() => {
                    const jsonData = {
                      version: selectedCapVersion,
                      summary: capSummary,
                      weekly_schedule: weeklySchedule,
                      daily_results: dailyResults,
                    }
                    navigator.clipboard.writeText(JSON.stringify(jsonData, null, 2))
                      .then(() => alert('JSON copiado al portapapeles'))
                  }}
                  className="text-xs px-2 py-1 rounded border hover:bg-muted"
                >{'{}'} JSON</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4">Modelo</th>
                    {DAY_ORDER.filter(d => d !== 'Sab').map(d => (
                      <th key={d} className="text-right px-3 py-2">{d}</th>
                    ))}
                    <th className="text-right px-3 py-2 font-bold">TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(pivotData).map(([modelo, dias]) => {
                    const total = Object.values(dias).reduce((a, b) => a + b, 0)
                    const actualTotal = actualByModel[modelo] || 0
                    const modelGap = total - actualTotal
                    return (
                      <tr key={modelo} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="py-2 pr-4 font-medium">{modelo}</td>
                        {DAY_ORDER.filter(d => d !== 'Sab').map(d => (
                          <td key={d} className="text-right px-3 py-2">
                            {dias[d] || ''}
                          </td>
                        ))}
                        <td className="text-right px-3 py-2 font-bold">{total}</td>
                      </tr>
                    )
                  })}
                  {/* Totals row */}
                  <tr className="bg-muted/50 font-bold">
                    <td className="py-2 pr-4">TOTAL</td>
                    {DAY_ORDER.filter(d => d !== 'Sab').map(d => {
                      const dayTotal = Object.values(pivotData).reduce((sum, dias) => sum + (dias[d] || 0), 0)
                      return <td key={d} className="text-right px-3 py-2">{dayTotal || ''}</td>
                    })}
                    <td className="text-right px-3 py-2">{capPares as number}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Sabana Semanal — Capacidad (same format as /sabana) */}
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Sabana Semanal — Capacidad Instalada</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const days = sabanadays
                    const blockLabels = BLOCK_LABELS.filter(b => b !== 'COMIDA')
                    const headers = ['MODELO', 'FRACC', 'OPERACION', 'REC', ...days.flatMap(d => blockLabels.map(b => `${d} ${b}`)), ...days.map(d => `${d} TOT`), 'TOTAL']
                    const rows: (string | number)[][] = []
                    for (const group of sabanaGroups) {
                      for (const row of group.rows) {
                        const r: (string | number)[] = [group.modelo, row.fraccion, row.operacion, row.recurso]
                        for (const d of days) {
                          const dayData = row.days[d]
                          for (let bi = 0; bi < blockLabels.length; bi++) {
                            r.push(dayData?.blocks[bi] || '')
                          }
                        }
                        for (const d of days) {
                          r.push(row.days[d]?.total || '')
                        }
                        r.push(row.weekTotal || 0)
                        rows.push(r)
                      }
                    }
                    exportToExcel(`Sabana_Capacidad_${selectedCapVersion}`, headers, rows)
                  }}
                  className="text-xs px-2 py-1 rounded border hover:bg-muted"
                >📊 Excel</button>
                <button
                  onClick={() => {
                    const days = sabanadays
                    const headers = ['MODELO', 'FRACC', 'OPERACION', 'REC', ...days.map(d => `${d} TOT`), 'TOTAL']
                    const rows: (string | number)[][] = []
                    for (const group of sabanaGroups) {
                      for (const row of group.rows) {
                        const r: (string | number)[] = [group.modelo, row.fraccion, row.operacion, row.recurso]
                        for (const d of days) {
                          r.push(row.days[d]?.total || '')
                        }
                        r.push(row.weekTotal || 0)
                        rows.push(r)
                      }
                    }
                    exportToPDF(`Sabana_Capacidad_${selectedCapVersion}`, headers, rows)
                  }}
                  className="text-xs px-2 py-1 rounded border hover:bg-muted"
                >📄 PDF</button>
                <button
                  onClick={() => {
                    const jsonData = sabanaGroups.map(g => ({
                      modelo: g.modelo,
                      operaciones: g.rows.map(r => ({
                        fraccion: r.fraccion,
                        operacion: r.operacion,
                        recurso: r.recurso,
                        dias: r.days,
                        total: r.weekTotal,
                      }))
                    }))
                    navigator.clipboard.writeText(JSON.stringify(jsonData, null, 2))
                      .then(() => alert('JSON copiado al portapapeles'))
                  }}
                  className="text-xs px-2 py-1 rounded border hover:bg-muted"
                >{'{}'} JSON</button>
              </div>
            </div>
            <div className="overflow-x-auto" style={{ cursor: 'grab' }}
              onMouseDown={(e) => {
                const el = e.currentTarget
                let startX = e.pageX, scrollLeft = el.scrollLeft
                const onMove = (ev: MouseEvent) => { el.scrollLeft = scrollLeft - (ev.pageX - startX) }
                const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); el.style.cursor = 'grab' }
                document.addEventListener('mousemove', onMove)
                document.addEventListener('mouseup', onUp)
                el.style.cursor = 'grabbing'
              }}
            >
              <table className="text-[11px] border-collapse" style={{ minWidth: sabanadays.length * (dynamicBlockLabels.length + 1) * 36 + 280 }}>
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-background z-10 text-left px-1 py-1 min-w-[80px]" rowSpan={2}>OPERACION</th>
                    <th className="sticky left-[80px] bg-background z-10 text-left px-1 py-1 min-w-[70px]" rowSpan={2}>REC</th>
                    {sabanadays.map(d => {
                      const dayColor = d === 'Lun' ? '#3b82f6' : d === 'Mar' ? '#8b5cf6'
                        : d === 'Mie' ? '#06b6d4' : d === 'Jue' ? '#f59e0b'
                        : d === 'Vie' ? '#10b981' : '#ef4444'
                      return (
                        <th key={d} colSpan={dynamicBlockLabels.length + 1}
                            className="text-center py-1 border-l border-border/50"
                            style={{ color: dayColor }}>
                          {d}
                        </th>
                      )
                    })}
                  </tr>
                  <tr>
                    {sabanadays.map(d => (
                      <React.Fragment key={d}>
                        {dynamicBlockLabels.map(bl => (
                          <th key={`${d}-${bl}`} className="text-right px-0.5 py-0.5 min-w-[32px] text-muted-foreground border-l border-border/20">
                            {bl}
                          </th>
                        ))}
                        <th className="text-right px-1 py-0.5 min-w-[36px] font-bold border-l border-border/50">TOT</th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sabanaGroups.map(({ modelo, imgUrl, rows, dayTotals }) => (
                    <React.Fragment key={modelo}>
                      {/* Model header row */}
                      <tr className="bg-muted/40">
                        <td colSpan={2} className="sticky left-0 bg-muted/40 z-10 py-1.5 px-1 font-bold flex items-center gap-2">
                          {imgUrl && <img src={imgUrl} alt="" className="w-8 h-8 rounded object-cover" />}
                          <span>{modelo}</span>
                        </td>
                        {sabanadays.map(d => (
                          <React.Fragment key={d}>
                            <td colSpan={dynamicBlockLabels.length} className="border-l border-border/50" />
                            <td className="text-right px-1 py-1 font-bold border-l border-border/50"
                                style={{ color: d === 'Lun' ? '#3b82f6' : d === 'Mar' ? '#8b5cf6' : d === 'Mie' ? '#06b6d4' : d === 'Jue' ? '#f59e0b' : d === 'Vie' ? '#10b981' : '#ef4444' }}>
                              {dayTotals[d] ? `${dayTotals[d]}p` : ''}
                            </td>
                          </React.Fragment>
                        ))}
                      </tr>
                      {/* Operation rows */}
                      {rows.map((row, ri) => {
                        const ip = (row.input_o_proceso || '').toUpperCase()
                        const color = ip.includes('ROBOT') ? STAGE_COLORS.ROBOT
                          : ip.includes('POST') ? STAGE_COLORS.POST
                          : ip.includes('N/A') ? STAGE_COLORS['N/A PRELIMINAR']
                          : ip.includes('MAQUILA') ? STAGE_COLORS.MAQUILA
                          : STAGE_COLORS.PRELIMINAR

                        return (
                          <tr key={`${modelo}-${row.fraccion}-${ri}`}
                              className="border-b border-border/20 hover:bg-muted/10">
                            <td className="sticky left-0 bg-background z-10 py-0.5 px-1 truncate max-w-[180px]"
                                title={`F${row.fraccion} ${row.operacion}`}>
                              <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: color }} />
                              F{row.fraccion} {row.operacion}
                            </td>
                            <td className="sticky left-[80px] bg-background z-10 py-0.5 px-1 text-muted-foreground">
                              {row.recurso}
                            </td>
                            {sabanadays.map(d => {
                              const cell = row.days[d]
                              return (
                                <React.Fragment key={d}>
                                  {dynamicBlockLabels.map((bl, bi) => {
                                    const val = cell?.blocks[bi] || 0
                                    return (
                                      <td key={`${d}-${bl}`}
                                          className="text-right px-0.5 py-0.5 font-mono border-l border-border/10"
                                          style={val > 0 ? { backgroundColor: color + '33', color } : {}}>
                                        {val || ''}
                                      </td>
                                    )
                                  })}
                                  <td className="text-right px-1 py-0.5 font-bold border-l border-border/50">
                                    {cell?.total || ''}
                                  </td>
                                </React.Fragment>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
