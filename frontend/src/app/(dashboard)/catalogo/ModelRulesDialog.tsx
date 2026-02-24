'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { Restriccion, ConstraintType } from '@/types'
import type { OperacionFull } from '@/lib/hooks/useCatalogo'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Trash2, Wand2, Loader2 } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  modeloNum: string
  operaciones: OperacionFull[]
}

export function ModelRulesDialog({ open, onOpenChange, modeloNum, operaciones }: Props) {
  const [reglas, setReglas] = useState<Restriccion[]>([])
  const [loading, setLoading] = useState(false)
  const [loteMinimo, setLoteMinimo] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('restricciones')
      .select('*')
      .is('semana', null)
      .eq('modelo_num', modeloNum)
      .order('created_at')
    setReglas(data || [])

    const lote = (data || []).find((r: Restriccion) => r.tipo === 'LOTE_MINIMO_CUSTOM')
    setLoteMinimo(lote ? String((lote.parametros as Record<string, unknown>).lote_minimo || '') : '')

    setLoading(false)
  }, [modeloNum])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const precedencias = reglas.filter((r) => r.tipo === 'PRECEDENCIA')
  const loteRegla = reglas.find((r) => r.tipo === 'LOTE_MINIMO_CUSTOM')

  // Auto-generate block precedence rules from process stages
  async function autoGenerateBlocks() {
    // Group fracciones by input_o_proceso
    const groups = new Map<string, number[]>()
    for (const op of operaciones) {
      const list = groups.get(op.input_o_proceso) || []
      list.push(op.fraccion)
      groups.set(op.input_o_proceso, list)
    }

    // Order blocks by average fraccion position
    const ordered = [...groups.entries()]
      .map(([proceso, fracs]) => ({
        proceso,
        fracs: fracs.sort((a, b) => a - b),
        avgFrac: fracs.reduce((a, b) => a + b, 0) / fracs.length,
      }))
      .sort((a, b) => a.avgFrac - b.avgFrac)

    // Check existing block precedences (compare by sorted fraction sets)
    const existingKeys = new Set(
      precedencias.map((r) => {
        const p = r.parametros as Record<string, unknown>
        const orig = ((p.fracciones_origen as number[]) || []).join(',')
        const dest = ((p.fracciones_destino as number[]) || []).join(',')
        return `${orig}→${dest}`
      })
    )

    // Generate consecutive block pairs with fraction arrays
    const newRows = []
    for (let i = 0; i < ordered.length - 1; i++) {
      const key = `${ordered[i].fracs.join(',')}→${ordered[i + 1].fracs.join(',')}`
      if (!existingKeys.has(key)) {
        newRows.push({
          semana: null,
          tipo: 'PRECEDENCIA' as ConstraintType,
          modelo_num: modeloNum,
          activa: true,
          parametros: {
            fracciones_origen: ordered[i].fracs,
            fracciones_destino: ordered[i + 1].fracs,
            buffer_pares: 0,
            nota: `${ordered[i].proceso} → ${ordered[i + 1].proceso}`,
          },
        })
      }
    }

    if (newRows.length > 0) {
      await supabase.from('restricciones').insert(newRows)
      await load()
    }
  }

  async function toggleActiva(id: string, activa: boolean) {
    await supabase.from('restricciones').update({ activa }).eq('id', id)
    await load()
  }

  async function deleteRegla(id: string) {
    await supabase.from('restricciones').delete().eq('id', id)
    await load()
  }

  async function updateBuffer(id: string, buffer: number | 'todo') {
    const regla = reglas.find((r) => r.id === id)
    if (!regla) return
    const parametros = { ...regla.parametros as Record<string, unknown>, buffer_pares: buffer }
    await supabase.from('restricciones').update({ parametros }).eq('id', id)
    await load()
  }

  async function saveLoteMinimo() {
    const val = parseInt(loteMinimo)
    if (isNaN(val) || val <= 0) {
      if (loteRegla) {
        await supabase.from('restricciones').delete().eq('id', loteRegla.id)
      }
    } else if (loteRegla) {
      await supabase.from('restricciones').update({
        parametros: { lote_minimo: val },
      }).eq('id', loteRegla.id)
    } else {
      await supabase.from('restricciones').insert({
        semana: null,
        tipo: 'LOTE_MINIMO_CUSTOM',
        modelo_num: modeloNum,
        activa: true,
        parametros: { lote_minimo: val },
      })
    }
    await load()
  }

  async function deleteAll() {
    const ids = reglas.map((r) => r.id)
    if (ids.length === 0) return
    await supabase.from('restricciones').delete().in('id', ids)
    setReglas([])
    setLoteMinimo('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono">Reglas — {modeloNum}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Actions */}
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={autoGenerateBlocks}>
                <Wand2 className="mr-1 h-3 w-3" /> Auto-generar por bloques
              </Button>
              {reglas.length > 0 && (
                <Button size="sm" variant="ghost" className="text-destructive" onClick={deleteAll}>
                  <Trash2 className="mr-1 h-3 w-3" /> Borrar todas
                </Button>
              )}
            </div>

            {/* Block precedence rules */}
            <div>
              <h3 className="text-sm font-semibold mb-2">Precedencia por Bloques</h3>
              <p className="text-xs text-muted-foreground mb-2">
                Todas las fracciones del bloque origen deben completarse antes de iniciar el bloque destino.
                Las fracciones dentro de un mismo bloque pueden correr en paralelo.
              </p>
              {precedencias.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Activa</TableHead>
                      <TableHead>Bloque Origen</TableHead>
                      <TableHead>Bloque Destino</TableHead>
                      <TableHead className="w-44">Buffer (pares)</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {precedencias.map((r) => {
                      const p = r.parametros as Record<string, unknown>
                      const fracsOrig = (p.fracciones_origen as number[]) || []
                      const fracsDest = (p.fracciones_destino as number[]) || []
                      const bufferRaw = p.buffer_pares
                      const isTodo = bufferRaw === 'todo'
                      const bufferNum = isTodo ? 0 : Number(bufferRaw || 0)
                      const nota = String(p.nota || '')

                      function fracLabel(frac: number) {
                        const op = operaciones.find((o) => o.fraccion === frac)
                        return op ? `F${frac} ${op.operacion}` : `F${frac}`
                      }

                      return (
                        <TableRow key={r.id} className={!r.activa ? 'opacity-50' : ''}>
                          <TableCell>
                            <Checkbox
                              checked={r.activa}
                              onCheckedChange={(v) => toggleActiva(r.id, v === true)}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {fracsOrig.map((f) => (
                                <Badge key={f} variant="outline" className="text-[10px] font-mono">
                                  {fracLabel(f)}
                                </Badge>
                              ))}
                            </div>
                            {nota && <span className="text-[10px] text-muted-foreground">{nota}</span>}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {fracsDest.map((f) => (
                                <Badge key={f} variant="outline" className="text-[10px] font-mono">
                                  {fracLabel(f)}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Select
                                value={isTodo ? 'todo' : 'numero'}
                                onValueChange={(v) => updateBuffer(r.id, v === 'todo' ? 'todo' : 0)}
                              >
                                <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="todo">Todo</SelectItem>
                                  <SelectItem value="numero">Num</SelectItem>
                                </SelectContent>
                              </Select>
                              {!isTodo && (
                                <Input
                                  type="number"
                                  min={0}
                                  className="h-7 w-20 text-xs"
                                  defaultValue={bufferNum}
                                  onBlur={(e) => {
                                    const val = parseInt(e.target.value)
                                    if (!isNaN(val) && val !== bufferNum) updateBuffer(r.id, val)
                                  }}
                                />
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteRegla(r.id)}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  Sin reglas de bloque. Usa &quot;Auto-generar por bloques&quot; para crear desde las etapas del catalogo.
                </p>
              )}
            </div>

            {/* Lote minimo */}
            <div>
              <h3 className="text-sm font-semibold mb-2">Lote Minimo</h3>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  placeholder="Sin minimo"
                  className="h-8 w-32 text-xs"
                  value={loteMinimo}
                  onChange={(e) => setLoteMinimo(e.target.value)}
                />
                <span className="text-xs text-muted-foreground">pares</span>
                <Button size="sm" variant="outline" onClick={saveLoteMinimo}>
                  Guardar
                </Button>
                {loteRegla && (
                  <Checkbox
                    checked={loteRegla.activa}
                    onCheckedChange={(v) => toggleActiva(loteRegla.id, v === true)}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
