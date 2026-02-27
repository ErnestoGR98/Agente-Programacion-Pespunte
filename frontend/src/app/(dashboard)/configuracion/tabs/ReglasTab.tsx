'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useReglas } from '@/lib/hooks/useReglas'
import { supabase } from '@/lib/supabase/client'
import type { OperacionFull } from '@/lib/hooks/useCatalogo'
import { KpiCard } from '@/components/shared/KpiCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Trash2, Plus, Wand2 } from 'lucide-react'
import { TableExport } from '@/components/shared/TableExport'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { CONSTRAINT_TYPES_PERMANENTES, type ConstraintType } from '@/types'
import { ConstraintParams } from '@/app/(dashboard)/restricciones/ConstraintParams'
import { CascadeEditor } from '@/components/shared/CascadeEditor'

interface CatalogoModelo {
  modelo_num: string
  clave_material: string
}

export function ReglasTab() {
  const reglas = useReglas()
  const [showForm, setShowForm] = useState(false)
  const [tipo, setTipo] = useState<ConstraintType>('PRECEDENCIA_OPERACION')
  const [modelo, setModelo] = useState('')
  const [params, setParams] = useState<Record<string, unknown>>({})
  const [nota, setNota] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [showClearAll, setShowClearAll] = useState(false)
  const [modeloItems, setModeloItems] = useState<{ modelo_num: string; color: string }[]>([])
  const [operaciones, setOperaciones] = useState<OperacionFull[]>([])

  const loadModelos = useCallback(async () => {
    const { data: modelos } = await supabase
      .from('catalogo_modelos')
      .select('modelo_num, clave_material')
      .order('modelo_num')
    if (modelos) {
      setModeloItems(modelos.map((m: CatalogoModelo) => ({
        modelo_num: m.modelo_num,
        color: m.clave_material,
      })))
    }
  }, [])

  useEffect(() => { loadModelos() }, [loadModelos])

  // Load operaciones for graph when modelo changes (PRECEDENCIA)
  const loadOperaciones = useCallback(async () => {
    if (!modelo || modelo === '*') { setOperaciones([]); return }
    const { data: mod } = await supabase
      .from('catalogo_modelos')
      .select('id')
      .eq('modelo_num', modelo)
      .single()
    if (!mod) { setOperaciones([]); return }
    const { data: ops } = await supabase
      .from('catalogo_operaciones')
      .select('id, fraccion, operacion, input_o_proceso, etapa, recurso, recurso_raw, rate, sec_per_pair')
      .eq('modelo_id', mod.id)
      .order('fraccion')
    if (ops) {
      // Load robots for each operation
      const opIds = ops.map((o: { id: string }) => o.id)
      const { data: robotLinks } = await supabase
        .from('catalogo_operaciones_robots')
        .select('operacion_id, robot_id')
        .in('operacion_id', opIds)
      const robotMap = new Map<string, string[]>()
      for (const link of (robotLinks || [])) {
        const list = robotMap.get(link.operacion_id) || []
        list.push(link.robot_id)
        robotMap.set(link.operacion_id, list)
      }
      setOperaciones(ops.map((o: Record<string, unknown>) => ({
        ...o,
        robots: robotMap.get(o.id as string) || [],
      })) as OperacionFull[])
    }
  }, [modelo])

  useEffect(() => {
    if (tipo === 'PRECEDENCIA_OPERACION') loadOperaciones()
  }, [tipo, loadOperaciones])

  // Tipos donde el modelo se especifica en los parametros
  const TIPOS_SIN_MODELO: ConstraintType[] = [
    'SECUENCIA', 'AGRUPAR_MODELOS',
  ]
  const hideModelo = TIPOS_SIN_MODELO.includes(tipo)

  // Whether to show the graph for PRECEDENCIA
  const showGraph = tipo === 'PRECEDENCIA_OPERACION' && modelo && modelo !== '*' && operaciones.length > 0

  // Filter precedencia rules for the selected model (for graph)
  const precedenciasForModel = useMemo(
    () => reglas.reglas.filter((r) => r.tipo === 'PRECEDENCIA_OPERACION' && r.modelo_num === modelo),
    [reglas.reglas, modelo],
  )

  // --- Graph callbacks ---
  async function graphCreatePrecedencia(fracsOrig: number[], fracsDest: number[], buffer: number | 'todo') {
    await reglas.addRegla({
      tipo: 'PRECEDENCIA_OPERACION',
      modelo_num: modelo,
      activa: true,
      parametros: {
        fracciones_origen: fracsOrig,
        fracciones_destino: fracsDest,
        buffer_pares: buffer,
      },
    })
  }

  async function graphUpdateBuffer(id: string, buffer: number | 'todo') {
    const regla = reglas.reglas.find((r) => r.id === id)
    if (!regla) return
    const parametros = { ...regla.parametros as Record<string, unknown>, buffer_pares: buffer }
    const { error } = await supabase.from('restricciones').update({ parametros }).eq('id', id)
    if (error) {
      console.error('[ReglasTab] graphUpdateBuffer failed:', error)
      throw error
    }
    await reglas.reload()
  }

  async function graphAutoGenerate() {
    // Group fracciones by input_o_proceso
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
      precedenciasForModel.map((r) => {
        const p = r.parametros as Record<string, unknown>
        const orig = ((p.fracciones_origen as number[]) || []).join(',')
        const dest = ((p.fracciones_destino as number[]) || []).join(',')
        return `${orig}->${dest}`
      })
    )

    const newRows = []
    for (let i = 0; i < ordered.length - 1; i++) {
      const key = `${ordered[i].fracs.join(',')}->${ordered[i + 1].fracs.join(',')}`
      if (!existingKeys.has(key)) {
        newRows.push({
          semana: null,
          tipo: 'PRECEDENCIA_OPERACION' as ConstraintType,
          modelo_num: modelo,
          activa: true,
          parametros: {
            fracciones_origen: ordered[i].fracs,
            fracciones_destino: ordered[i + 1].fracs,
            buffer_pares: 0,
            nota: `${ordered[i].proceso} -> ${ordered[i + 1].proceso}`,
          },
        })
      }
    }
    if (newRows.length > 0) {
      await supabase.from('restricciones').insert(newRows)
      await reglas.reload()
    }
  }

  async function handleAdd() {
    const parametros = nota ? { ...params, nota } : params
    await reglas.addRegla({
      tipo,
      modelo_num: hideModelo ? '*' : modelo,
      activa: true,
      parametros,
    })
    setShowForm(false)
    setModelo('')
    setParams({})
    setNota('')
  }

  if (reglas.loading) return null

  return (
    <div className="space-y-4 mt-4">
      <p className="text-sm text-muted-foreground">
        Reglas permanentes que aplican automaticamente en toda optimizacion. No dependen de la semana.
        Tambien puedes auto-generar precedencias desde el boton <strong>Reglas</strong> en cada modelo del Catalogo.
      </p>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <KpiCard label="Total" value={reglas.reglas.length} />
        <KpiCard label="Activas" value={reglas.activas} />
        <KpiCard label="Inactivas" value={reglas.inactivas} />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="mr-1 h-3 w-3" /> Agregar Regla
        </Button>
        {reglas.reglas.length > 0 && (
          <Button size="sm" variant="ghost" className="text-destructive"
            onClick={() => setShowClearAll(true)}
          >
            <Trash2 className="mr-1 h-3 w-3" /> Limpiar todas
          </Button>
        )}
      </div>

      {/* Add form */}
      {showForm && (
        <Card>
          <CardHeader><CardTitle className="text-base">Nueva Regla</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className={`grid gap-4 ${hideModelo ? 'grid-cols-2' : (tipo === 'PRECEDENCIA_OPERACION' ? 'grid-cols-2' : 'grid-cols-3')}`}>
              <div className="space-y-1">
                <Label className="text-xs">Tipo</Label>
                <Select value={tipo} onValueChange={(v) => {
                  const newTipo = v as ConstraintType
                  setTipo(newTipo)
                  setParams({})
                  if (TIPOS_SIN_MODELO.includes(newTipo)) setModelo('*')
                }}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CONSTRAINT_TYPES_PERMANENTES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!hideModelo && (
                <div className="space-y-1">
                  <Label className="text-xs">Modelo</Label>
                  <Select value={modelo} onValueChange={setModelo}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="Seleccionar modelo..." /></SelectTrigger>
                    <SelectContent>
                      {modeloItems.map((item, i) => (
                        <SelectItem key={`${item.modelo_num}-${item.color}-${i}`} value={item.modelo_num}>
                          {item.modelo_num} — {item.color}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {!showGraph && (
                <div className="space-y-1">
                  <Label className="text-xs">Nota</Label>
                  <Input value={nota} onChange={(e) => setNota(e.target.value)} className="h-8" />
                </div>
              )}
            </div>

            {/* PRECEDENCIA → Cascade editor with drag-and-drop */}
            {showGraph ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={graphAutoGenerate}>
                    <Wand2 className="mr-1 h-3 w-3" /> Auto-generar por bloques
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Arrastra operaciones a las cascadas. Haz clic en una flecha para editar buffer o eliminar.
                  </span>
                </div>
                <CascadeEditor
                  operaciones={operaciones}
                  reglas={precedenciasForModel}
                  onConnect={graphCreatePrecedencia}
                  onDeleteEdge={reglas.deleteRegla}
                  onUpdateBuffer={graphUpdateBuffer}
                />
              </div>
            ) : (
              <>
                {/* Dynamic params for non-PRECEDENCIA or when no model selected */}
                <ConstraintParams
                  tipo={tipo}
                  params={params}
                  setParams={setParams}
                  modeloItems={modeloItems}
                  selectedModelo={hideModelo ? undefined : modelo}
                />

                <div className="flex gap-2">
                  <Button size="sm" onClick={handleAdd}>Agregar</Button>
                  <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-0">
          <CardTitle className="text-base">Reglas</CardTitle>
          <TableExport
            title="Reglas Permanentes"
            headers={['Tipo', 'Modelo', 'Parametros', 'Activa']}
            rows={reglas.reglas.map((r) => {
              const { nota: _nota, ...rest } = (r.parametros || {}) as Record<string, unknown>
              const display = Object.keys(rest).length > 0 ? JSON.stringify(rest) : ''
              const paramStr = _nota ? `${display} (${_nota})` : display
              return [r.tipo, r.modelo_num, paramStr, r.activa ? 'Si' : 'No']
            })}
          />
        </CardHeader>
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead>Parametros</TableHead>
                <TableHead>Activa</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reglas.reglas.map((r) => (
                <TableRow key={r.id} className={!r.activa ? 'opacity-50' : ''}>
                  <TableCell>
                    <Badge variant="secondary">{r.tipo}</Badge>
                  </TableCell>
                  <TableCell className="font-mono">{r.modelo_num}</TableCell>
                  <TableCell className="text-xs max-w-xs truncate">
                    {(() => {
                      const { nota: _nota, ...rest } = (r.parametros || {}) as Record<string, unknown>
                      const display = Object.keys(rest).length > 0 ? JSON.stringify(rest) : '—'
                      return _nota ? `${display} (${_nota})` : display
                    })()}
                  </TableCell>
                  <TableCell>
                    <Checkbox
                      checked={r.activa}
                      onCheckedChange={(v) => reglas.toggleActiva(r.id, v === true)}
                    />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteId(r.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {reglas.reglas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    Sin reglas. Agrega una para comenzar.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null) }}
        title="Eliminar Regla"
        description="¿Seguro que deseas eliminar esta regla?"
        onConfirm={() => { if (deleteId) reglas.deleteRegla(deleteId) }}
      />
      <ConfirmDialog
        open={showClearAll}
        onOpenChange={setShowClearAll}
        title="Limpiar Todas las Reglas"
        description="¿Seguro que deseas eliminar TODAS las reglas? Esta accion no se puede deshacer."
        onConfirm={async () => {
          for (const r of reglas.reglas) await reglas.deleteRegla(r.id)
        }}
      />
    </div>
  )
}
