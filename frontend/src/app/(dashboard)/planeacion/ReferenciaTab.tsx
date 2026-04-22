'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase/client'
import { useCatalogo } from '@/lib/hooks/useCatalogo'
import { useProfile } from '@/lib/hooks/useProfile'
import type { Restriccion, ConstraintType } from '@/types'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, Trash2, Wand2, FileText, Workflow, GitBranch } from 'lucide-react'
import { CascadeEditor } from '@/components/shared/CascadeEditor'
import { ProcessFlowDiagram } from '@/components/shared/ProcessFlowDiagram'
import { STAGE_COLORS } from '@/types'

const STAGE_BADGE: Record<string, string> = {
  PRELIMINAR: STAGE_COLORS.PRELIMINAR,
  ROBOT: STAGE_COLORS.ROBOT,
  POST: STAGE_COLORS.POST,
  MAQUILA: STAGE_COLORS.MAQUILA,
  'N/A PRELIMINAR': STAGE_COLORS['N/A PRELIMINAR'],
}

export function ReferenciaTab() {
  const { modelos, loading: loadingCat } = useCatalogo()
  const { isAdmin } = useProfile()
  const [modeloNum, setModeloNum] = useState<string>('')
  const [reglas, setReglas] = useState<Restriccion[]>([])
  const [loadingReglas, setLoadingReglas] = useState(false)
  const [subtab, setSubtab] = useState<'operaciones' | 'cursograma' | 'precedencias'>('operaciones')


  // Pre-seleccionar el primer modelo cuando termina de cargar el catalogo
  useEffect(() => {
    if (!modeloNum && modelos.length > 0) setModeloNum(modelos[0].modelo_num)
  }, [modelos, modeloNum])

  const modeloSel = useMemo(
    () => modelos.find((m) => m.modelo_num === modeloNum),
    [modelos, modeloNum],
  )
  const operaciones = modeloSel?.operaciones ?? []

  const loadReglas = useCallback(async () => {
    if (!modeloNum) return
    setLoadingReglas(true)
    const { data } = await supabase
      .from('restricciones')
      .select('*')
      .is('semana', null)
      .eq('modelo_num', modeloNum)
      .order('created_at')
    setReglas(data || [])
    setLoadingReglas(false)
  }, [modeloNum])

  useEffect(() => { loadReglas() }, [loadReglas])

  const precedencias = useMemo(
    () => reglas.filter((r) => r.tipo === 'PRECEDENCIA_OPERACION'),
    [reglas],
  )

  async function createPrecedencia(origen: number[], destino: number[], buffer: number | 'todo' | 'rate' | 'dia') {
    await supabase.from('restricciones').insert({
      semana: null,
      tipo: 'PRECEDENCIA_OPERACION' as ConstraintType,
      modelo_num: modeloNum,
      activa: true,
      parametros: {
        fracciones_origen: origen,
        fracciones_destino: destino,
        buffer_pares: buffer,
      },
    })
    await loadReglas()
  }

  async function deleteRegla(id: string) {
    await supabase.from('restricciones').delete().eq('id', id)
    await loadReglas()
  }

  async function updateBuffer(id: string, buffer: number | 'todo' | 'rate' | 'dia') {
    const regla = reglas.find((r) => r.id === id)
    if (!regla) return
    const parametros = { ...regla.parametros as Record<string, unknown>, buffer_pares: buffer }
    await supabase.from('restricciones').update({ parametros }).eq('id', id)
    await loadReglas()
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
      }),
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
      await loadReglas()
    }
  }

  async function deletePrecedencias() {
    const ids = precedencias.map((r) => r.id)
    if (ids.length === 0) return
    await supabase.from('restricciones').delete().in('id', ids)
    await loadReglas()
  }

  const totalSecs = operaciones.reduce((a, op) => a + (op.sec_per_pair || 0), 0)

  if (loadingCat) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Selector + KPIs del modelo */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3">
              {modeloSel?.imagen_url && (
                <img
                  src={modeloSel.imagen_url}
                  alt={modeloSel.modelo_num}
                  className="h-14 w-14 rounded-md object-cover border bg-white"
                />
              )}
              <div className="min-w-[220px]">
                <div className="text-xs text-muted-foreground mb-1">Modelo</div>
                <Select value={modeloNum} onValueChange={setModeloNum}>
                  <SelectTrigger className="h-9 font-mono">
                    <SelectValue placeholder="Elegi un modelo" />
                  </SelectTrigger>
                  <SelectContent>
                    {modelos.map((m) => (
                      <SelectItem key={m.id} value={m.modelo_num} className="font-mono">
                        {m.modelo_num}
                        {m.alternativas.length > 0 && (
                          <span className="text-muted-foreground ml-2">
                            ({m.alternativas.join(', ')})
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {modeloSel && (
              <div className="flex gap-4 ml-auto text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Operaciones</div>
                  <div className="font-semibold">{operaciones.length}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Tiempo / par</div>
                  <div className="font-semibold">{(totalSecs / 60).toFixed(2)} min</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Precedencias</div>
                  <div className="font-semibold">{precedencias.length}</div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {!modeloSel ? (
        <div className="text-center text-sm text-muted-foreground py-8">
          Selecciona un modelo para ver su catalogo, cursograma y precedencias.
        </div>
      ) : (
        <Tabs value={subtab} onValueChange={(v) => setSubtab(v as typeof subtab)}>
          <TabsList>
            <TabsTrigger value="operaciones" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Catalogo de operaciones
            </TabsTrigger>
            <TabsTrigger value="cursograma" className="gap-1.5">
              <Workflow className="h-3.5 w-3.5" /> Cursograma
            </TabsTrigger>
            <TabsTrigger value="precedencias" className="gap-1.5">
              <GitBranch className="h-3.5 w-3.5" /> Precedencias
            </TabsTrigger>
          </TabsList>

          {/* Catalogo de operaciones */}
          <TabsContent value="operaciones" className="mt-4">
            <Card>
              <CardContent className="p-0 overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                      <th className="text-left p-2 pl-4">#</th>
                      <th className="text-left p-2">Operacion</th>
                      <th className="text-left p-2">Proceso</th>
                      <th className="text-left p-2">Etapa</th>
                      <th className="text-left p-2">Recurso</th>
                      <th className="text-right p-2">Rate</th>
                      <th className="text-right p-2 pr-4">Sec/par</th>
                    </tr>
                  </thead>
                  <tbody>
                    {operaciones.slice().sort((a, b) => a.fraccion - b.fraccion).map((op) => {
                      const badgeColor = STAGE_BADGE[op.etapa] || '#9ca3af'
                      return (
                        <tr key={op.id} className="border-b hover:bg-muted/20">
                          <td className="p-2 pl-4 font-mono text-xs">{op.fraccion}</td>
                          <td className="p-2">{op.operacion}</td>
                          <td className="p-2 text-xs text-muted-foreground">{op.input_o_proceso}</td>
                          <td className="p-2">
                            {op.etapa && (
                              <span
                                className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium text-white"
                                style={{ backgroundColor: badgeColor }}
                              >
                                {op.etapa}
                              </span>
                            )}
                          </td>
                          <td className="p-2 text-xs">{op.recurso}</td>
                          <td className="p-2 text-right font-mono text-xs">{op.rate}</td>
                          <td className="p-2 pr-4 text-right font-mono text-xs">{op.sec_per_pair}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-muted/40 text-xs">
                      <td colSpan={6} className="p-2 pl-4 text-right font-medium">Total</td>
                      <td className="p-2 pr-4 text-right font-mono font-semibold">{totalSecs}</td>
                    </tr>
                  </tfoot>
                </table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Cursograma */}
          <TabsContent value="cursograma" className="mt-4">
            <Card>
              <CardContent className="p-4">
                <ProcessFlowDiagram
                  operaciones={operaciones}
                  reglas={precedencias}
                  modeloNum={modeloNum}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Precedencias */}
          <TabsContent value="precedencias" className="mt-4">
            <Card>
              <CardContent className="p-4 space-y-4">
                {isAdmin && (
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={autoGenerateBlocks}>
                      <Wand2 className="mr-1 h-3 w-3" /> Auto-generar por bloques
                    </Button>
                    {precedencias.length > 0 && (
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={deletePrecedencias}>
                        <Trash2 className="mr-1 h-3 w-3" /> Borrar todas
                      </Button>
                    )}
                    <span className="text-xs text-muted-foreground max-w-[420px]">
                      Arrastra operaciones a las cascadas. Click en una flecha para editar buffer o eliminar.
                    </span>
                  </div>
                )}
                {loadingReglas ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : (
                  <CascadeEditor
                    operaciones={operaciones}
                    reglas={precedencias}
                    onConnect={createPrecedencia}
                    onDeleteEdge={deleteRegla}
                    onUpdateBuffer={updateBuffer}
                    title={`Cascada-${modeloNum}`}
                    readOnly={!isAdmin}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

