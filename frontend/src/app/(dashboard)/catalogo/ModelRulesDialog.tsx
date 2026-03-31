'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { Restriccion, ConstraintType } from '@/types'
import type { OperacionFull } from '@/lib/hooks/useCatalogo'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Trash2, Wand2, Loader2 } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CascadeEditor } from '@/components/shared/CascadeEditor'
import { ProcessFlowDiagram } from '@/components/shared/ProcessFlowDiagram'

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

  const precedencias = useMemo(
    () => reglas.filter((r) => r.tipo === 'PRECEDENCIA_OPERACION'),
    [reglas],
  )
  const loteRegla = reglas.find((r) => r.tipo === 'LOTE_MINIMO_CUSTOM')

  async function createPrecedencia(fracsOrig: number[], fracsDest: number[], buffer: number | 'todo' | 'rate' | 'dia') {
    await supabase.from('restricciones').insert({
      semana: null,
      tipo: 'PRECEDENCIA_OPERACION' as ConstraintType,
      modelo_num: modeloNum,
      activa: true,
      parametros: {
        fracciones_origen: fracsOrig,
        fracciones_destino: fracsDest,
        buffer_pares: buffer,
      },
    })
    await load()
  }

  async function deleteRegla(id: string) {
    await supabase.from('restricciones').delete().eq('id', id)
    await load()
  }

  async function updateBuffer(id: string, buffer: number | 'todo' | 'rate' | 'dia') {
    const regla = reglas.find((r) => r.id === id)
    if (!regla) return
    const parametros = { ...regla.parametros as Record<string, unknown>, buffer_pares: buffer }
    await supabase.from('restricciones').update({ parametros }).eq('id', id)
    await load()
  }

  async function autoGenerateBlocks() {
    const groups = new Map<string, number[]>()
    for (const op of operaciones) {
      const list = groups.get(op.input_o_proceso) || []
      list.push(op.fraccion)
      groups.set(op.input_o_proceso, list)
    }
    const ordered = [...groups.entries()]
      .map(([proceso, fracs]) => ({
        proceso,
        fracs: fracs.sort((a, b) => a - b),
        avgFrac: fracs.reduce((a, b) => a + b, 0) / fracs.length,
      }))
      .sort((a, b) => a.avgFrac - b.avgFrac)

    const existingKeys = new Set(
      precedencias.map((r) => {
        const p = r.parametros as Record<string, unknown>
        const orig = ((p.fracciones_origen as number[]) || []).join(',')
        const dest = ((p.fracciones_destino as number[]) || []).join(',')
        return `${orig}→${dest}`
      })
    )

    const newRows = []
    for (let i = 0; i < ordered.length - 1; i++) {
      const key = `${ordered[i].fracs.join(',')}→${ordered[i + 1].fracs.join(',')}`
      if (!existingKeys.has(key)) {
        newRows.push({
          semana: null,
          tipo: 'PRECEDENCIA_OPERACION' as ConstraintType,
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

  async function deleteAll() {
    const ids = reglas.map((r) => r.id)
    if (ids.length === 0) return
    await supabase.from('restricciones').delete().in('id', ids)
    setReglas([])
    setLoteMinimo('')
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

  async function toggleActiva(id: string, activa: boolean) {
    await supabase.from('restricciones').update({ activa }).eq('id', id)
    await load()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
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
              <span className="text-xs text-muted-foreground">
                Arrastra operaciones a las cascadas. Haz clic en una flecha para editar buffer o eliminar.
              </span>
            </div>

            {/* Cascada + Flujo de Proceso */}
            <Tabs defaultValue="cascada">
              <TabsList>
                <TabsTrigger value="cascada">Cascada</TabsTrigger>
                <TabsTrigger value="flujo">Flujo de Proceso</TabsTrigger>
              </TabsList>
              <TabsContent value="cascada">
                <CascadeEditor
                  operaciones={operaciones}
                  reglas={precedencias}
                  onConnect={createPrecedencia}
                  onDeleteEdge={deleteRegla}
                  onUpdateBuffer={updateBuffer}
                  title={`Cascada-${modeloNum}`}
                />
              </TabsContent>
              <TabsContent value="flujo">
                <ProcessFlowDiagram
                  operaciones={operaciones}
                  reglas={precedencias}
                  modeloNum={modeloNum}
                />
              </TabsContent>
            </Tabs>

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
