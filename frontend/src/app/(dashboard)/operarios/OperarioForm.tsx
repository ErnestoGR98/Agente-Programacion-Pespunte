'use client'

import { useState } from 'react'
import type { OperarioFull } from '@/lib/hooks/useOperarios'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { RESOURCE_TYPES, type ResourceType, type DayName } from '@/types'

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
  const [eficiencia, setEficiencia] = useState(operario?.eficiencia || 1.0)
  const [activo, setActivo] = useState(operario?.activo ?? true)
  const [recursos, setRecursos] = useState<ResourceType[]>(operario?.recursos || [])
  const [sabado, setSabado] = useState(operario?.dias?.includes('Sab') ?? false)
  const [saving, setSaving] = useState(false)

  function toggleResource(r: ResourceType) {
    setRecursos((prev) => prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r])
  }

  async function handleSubmit() {
    if (!nombre.trim()) return
    setSaving(true)
    // Auto-assign all robots if ROBOT skill selected
    const robotIdsToSave = recursos.includes('ROBOT') ? robotsList.map((r) => r.id) : []
    const dias: DayName[] = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie']
    if (sabado) dias.push('Sab')
    await onSave({
      id: operario?.id,
      nombre: nombre.trim().toUpperCase(),
      fabrica_id: null,
      eficiencia,
      activo,
      recursos,
      robot_ids: robotIdsToSave,
      dias,
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
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Nombre</Label>
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} className="h-8" />
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

        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2">
            <Checkbox checked={sabado} onCheckedChange={(v) => setSabado(v === true)} />
            <Label className="text-xs">Disponible Sabado</Label>
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={activo} onCheckedChange={(v) => setActivo(v === true)} />
            <Label className="text-xs">Activo</Label>
          </label>
        </div>

        <div className="flex gap-2">
          <Button size="sm" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Guardando...' : operario ? 'Guardar Cambios' : 'Agregar Operario'}
          </Button>
          <Button size="sm" variant="outline" onClick={onCancel}>Cancelar</Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setNombre('')
              setEficiencia(1.0)
              setActivo(true)
              setRecursos([])
              setSabado(false)
            }}
          >
            Limpiar
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
