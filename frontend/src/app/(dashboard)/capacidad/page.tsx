'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/lib/store/useAppStore'
import { runCapacityPlan } from '@/lib/api/fastapi'
import { supabase } from '@/lib/supabase/client'
import { KpiCard } from '@/components/shared/KpiCard'
import { DaySelector } from '@/components/shared/DaySelector'
import { BLOCK_LABELS, STAGE_COLORS, DAY_ORDER } from '@/types'
import type { DayName, CapacityResponse } from '@/types'

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
  const [selectedDay, setSelectedDay] = useState<DayName>('Lun')

  // Load latest capacity result from Supabase
  const loadCapResult = useCallback(async () => {
    if (!semana && !pedidoNombre) return
    const baseName = `cap_${semana || pedidoNombre}`
    const { data } = await supabase
      .from('resultados')
      .select('*')
      .eq('base_name', baseName)
      .order('version', { ascending: false })
      .limit(1)
    if (data?.[0]) {
      setCapResult(data[0])
      setCapSummary(data[0].weekly_summary)
    }
  }, [semana, pedidoNombre])

  useEffect(() => { loadCapResult() }, [loadCapResult])

  const handleCalculate = async () => {
    if (!pedidoNombre) return
    setLoading(true)
    setError('')
    try {
      await runCapacityPlan({
        pedido_nombre: pedidoNombre,
        semana: semana || '',
      })
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
  const dayData = dailyResults[selectedDay]
  const daySchedule = (dayData?.schedule || []) as Array<Record<string, unknown>>

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
  const actualWeekly = (currentResult?.weekly_schedule || []) as Array<Record<string, unknown>>
  const actualByModel: Record<string, number> = {}
  for (const entry of actualWeekly) {
    const m = entry.Modelo as string
    actualByModel[m] = (actualByModel[m] || 0) + (entry.Pares as number)
  }

  // Available days for selector
  const availableDays = DAY_ORDER.filter(d =>
    dailyResults[d] && (dailyResults[d].total_pares as number) > 0
  )

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
        <button
          onClick={handleCalculate}
          disabled={loading || !pedidoNombre}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50"
        >
          {loading ? 'Calculando...' : 'Calcular Capacidad'}
        </button>
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
            <h2 className="text-sm font-semibold mb-3">Asignacion Semanal — Capacidad</h2>
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

          {/* Comparison Table */}
          <div className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold mb-3">Comparacion: Capacidad vs Actual</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2">Modelo</th>
                    <th className="text-right px-3 py-2">Volumen</th>
                    <th className="text-right px-3 py-2">Capacidad</th>
                    <th className="text-right px-3 py-2">Actual</th>
                    <th className="text-right px-3 py-2">Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(pivotData).map(([modelo, dias]) => {
                    const capTotal = Object.values(dias).reduce((a, b) => a + b, 0)
                    const actTotal = actualByModel[modelo] || 0
                    const mGap = capTotal - actTotal
                    return (
                      <tr key={modelo} className="border-b border-border/50">
                        <td className="py-2 font-medium">{modelo}</td>
                        <td className="text-right px-3 py-2">{capTotal}</td>
                        <td className="text-right px-3 py-2 text-emerald-500">{capTotal}</td>
                        <td className="text-right px-3 py-2">{actTotal || '-'}</td>
                        <td className={`text-right px-3 py-2 font-medium ${mGap > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                          {mGap > 0 ? `+${mGap}` : mGap === 0 ? '-' : mGap}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Daily View */}
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-sm font-semibold">Programa Diario — Capacidad</h2>
              <DaySelector
                dayNames={availableDays.length > 0 ? availableDays : DAY_ORDER.filter(d => d !== 'Sab')}
                selectedDay={selectedDay}
                onDayChange={(d) => setSelectedDay(d as DayName)}
              />
              {dayData && (
                <span className="text-xs text-muted-foreground ml-auto">
                  {(dayData.total_pares as number || 0).toLocaleString()}p
                </span>
              )}
            </div>

            {daySchedule.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">Sin operaciones para este dia</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left py-1.5 pr-2">MODELO</th>
                      <th className="text-left py-1.5 px-1">FRACC</th>
                      <th className="text-left py-1.5 px-1">OPERACION</th>
                      <th className="text-left py-1.5 px-1">RECURSO</th>
                      <th className="text-right py-1.5 px-1">RATE</th>
                      {BLOCK_LABELS.map(bl => (
                        <th key={bl} className="text-right py-1.5 px-1 min-w-[36px]">{bl}</th>
                      ))}
                      <th className="text-right py-1.5 pl-2 font-bold">TOTAL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daySchedule.map((entry, i) => {
                      const blocks = (entry.blocks || []) as number[]
                      const total = entry.total as number
                      const ip = (entry.input_o_proceso as string || '').toUpperCase()
                      const color = ip.includes('ROBOT') ? STAGE_COLORS.ROBOT
                        : ip.includes('POST') ? STAGE_COLORS.POST
                        : ip.includes('N/A') ? STAGE_COLORS['N/A PRELIMINAR']
                        : ip.includes('MAQUILA') ? STAGE_COLORS.MAQUILA
                        : STAGE_COLORS.PRELIMINAR

                      return (
                        <tr key={`${entry.modelo}-${entry.fraccion}-${i}`}
                            className="border-b border-border/30 hover:bg-muted/20">
                          <td className="py-1 pr-2 font-medium">{entry.modelo as string}</td>
                          <td className="py-1 px-1">{entry.fraccion as number}</td>
                          <td className="py-1 px-1 max-w-[200px] truncate">{entry.operacion as string}</td>
                          <td className="py-1 px-1">{entry.recurso as string}</td>
                          <td className="py-1 px-1 text-right">{entry.rate as number}</td>
                          {BLOCK_LABELS.map((bl, bi) => {
                            const val = blocks[bi] || 0
                            return (
                              <td key={bl}
                                  className="py-1 px-1 text-right font-mono"
                                  style={val > 0 ? { backgroundColor: color + '33', color } : {}}>
                                {val || ''}
                              </td>
                            )
                          })}
                          <td className="py-1 pl-2 text-right font-bold">{total}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
