'use client'

import { useState } from 'react'
import type { OperarioFull } from '@/lib/hooks/useOperarios'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  SKILL_GROUPS, SKILL_LABELS, NIVEL_LABELS, NIVEL_COLORS,
  type SkillType, type DayName, type NivelHabilidad, type HabilidadConNivel,
} from '@/types'

export function OperarioForm({
  operario,
  onSave,
  onCancel,
}: {
  operario: OperarioFull | null
  onSave: (data: {
    id?: string; nombre: string; fabrica_id: string | null
    eficiencia: number; activo: boolean
    habilidades: SkillType[]; habilidades_nivel: HabilidadConNivel[]
    dias: DayName[]
  }) => Promise<void>
  onCancel: () => void
}) {
  const [nombre, setNombre] = useState(operario?.nombre || '')
  const [eficiencia, setEficiencia] = useState(operario?.eficiencia || 1.0)
  const [activo, setActivo] = useState(operario?.activo ?? true)
  const [sabado, setSabado] = useState(operario?.dias?.includes('Sab') ?? false)
  const [saving, setSaving] = useState(false)

  // Map of skill → nivel (only for enabled skills)
  const initNiveles = new Map<SkillType, NivelHabilidad>(
    (operario?.habilidades_nivel || []).map((hn) => [hn.habilidad, hn.nivel])
  )
  const [niveles, setNiveles] = useState<Map<SkillType, NivelHabilidad>>(initNiveles)

  const habilidades = Array.from(niveles.keys())

  function toggleSkill(s: SkillType) {
    setNiveles((prev) => {
      const next = new Map(prev)
      if (next.has(s)) {
        next.delete(s)
      } else {
        next.set(s, 2) // default nivel=2 (Normal)
      }
      return next
    })
  }

  function setNivel(s: SkillType, nivel: NivelHabilidad) {
    setNiveles((prev) => {
      const next = new Map(prev)
      next.set(s, nivel)
      return next
    })
  }

  function toggleGroup(groupSkills: SkillType[]) {
    const allSelected = groupSkills.every((s) => niveles.has(s))
    setNiveles((prev) => {
      const next = new Map(prev)
      if (allSelected) {
        groupSkills.forEach((s) => next.delete(s))
      } else {
        groupSkills.forEach((s) => { if (!next.has(s)) next.set(s, 2) })
      }
      return next
    })
  }

  async function handleSubmit() {
    if (!nombre.trim()) return
    setSaving(true)
    const dias: DayName[] = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie']
    if (sabado) dias.push('Sab')
    const habsNivel: HabilidadConNivel[] = Array.from(niveles.entries()).map(
      ([habilidad, nivel]) => ({ habilidad, nivel })
    )
    await onSave({
      id: operario?.id,
      nombre: nombre.trim().toUpperCase(),
      fabrica_id: null,
      eficiencia,
      activo,
      habilidades,
      habilidades_nivel: habsNivel,
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

        {/* Habilidades agrupadas con nivel */}
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <Label className="text-xs font-semibold">Habilidades</Label>
            <div className="flex gap-2 text-[10px] text-muted-foreground">
              {([1, 2, 3] as NivelHabilidad[]).map((n) => (
                <span key={n} className="flex items-center gap-0.5">
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ backgroundColor: NIVEL_COLORS[n] }}
                  />
                  {NIVEL_LABELS[n]}
                </span>
              ))}
            </div>
          </div>
          {Object.entries(SKILL_GROUPS).map(([key, group]) => {
            const allSelected = group.skills.every((s) => niveles.has(s))
            const someSelected = group.skills.some((s) => niveles.has(s))
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
                    ({group.skills.filter((s) => niveles.has(s)).length}/{group.skills.length})
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 ml-6">
                  {group.skills.map((s) => {
                    const enabled = niveles.has(s)
                    const nivel = niveles.get(s) ?? 2
                    return (
                      <div key={s} className="flex items-center gap-1.5">
                        <Checkbox
                          checked={enabled}
                          onCheckedChange={() => toggleSkill(s)}
                        />
                        <span className="text-xs min-w-[70px]">{SKILL_LABELS[s]}</span>
                        {enabled && (
                          <div className="flex gap-0.5">
                            {([1, 2, 3] as NivelHabilidad[]).map((n) => (
                              <button
                                key={n}
                                type="button"
                                onClick={() => setNivel(s, n)}
                                className="w-4 h-4 rounded-full border transition-all"
                                style={{
                                  backgroundColor: nivel >= n ? NIVEL_COLORS[n] : 'transparent',
                                  borderColor: NIVEL_COLORS[n],
                                  opacity: nivel >= n ? 1 : 0.3,
                                }}
                                title={NIVEL_LABELS[n]}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
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
              setNiveles(new Map())
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
