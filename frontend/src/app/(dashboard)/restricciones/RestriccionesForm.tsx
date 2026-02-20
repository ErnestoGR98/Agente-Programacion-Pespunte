'use client'

import { useState } from 'react'
import type { useRestricciones } from '@/lib/hooks/useRestricciones'
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
import {
  CONSTRAINT_TYPES_OPERATIVAS, CONSTRAINT_TYPES_PLANIFICACION,
  type ConstraintType,
} from '@/types'
import { ConstraintParams } from './ConstraintParams'

export function RestriccionesTab({
  data,
  semana,
}: {
  data: ReturnType<typeof useRestricciones>
  semana: string | null
}) {
  const [showForm, setShowForm] = useState(false)
  const [categoria, setCategoria] = useState<'operativas' | 'planificacion'>('operativas')
  const [tipo, setTipo] = useState<ConstraintType>('PRIORIDAD')
  const [modelo, setModelo] = useState('*')
  const [params, setParams] = useState<Record<string, unknown>>({})
  const [nota, setNota] = useState('')

  const tipos = categoria === 'operativas'
    ? CONSTRAINT_TYPES_OPERATIVAS
    : CONSTRAINT_TYPES_PLANIFICACION

  async function handleAdd() {
    await data.addRestriccion({
      semana: semana,
      tipo,
      modelo_num: modelo,
      activa: true,
      parametros: params,
    })
    setShowForm(false)
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
            <div className="grid grid-cols-4 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Categoria</Label>
                <Select
                  value={categoria}
                  onValueChange={(v) => {
                    const cat = v as 'operativas' | 'planificacion'
                    setCategoria(cat)
                    setTipo(cat === 'operativas' ? 'PRIORIDAD' : 'FIJAR_DIA')
                  }}
                >
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="operativas">Operativas</SelectItem>
                    <SelectItem value="planificacion">Planificacion</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tipo</Label>
                <Select value={tipo} onValueChange={(v) => { setTipo(v as ConstraintType); setParams({}) }}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {tipos.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Modelo</Label>
                <Input value={modelo} onChange={(e) => setModelo(e.target.value)} className="h-8" placeholder="* = todos" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nota</Label>
                <Input value={nota} onChange={(e) => setNota(e.target.value)} className="h-8" />
              </div>
            </div>

            {/* Dynamic params */}
            <ConstraintParams tipo={tipo} params={params} setParams={setParams} />

            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd}>Agregar</Button>
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
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
              {data.restricciones.map((r) => (
                <TableRow key={r.id} className={!r.activa ? 'opacity-50' : ''}>
                  <TableCell>
                    <Badge variant="secondary">{r.tipo}</Badge>
                  </TableCell>
                  <TableCell className="font-mono">{r.modelo_num}</TableCell>
                  <TableCell className="text-xs max-w-xs truncate">
                    {JSON.stringify(r.parametros)}
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
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
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
