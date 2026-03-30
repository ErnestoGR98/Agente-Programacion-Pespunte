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
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { CheckCircle, Save, Loader2 } from 'lucide-react'
import type { DayName } from '@/types'
import { DAY_ORDER, STAGE_COLORS } from '@/types'

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
  // Fracciones con avance: {modelo_num: {fraccion: pares_hechos}}
  // pares > 0 = parcial, pares = -1 = 100% completada
  const [fracsDone, setFracsDone] = useState<Record<string, Record<number, number>>>({})
  // Catalogo operaciones per modelo: {modelo_num: [{fraccion, operacion, input_o_proceso}]}
  const [catOps, setCatOps] = useState<Record<string, { fraccion: number; operacion: string; input_o_proceso: string }[]>>({})
  // Volumen del pedido por modelo: {modelo_num: volumen}
  const [volumenByModelo, setVolumenByModelo] = useState<Record<string, number>>({})

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
        .select('modelo_num, volumen')
        .eq('pedido_id', pedidos[0].id)
      const unique = [...new Set((items || []).map((i: { modelo_num: string }) => i.modelo_num))].sort()
      // Build volumen map
      const vMap: Record<string, number> = {}
      for (const it of items || []) {
        vMap[(it as { modelo_num: string }).modelo_num] = Number((it as { volumen: number }).volumen) || 0
      }
      setVolumenByModelo(vMap)
      setModelos(unique)
      setLoadingModelos(false)
    })()
  }, [pedidoNombre])

  // Load catalogo operations for each modelo
  useEffect(() => {
    if (modelos.length === 0) return
    ;(async () => {
      // Get modelo IDs
      const { data: catModelos } = await supabase
        .from('catalogo_modelos')
        .select('id, modelo_num')
        .in('modelo_num', modelos)
      if (!catModelos) return
      const idMap = new Map(catModelos.map((m: { id: string; modelo_num: string }) => [m.id, m.modelo_num]))
      const ids = catModelos.map((m: { id: string }) => m.id)

      const { data: ops } = await supabase
        .from('catalogo_operaciones')
        .select('modelo_id, fraccion, operacion, input_o_proceso')
        .in('modelo_id', ids)
        .order('fraccion')

      const result: Record<string, { fraccion: number; operacion: string; input_o_proceso: string }[]> = {}
      for (const op of ops || []) {
        const mn = idMap.get(op.modelo_id as string)
        if (!mn) continue
        if (!result[mn]) result[mn] = []
        result[mn].push({
          fraccion: op.fraccion as number,
          operacion: op.operacion as string,
          input_o_proceso: (op.input_o_proceso as string) || '',
        })
      }
      setCatOps(result)
    })()
  }, [modelos])

  // Initialize fracsDone from avance data
  useEffect(() => {
    if (avance.loading) return
    const fd: Record<string, Record<number, number>> = {}
    for (const d of avance.detalles) {
      const fc = d.fracciones_completadas
      if (!fc) continue
      if (!fd[d.modelo_num]) fd[d.modelo_num] = {}
      if (Array.isArray(fc)) {
        // Old format: [1,2,3] → 100% each
        for (const f of fc) {
          if (!(f in fd[d.modelo_num])) fd[d.modelo_num][f] = -1
        }
      } else if (typeof fc === 'object' && fc !== null) {
        // New format: {"1": 50, "3": -1}
        for (const [k, v] of Object.entries(fc as Record<string, number>)) {
          fd[d.modelo_num][Number(k)] = v
        }
      }
    }
    setFracsDone(fd)
  }, [avance.loading, avance.detalles])

  function toggleFrac(modelo: string, frac: number) {
    setFracsDone((prev) => {
      const modeloData = { ...(prev[modelo] || {}) }
      if (frac in modeloData) {
        delete modeloData[frac]
      } else {
        modeloData[frac] = -1
      }
      return { ...prev, [modelo]: modeloData }
    })
  }

  function setFracPares(modelo: string, frac: number, pares: number) {
    setFracsDone((prev) => {
      const modeloData = { ...(prev[modelo] || {}) }
      modeloData[frac] = pares
      return { ...prev, [modelo]: modeloData }
    })
  }

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
      const fd = fracsDone[modelo] || {}
      // Save fracciones as object {"1": 50, "3": -1} for pares tracking
      const fracObj: Record<string, number> = {}
      for (const [f, p] of Object.entries(fd)) {
        fracObj[f] = p as number
      }
      const hasFracs = Object.keys(fracObj).length > 0

      let savedForModelo = false
      for (const dia of DAYS) {
        const pares = grid[modelo]?.[dia] || 0
        if (pares > 0) {
          entries.push({
            modelo_num: modelo,
            dia,
            pares,
            fracciones_completadas: hasFracs ? fracObj as unknown as number[] : [],
          })
          savedForModelo = true
        }
      }
      // If has fracciones but no pares on any day, save on Lun
      if (hasFracs && !savedForModelo) {
        entries.push({
          modelo_num: modelo,
          dia: 'Lun',
          pares: 0,
          fracciones_completadas: fracObj as unknown as number[],
        })
      }
    }
    await avance.save(entries)
    setSaving(false)
    setMessage('Avance guardado correctamente')
    setTimeout(() => setMessage(null), 3000)
    // Reload to ensure fracsDone re-initializes from DB
    await avance.reload()
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
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
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

          <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse min-w-[500px]">
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
          </div>
        </CardContent>
      </Card>
      {/* Fracciones Completadas */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-semibold">Fracciones Completadas</p>
              <p className="text-xs text-muted-foreground">
                Marca las fracciones que ya estan hechas (ej: preliminares del viernes pasado).
                El solver las saltara al optimizar.
              </p>
            </div>
            <Button onClick={handleSave} disabled={saving} size="sm">
              {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
              Guardar
            </Button>
          </div>

          <div className="space-y-3">
            {modelos.map((modelo) => {
              const ops = catOps[modelo] || []
              if (ops.length === 0) return null
              const done = fracsDone[modelo] || {}
              const doneCount = Object.keys(done).length

              const maxPares = volumenByModelo[modelo] || 0

              return (
                <div key={modelo} className="border rounded-md p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-bold font-mono">{modelo}</span>
                    <Badge variant="outline" className="text-xs font-mono">{maxPares}p</Badge>
                    {doneCount > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {doneCount}/{ops.length} con avance
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {ops.map((op) => {
                      const isDone = op.fraccion in done
                      const paresDone = done[op.fraccion] ?? 0
                      const isFullDone = paresDone === -1
                      const color = op.input_o_proceso.includes('ROBOT') ? STAGE_COLORS.ROBOT
                        : op.input_o_proceso.includes('POST') ? STAGE_COLORS.POST
                        : op.input_o_proceso.includes('PRELIMINAR') ? STAGE_COLORS.PRELIMINAR
                        : op.input_o_proceso.includes('N/A') ? STAGE_COLORS['N/A PRELIMINAR']
                        : '#6B7280'
                      return (
                        <div
                          key={op.fraccion}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-all ${
                            isDone ? 'bg-green-500/10 border-green-500/40' : 'hover:bg-accent/30'
                          }`}
                        >
                          <Checkbox
                            checked={isDone}
                            onCheckedChange={() => toggleFrac(modelo, op.fraccion)}
                          />
                          <span className="font-mono font-medium">F{op.fraccion}</span>
                          <span className="truncate max-w-[100px]" title={op.operacion}>{op.operacion}</span>
                          <span
                            className="text-[8px] px-1 rounded font-medium"
                            style={{ backgroundColor: `${color}20`, color }}
                          >
                            {op.input_o_proceso}
                          </span>
                          {isDone && (
                            <Input
                              type="number"
                              min={0}
                              max={maxPares}
                              placeholder={`${maxPares}`}
                              value={isFullDone ? '' : paresDone}
                              onChange={(e) => {
                                const v = parseInt(e.target.value)
                                if (isNaN(v) || v <= 0) {
                                  setFracPares(modelo, op.fraccion, -1)
                                } else {
                                  setFracPares(modelo, op.fraccion, Math.min(v, maxPares))
                                }
                              }}
                              className="h-6 w-16 text-center text-[10px] px-1"
                              title={`Pares completados (max ${maxPares}, vacio = 100%)`}
                            />
                          )}
                          {isDone && (
                            <span className="text-[9px] text-muted-foreground">
                              {isFullDone ? `${maxPares}p` : `de ${maxPares}p`}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
