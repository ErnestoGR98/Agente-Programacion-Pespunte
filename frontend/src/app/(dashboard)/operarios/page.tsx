'use client'

import { useState } from 'react'
import { useOperarios, type OperarioFull } from '@/lib/hooks/useOperarios'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Trash2, Plus, Pencil } from 'lucide-react'
import { RESOURCE_TYPES, DAY_NAMES, type ResourceType, type DayName } from '@/types'

export default function OperariosPage() {
  const {
    loading, operarios, fabricas, robotsList, dias,
    toggleActivo, deleteOperario, saveOperario,
  } = useOperarios()
  const [editing, setEditing] = useState<OperarioFull | null>(null)
  const [showForm, setShowForm] = useState(false)

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const activos = operarios.filter((o) => o.activo)
  const inactivos = operarios.filter((o) => !o.activo)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Operarios</h1>
        <p className="text-sm text-muted-foreground">Gestion de personal y headcount.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <KpiCard label="Total" value={operarios.length} />
        <KpiCard label="Activos" value={activos.length} />
        <KpiCard label="Inactivos" value={inactivos.length} />
      </div>

      {/* Boton agregar */}
      <Button
        size="sm"
        onClick={() => { setEditing(null); setShowForm(true) }}
      >
        <Plus className="mr-1 h-3 w-3" /> Agregar Operario
      </Button>

      {/* Formulario */}
      {showForm && (
        <OperarioForm
          operario={editing}
          fabricas={fabricas}
          robotsList={robotsList}
          onSave={async (data) => {
            await saveOperario(data)
            setShowForm(false)
            setEditing(null)
          }}
          onCancel={() => { setShowForm(false); setEditing(null) }}
        />
      )}

      {/* Tabla */}
      <Card>
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Fabrica</TableHead>
                <TableHead>Recursos</TableHead>
                <TableHead>Robots</TableHead>
                <TableHead>Eficiencia</TableHead>
                <TableHead>Dias</TableHead>
                <TableHead>Activo</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operarios.map((op) => (
                <TableRow key={op.id} className={!op.activo ? 'opacity-50' : ''}>
                  <TableCell className="font-medium">{op.nombre}</TableCell>
                  <TableCell>{op.fabrica_nombre}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {op.recursos.map((r) => (
                        <Badge key={r} variant="secondary" className="text-xs">{r}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {op.robots.map((r) => (
                        <Badge key={r} variant="outline" className="text-xs">{r}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{(op.eficiencia * 100).toFixed(0)}%</TableCell>
                  <TableCell className="text-xs">{op.dias.join(', ')}</TableCell>
                  <TableCell>
                    <Checkbox
                      checked={op.activo}
                      onCheckedChange={(v) => toggleActivo(op.id, v === true)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost" size="icon"
                        onClick={() => { setEditing(op); setShowForm(true) }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        onClick={() => deleteOperario(op.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Headcount Validation */}
      <HeadcountTable operarios={activos} dias={dias} />
    </div>
  )
}

// ============================================================
// Formulario de Operario
// ============================================================

function OperarioForm({
  operario,
  fabricas,
  robotsList,
  onSave,
  onCancel,
}: {
  operario: OperarioFull | null
  fabricas: { id: string; nombre: string }[]
  robotsList: { id: string; nombre: string }[]
  onSave: (data: {
    id?: string; nombre: string; fabrica_id: string | null
    eficiencia: number; activo: boolean
    recursos: ResourceType[]; robot_ids: string[]; dias: DayName[]
  }) => Promise<void>
  onCancel: () => void
}) {
  const [nombre, setNombre] = useState(operario?.nombre || '')
  const [fabricaId, setFabricaId] = useState(operario?.fabrica_id || '')
  const [eficiencia, setEficiencia] = useState(operario?.eficiencia || 1.0)
  const [activo, setActivo] = useState(operario?.activo ?? true)
  const [recursos, setRecursos] = useState<ResourceType[]>(operario?.recursos || [])
  const [robotIds, setRobotIds] = useState<string[]>(operario?.robot_ids || [])
  const [selectedDias, setSelectedDias] = useState<DayName[]>(
    operario?.dias || ['Lun', 'Mar', 'Mie', 'Jue', 'Vie']
  )
  const [saving, setSaving] = useState(false)

  function toggleResource(r: ResourceType) {
    setRecursos((prev) => prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r])
  }

  function toggleRobot(id: string) {
    setRobotIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  function toggleDia(d: DayName) {
    setSelectedDias((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d])
  }

  async function handleSubmit() {
    if (!nombre.trim()) return
    setSaving(true)
    await onSave({
      id: operario?.id,
      nombre: nombre.trim().toUpperCase(),
      fabrica_id: fabricaId || null,
      eficiencia,
      activo,
      recursos,
      robot_ids: robotIds,
      dias: selectedDias,
    })
    setSaving(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {operario ? `Editar: ${operario.nombre}` : 'Nuevo Operario'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Nombre</Label>
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Fabrica</Label>
            <Select value={fabricaId} onValueChange={setFabricaId}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
              <SelectContent>
                {fabricas.map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Eficiencia: {(eficiencia * 100).toFixed(0)}%</Label>
            <input
              type="range" min="0.5" max="1.5" step="0.05"
              value={eficiencia}
              onChange={(e) => setEficiencia(parseFloat(e.target.value))}
              className="w-full"
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Recursos Habilitados</Label>
          <div className="flex flex-wrap gap-2">
            {RESOURCE_TYPES.filter(r => r !== 'GENERAL').map((r) => (
              <label key={r} className="flex items-center gap-1 text-xs">
                <Checkbox checked={recursos.includes(r)} onCheckedChange={() => toggleResource(r)} />
                {r}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Robots Habilitados</Label>
          <div className="flex flex-wrap gap-2">
            {robotsList.map((r) => (
              <label key={r.id} className="flex items-center gap-1 text-xs">
                <Checkbox checked={robotIds.includes(r.id)} onCheckedChange={() => toggleRobot(r.id)} />
                {r.nombre}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Dias Disponibles</Label>
          <div className="flex flex-wrap gap-2">
            {DAY_NAMES.map((d) => (
              <label key={d} className="flex items-center gap-1 text-xs">
                <Checkbox checked={selectedDias.includes(d)} onCheckedChange={() => toggleDia(d)} />
                {d}
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox checked={activo} onCheckedChange={(v) => setActivo(v === true)} />
          <Label className="text-xs">Activo</Label>
        </div>

        <div className="flex gap-2">
          <Button size="sm" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Guardando...' : operario ? 'Guardar Cambios' : 'Agregar Operario'}
          </Button>
          <Button size="sm" variant="outline" onClick={onCancel}>Cancelar</Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================
// Headcount Validation Table
// ============================================================

function HeadcountTable({
  operarios,
  dias,
}: {
  operarios: OperarioFull[]
  dias: { nombre: string; plantilla: number }[]
}) {
  const resourceTypes: ResourceType[] = ['MESA', 'ROBOT', 'PLANA', 'POSTE', 'MAQUILA']

  const rows = dias.map((d) => {
    const disponibles = operarios.filter((o) => o.dias.includes(d.nombre as DayName))
    const byResource: Record<string, number> = {}
    for (const rt of resourceTypes) {
      byResource[rt] = disponibles.filter((o) => o.recursos.includes(rt)).length
    }
    return {
      dia: d.nombre,
      plantilla: d.plantilla,
      disponibles: disponibles.length,
      ...byResource,
    }
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Validacion Headcount</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dia</TableHead>
              <TableHead>Plantilla</TableHead>
              <TableHead>Disponibles</TableHead>
              {resourceTypes.map((rt) => (
                <TableHead key={rt}>{rt}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.dia}>
                <TableCell className="font-medium">{row.dia}</TableCell>
                <TableCell>{row.plantilla}</TableCell>
                <TableCell className={row.disponibles < row.plantilla ? 'text-destructive font-bold' : ''}>
                  {row.disponibles}
                </TableCell>
                {resourceTypes.map((rt) => (
                  <TableCell key={rt}>{row[rt as keyof typeof row]}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
