'use client'

import { useState } from 'react'
import type { OperarioFull } from '@/lib/hooks/useOperarios'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { RESOURCE_TYPES, DAY_NAMES, type ResourceType, type DayName } from '@/types'

export function OperarioForm({
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
