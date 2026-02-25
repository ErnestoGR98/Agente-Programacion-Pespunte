'use client'

import { useState, useEffect, useCallback } from 'react'
import type { useRestricciones } from '@/lib/hooks/useRestricciones'
import { useAppStore } from '@/lib/store/useAppStore'
import { supabase } from '@/lib/supabase/client'
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
import { Trash2, Plus } from 'lucide-react'
import { TableExport } from '@/components/shared/TableExport'
import {
  CONSTRAINT_TYPES_TEMPORALES,
  type ConstraintType,
} from '@/types'
import { ConstraintParams } from './ConstraintParams'

interface PedidoModeloItem {
  modelo_num: string
  color: string
}

export function RestriccionesTab({
  data,
  semana,
}: {
  data: ReturnType<typeof useRestricciones>
  semana: string | null
}) {
  const [showForm, setShowForm] = useState(false)
  const [tipo, setTipo] = useState<ConstraintType>('PRIORIDAD')
  const [modelo, setModelo] = useState('*')
  const [params, setParams] = useState<Record<string, unknown>>({})
  const [nota, setNota] = useState('')
  const [modeloItems, setModeloItems] = useState<PedidoModeloItem[]>([])
  const pedidoNombre = useAppStore((s) => s.currentPedidoNombre)

  const loadModelos = useCallback(async () => {
    if (!pedidoNombre) return
    const { data: ped } = await supabase
      .from('pedidos')
      .select('id')
      .eq('nombre', pedidoNombre)
      .single()
    if (!ped) return
    const { data: items } = await supabase
      .from('pedido_items')
      .select('modelo_num, color')
      .eq('pedido_id', ped.id)
      .order('modelo_num')
    if (items) setModeloItems(items)
  }, [pedidoNombre])

  useEffect(() => { loadModelos() }, [loadModelos])

  // Tipos donde el modelo se especifica en los parametros, no en el campo principal
  const TIPOS_SIN_MODELO: ConstraintType[] = [
    'SECUENCIA', 'AGRUPAR_MODELOS',         // modelos en params
    'ROBOT_NO_DISPONIBLE',                   // aplica a un robot
    'AUSENCIA_OPERARIO', 'CAPACIDAD_DIA',    // aplica a plantilla/dia
  ]
  const hideModelo = TIPOS_SIN_MODELO.includes(tipo)

  async function handleAdd() {
    const parametros = nota ? { ...params, nota } : params
    await data.addRestriccion({
      semana: semana,
      tipo,
      modelo_num: modelo,
      activa: true,
      parametros,
    })
    setShowForm(false)
    setModelo('*')
    setParams({})
    setNota('')
  }

  return (
    <div className="space-y-4 mt-4">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <KpiCard label="Total" value={data.restricciones.length} />
        <KpiCard label="Activas" value={data.activas} />
        <KpiCard label="Inactivas" value={data.inactivas} />
      </div>

      {/* Add button */}
      <Button size="sm" onClick={() => setShowForm(!showForm)}>
        <Plus className="mr-1 h-3 w-3" /> Agregar Restriccion
      </Button>

      {/* Add form */}
      {showForm && (
        <Card>
          <CardHeader><CardTitle className="text-base">Nueva Restriccion</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className={`grid gap-4 ${hideModelo ? 'grid-cols-2' : 'grid-cols-3'}`}>
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
                    {CONSTRAINT_TYPES_TEMPORALES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!hideModelo && (
                <div className="space-y-1">
                  <Label className="text-xs">Modelo</Label>
                  <Select value={modelo} onValueChange={setModelo}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="*">* (Todos)</SelectItem>
                      {modeloItems.map((item, i) => (
                        <SelectItem key={`${item.modelo_num}-${item.color}-${i}`} value={item.modelo_num}>
                          {item.modelo_num} — {item.color}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs">Nota</Label>
                <Input value={nota} onChange={(e) => setNota(e.target.value)} className="h-8" />
              </div>
            </div>

            {/* Dynamic params */}
            <ConstraintParams tipo={tipo} params={params} setParams={setParams} modeloItems={modeloItems} />

            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd}>Agregar</Button>
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-0">
          <CardTitle className="text-base">Restricciones</CardTitle>
          <TableExport
            title="Restricciones"
            headers={['Tipo', 'Modelo', 'Alternativa', 'Parametros', 'Activa']}
            rows={data.restricciones.map((r) => {
              const { nota: _nota, ...rest } = (r.parametros || {}) as Record<string, unknown>
              const display = Object.keys(rest).length > 0 ? JSON.stringify(rest) : ''
              const paramStr = _nota ? `${display} (${_nota})` : display
              const alternativa = r.modelo_num !== '*'
                ? modeloItems.find((m) => m.modelo_num === r.modelo_num)?.color || ''
                : ''
              return [r.tipo, r.modelo_num, alternativa, paramStr, r.activa ? 'Si' : 'No']
            })}
          />
        </CardHeader>
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead>Alternativa</TableHead>
                <TableHead>Parametros</TableHead>
                <TableHead>Activa</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.restricciones.map((r) => (
                <TableRow key={r.id} className={!r.activa ? 'opacity-50' : ''}>
                  <TableCell>
                    <Badge variant="secondary">{r.tipo}</Badge>
                  </TableCell>
                  <TableCell className="font-mono">{r.modelo_num}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.modelo_num !== '*'
                      ? modeloItems.find((m) => m.modelo_num === r.modelo_num)?.color || '—'
                      : '—'}
                  </TableCell>
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
                      onCheckedChange={(v) => data.toggleActiva(r.id, v === true)}
                    />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => data.deleteRestriccion(r.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {data.restricciones.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Sin restricciones. Agrega una para comenzar.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
