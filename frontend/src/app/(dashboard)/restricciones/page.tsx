'use client'

import { useState } from 'react'
import { useRestricciones } from '@/lib/hooks/useRestricciones'
import { useAppStore } from '@/lib/store/useAppStore'
import { KpiCard } from '@/components/shared/KpiCard'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Trash2, Plus } from 'lucide-react'
import {
  CONSTRAINT_TYPES_OPERATIVAS, CONSTRAINT_TYPES_PLANIFICACION,
  DAY_NAMES, type ConstraintType,
} from '@/types'

export default function RestriccionesPage() {
  const semana = useAppStore((s) => s.currentSemana)
  const restricciones = useRestricciones(semana || undefined)

  if (restricciones.loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Restricciones</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Reglas de negocio y avance de produccion.
        {semana && <Badge variant="secondary" className="ml-2">{semana}</Badge>}
      </p>

      <Tabs defaultValue="restricciones">
        <TabsList>
          <TabsTrigger value="restricciones">Restricciones</TabsTrigger>
          <TabsTrigger value="avance">Avance de Produccion</TabsTrigger>
        </TabsList>

        <TabsContent value="restricciones">
          <RestriccionesTab data={restricciones} semana={semana} />
        </TabsContent>
        <TabsContent value="avance">
          <div className="mt-4 text-center text-muted-foreground py-8">
            Avance de produccion — disponible cuando haya un pedido cargado.
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function RestriccionesTab({
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

// ============================================================
// Dynamic constraint params form
// ============================================================

function ConstraintParams({
  tipo,
  params,
  setParams,
}: {
  tipo: ConstraintType
  params: Record<string, unknown>
  setParams: (p: Record<string, unknown>) => void
}) {
  function set(key: string, value: unknown) {
    setParams({ ...params, [key]: value })
  }

  switch (tipo) {
    case 'PRIORIDAD':
      return (
        <div className="space-y-1">
          <Label className="text-xs">Peso (1=Normal, 2=Alta, 3=Urgente)</Label>
          <Select value={String(params.peso || 1)} onValueChange={(v) => set('peso', parseInt(v))}>
            <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 - Normal</SelectItem>
              <SelectItem value="2">2 - Alta</SelectItem>
              <SelectItem value="3">3 - Urgente</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )
    case 'MAQUILA':
      return (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Pares a maquilar</Label>
            <Input type="number" min={50} step={50} value={String(params.pares_maquila || '')}
              onChange={(e) => set('pares_maquila', parseInt(e.target.value) || 0)} className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Proveedor</Label>
            <Input value={String(params.proveedor || '')}
              onChange={(e) => set('proveedor', e.target.value)} className="h-8" />
          </div>
        </div>
      )
    case 'RETRASO_MATERIAL':
      return (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Disponible desde</Label>
            <Select value={String(params.disponible_desde || '')} onValueChange={(v) => set('disponible_desde', v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Dia..." /></SelectTrigger>
              <SelectContent>
                {DAY_NAMES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Hora (opcional)</Label>
            <Input value={String(params.hora_disponible || '')}
              onChange={(e) => set('hora_disponible', e.target.value)} className="h-8" placeholder="10:00" />
          </div>
        </div>
      )
    case 'FIJAR_DIA':
      return (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Modo</Label>
            <Select value={String(params.modo || 'PERMITIR')} onValueChange={(v) => set('modo', v)}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="PERMITIR">PERMITIR</SelectItem>
                <SelectItem value="EXCLUIR">EXCLUIR</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Dias</Label>
            <div className="flex gap-2 flex-wrap">
              {DAY_NAMES.map((d) => (
                <label key={d} className="flex items-center gap-1 text-xs">
                  <Checkbox
                    checked={((params.dias as string[]) || []).includes(d)}
                    onCheckedChange={(checked) => {
                      const current = (params.dias as string[]) || []
                      set('dias', checked ? [...current, d] : current.filter((x) => x !== d))
                    }}
                  />
                  {d}
                </label>
              ))}
            </div>
          </div>
        </div>
      )
    case 'FECHA_LIMITE':
      return (
        <div className="space-y-1">
          <Label className="text-xs">Dia limite</Label>
          <Select value={String(params.dia_limite || '')} onValueChange={(v) => set('dia_limite', v)}>
            <SelectTrigger className="h-8 w-32"><SelectValue placeholder="Dia..." /></SelectTrigger>
            <SelectContent>
              {DAY_NAMES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )
    case 'SECUENCIA':
      return (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Modelo antes</Label>
            <Input value={String(params.modelo_antes || '')}
              onChange={(e) => set('modelo_antes', e.target.value)} className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Modelo despues</Label>
            <Input value={String(params.modelo_despues || '')}
              onChange={(e) => set('modelo_despues', e.target.value)} className="h-8" />
          </div>
        </div>
      )
    case 'AGRUPAR_MODELOS':
      return (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Modelo A</Label>
            <Input value={String(params.modelo_a || '')}
              onChange={(e) => set('modelo_a', e.target.value)} className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Modelo B</Label>
            <Input value={String(params.modelo_b || '')}
              onChange={(e) => set('modelo_b', e.target.value)} className="h-8" />
          </div>
        </div>
      )
    case 'AJUSTE_VOLUMEN':
      return (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Nuevo volumen</Label>
            <Input type="number" min={0} step={50} value={String(params.nuevo_volumen || '')}
              onChange={(e) => set('nuevo_volumen', parseInt(e.target.value) || 0)} className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Motivo</Label>
            <Input value={String(params.motivo || '')}
              onChange={(e) => set('motivo', e.target.value)} className="h-8" />
          </div>
        </div>
      )
    case 'LOTE_MINIMO_CUSTOM':
      return (
        <div className="space-y-1">
          <Label className="text-xs">Lote minimo (pares)</Label>
          <Input type="number" min={10} max={500} step={10} value={String(params.lote_minimo || '')}
            onChange={(e) => set('lote_minimo', parseInt(e.target.value) || 0)} className="h-8 w-32" />
        </div>
      )
    case 'ROBOT_NO_DISPONIBLE':
      return (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Robot</Label>
            <Input value={String(params.robot || '')}
              onChange={(e) => set('robot', e.target.value)} className="h-8" placeholder="3020-M4" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Dias</Label>
            <div className="flex gap-2 flex-wrap">
              {DAY_NAMES.map((d) => (
                <label key={d} className="flex items-center gap-1 text-xs">
                  <Checkbox
                    checked={((params.dias as string[]) || []).includes(d)}
                    onCheckedChange={(checked) => {
                      const current = (params.dias as string[]) || []
                      set('dias', checked ? [...current, d] : current.filter((x) => x !== d))
                    }}
                  />
                  {d}
                </label>
              ))}
            </div>
          </div>
        </div>
      )
    case 'AUSENCIA_OPERARIO':
      return (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Dia</Label>
            <Select value={String(params.dia || '')} onValueChange={(v) => set('dia', v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Dia..." /></SelectTrigger>
              <SelectContent>
                {DAY_NAMES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Cantidad ausentes</Label>
            <Input type="number" min={1} value={String(params.cantidad || '')}
              onChange={(e) => set('cantidad', parseInt(e.target.value) || 1)} className="h-8 w-24" />
          </div>
        </div>
      )
    case 'CAPACIDAD_DIA':
      return (
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Dia</Label>
            <Select value={String(params.dia || '')} onValueChange={(v) => set('dia', v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Dia..." /></SelectTrigger>
              <SelectContent>
                {DAY_NAMES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Nueva plantilla</Label>
            <Input type="number" min={1} value={String(params.nueva_plantilla || '')}
              onChange={(e) => set('nueva_plantilla', parseInt(e.target.value) || 0)} className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Motivo</Label>
            <Input value={String(params.motivo || '')}
              onChange={(e) => set('motivo', e.target.value)} className="h-8" />
          </div>
        </div>
      )
    case 'PRECEDENCIA_OPERACION':
      return (
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Fraccion origen</Label>
            <Input type="number" min={1} value={String(params.fraccion_origen || '')}
              onChange={(e) => set('fraccion_origen', parseInt(e.target.value) || 0)} className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Fraccion destino</Label>
            <Input type="number" min={1} value={String(params.fraccion_destino || '')}
              onChange={(e) => set('fraccion_destino', parseInt(e.target.value) || 0)} className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Buffer (pares)</Label>
            <Input type="number" min={0} step={50} value={String(params.buffer_pares || '')}
              onChange={(e) => set('buffer_pares', parseInt(e.target.value) || 0)} className="h-8" />
          </div>
        </div>
      )
    default:
      return null
  }
}
