'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase/client'
import { useAvance } from '@/lib/hooks/useAvance'
import type { AvanceEntry } from '@/lib/hooks/useAvance'
import { KpiCard } from '@/components/shared/KpiCard'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CheckCircle, Save, Loader2 } from 'lucide-react'
import type { DayName } from '@/types'
import { DAY_ORDER } from '@/types'

const DAYS: DayName[] = DAY_ORDER // Lun, Mar, Mie, Jue, Vie, Sab

interface Props {
  semana: string | null
  pedidoNombre: string | null
}

export function AvanceTab({ semana, pedidoNombre }: Props) {
  const avance = useAvance(semana)
  const [modelos, setModelos] = useState<string[]>([])
  const [loadingModelos, setLoadingModelos] = useState(false)
  const [grid, setGrid] = useState<Record<string, Record<string, number>>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // Load modelos from pedido items
  useEffect(() => {
    if (!pedidoNombre) {
      setModelos([])
      return
    }
    setLoadingModelos(true)
    ;(async () => {
      const { data: pedidos } = await supabase
        .from('pedidos')
        .select('id')
        .eq('nombre', pedidoNombre)
        .limit(1)
      if (!pedidos?.[0]) {
        setModelos([])
        setLoadingModelos(false)
        return
      }
      const { data: items } = await supabase
        .from('pedido_items')
        .select('modelo_num')
        .eq('pedido_id', pedidos[0].id)
      const unique = [...new Set((items || []).map((i: { modelo_num: string }) => i.modelo_num))].sort()
      setModelos(unique)
      setLoadingModelos(false)
    })()
  }, [pedidoNombre])

  // Initialize grid from avance data
  useEffect(() => {
    if (avance.loading) return
    const g: Record<string, Record<string, number>> = {}
    for (const m of modelos) {
      g[m] = {}
      for (const d of DAYS) {
        g[m][d] = avance.getPares(m, d)
      }
    }
    setGrid(g)
  }, [modelos, avance.loading, avance.detalles]) // eslint-disable-line react-hooks/exhaustive-deps

  function updateCell(modelo: string, dia: string, value: number) {
    setGrid((prev) => ({
      ...prev,
      [modelo]: { ...prev[modelo], [dia]: value },
    }))
  }

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    const entries: AvanceEntry[] = []
    for (const modelo of modelos) {
      for (const dia of DAYS) {
        const pares = grid[modelo]?.[dia] || 0
        if (pares > 0) {
          entries.push({ modelo_num: modelo, dia, pares })
        }
      }
    }
    await avance.save(entries)
    setSaving(false)
    setMessage('Avance guardado correctamente')
    setTimeout(() => setMessage(null), 3000)
  }

  // Computed totals
  const totalPares = useMemo(() => {
    let sum = 0
    for (const modelo of modelos) {
      for (const dia of DAYS) {
        sum += grid[modelo]?.[dia] || 0
      }
    }
    return sum
  }, [grid, modelos])

  const modelosConAvance = useMemo(() => {
    let count = 0
    for (const modelo of modelos) {
      const total = DAYS.reduce((s, d) => s + (grid[modelo]?.[d] || 0), 0)
      if (total > 0) count++
    }
    return count
  }, [grid, modelos])

  if (!pedidoNombre || !semana) {
    return (
      <div className="mt-4 text-center text-muted-foreground py-8">
        Carga un pedido primero para capturar avance de produccion.
      </div>
    )
  }

  if (loadingModelos || avance.loading) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Cargando...
      </div>
    )
  }

  if (modelos.length === 0) {
    return (
      <div className="mt-4 text-center text-muted-foreground py-8">
        El pedido no tiene modelos. Agrega items al pedido primero.
      </div>
    )
  }

  return (
    <div className="space-y-4 mt-4">
      {message && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <KpiCard label="Total Pares Avanzados" value={totalPares.toLocaleString()} />
        <KpiCard label="Modelos con Avance" value={`${modelosConAvance} / ${modelos.length}`} />
        <KpiCard label="Semana" value={semana} />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="pt-4 overflow-x-auto">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-muted-foreground">
              Pares producidos por modelo y dia
            </p>
            <Button onClick={handleSave} disabled={saving} size="sm">
              {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
              Guardar
            </Button>
          </div>

          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left font-semibold">MODELO</th>
                {DAYS.map((d) => (
                  <th key={d} className="px-1 py-2 text-center font-semibold w-20">{d}</th>
                ))}
                <th className="px-2 py-2 text-right font-bold">TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {modelos.map((modelo) => {
                const rowTotal = DAYS.reduce((s, d) => s + (grid[modelo]?.[d] || 0), 0)
                return (
                  <tr key={modelo} className="border-b hover:bg-accent/30">
                    <td className="px-2 py-1 font-mono font-medium">{modelo}</td>
                    {DAYS.map((dia) => (
                      <td key={dia} className="px-1 py-1 text-center">
                        <Input
                          type="number"
                          min={0}
                          value={grid[modelo]?.[dia] || ''}
                          onChange={(e) => updateCell(modelo, dia, parseInt(e.target.value) || 0)}
                          className="h-7 w-full text-center text-xs px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          placeholder="0"
                        />
                      </td>
                    ))}
                    <td className="px-2 py-1 text-right font-bold font-mono">
                      {rowTotal > 0 ? rowTotal.toLocaleString() : '-'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2">
                <td className="px-2 py-2 font-bold">TOTAL</td>
                {DAYS.map((dia) => {
                  const colTotal = modelos.reduce((s, m) => s + (grid[m]?.[dia] || 0), 0)
                  return (
                    <td key={dia} className="px-1 py-2 text-center font-bold font-mono">
                      {colTotal > 0 ? colTotal.toLocaleString() : '-'}
                    </td>
                  )
                })}
                <td className="px-2 py-2 text-right font-bold font-mono">
                  {totalPares > 0 ? totalPares.toLocaleString() : '-'}
                </td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
