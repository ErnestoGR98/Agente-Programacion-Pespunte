'use client'

import { useState } from 'react'
import type { OperarioFull } from '@/lib/hooks/useOperarios'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { SKILL_GROUPS, SKILL_LABELS, type SkillType, type DayName } from '@/types'

export function OperarioForm({
  operario,
  onSave,
  onCancel,
}: {
  operario: OperarioFull | null
  onSave: (data: {
    id?: string; nombre: string; fabrica_id: string | null
    eficiencia: number; activo: boolean
    habilidades: SkillType[]; dias: DayName[]
  }) => Promise<void>
  onCancel: () => void
}) {
  const [nombre, setNombre] = useState(operario?.nombre || '')
  const [eficiencia, setEficiencia] = useState(operario?.eficiencia || 1.0)
  const [activo, setActivo] = useState(operario?.activo ?? true)
  const [habilidades, setHabilidades] = useState<SkillType[]>(operario?.habilidades || [])
  const [sabado, setSabado] = useState(operario?.dias?.includes('Sab') ?? false)
  const [saving, setSaving] = useState(false)

  function toggleSkill(s: SkillType) {
    setHabilidades((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])
  }

  function toggleGroup(groupSkills: SkillType[]) {
    const allSelected = groupSkills.every((s) => habilidades.includes(s))
    if (allSelected) {
      setHabilidades((prev) => prev.filter((s) => !groupSkills.includes(s)))
    } else {
      setHabilidades((prev) => [...new Set([...prev, ...groupSkills])])
    }
  }

  async function handleSubmit() {
    if (!nombre.trim()) return
    setSaving(true)
    const dias: DayName[] = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie']
    if (sabado) dias.push('Sab')
    await onSave({
      id: operario?.id,
      nombre: nombre.trim().toUpperCase(),
      fabrica_id: null,
      eficiencia,
      activo,
      habilidades,
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

        {/* Habilidades agrupadas */}
        <div className="space-y-3">
          <Label className="text-xs font-semibold">Habilidades</Label>
          {Object.entries(SKILL_GROUPS).map(([key, group]) => {
            const allSelected = group.skills.every((s) => habilidades.includes(s))
            const someSelected = group.skills.some((s) => habilidades.includes(s))
            return (
              <div key={key} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={allSelected}
                    className={someSelected && !allSelected ? 'opacity-50' : ''}
                    onCheckedChange={() => toggleGroup(group.skills)}
                  />
                  <span
                    className="text-xs font-medium px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: group.color + '20', color: group.color }}
                  >
                    {group.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({group.skills.filter((s) => habilidades.includes(s)).length}/{group.skills.length})
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 ml-6">
                  {group.skills.map((s) => (
                    <label key={s} className="flex items-center gap-1 text-xs">
                      <Checkbox
                        checked={habilidades.includes(s)}
                        onCheckedChange={() => toggleSkill(s)}
                      />
                      {SKILL_LABELS[s]}
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
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
              setHabilidades([])
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
