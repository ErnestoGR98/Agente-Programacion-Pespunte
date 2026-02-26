'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import type { ProcessType, ResourceType, Robot } from '@/types'
import type { OperacionFull } from '@/lib/hooks/useCatalogo'

const PROCESS_TYPES: ProcessType[] = ['PRELIMINARES', 'ROBOT', 'POST', 'MAQUILA', 'N/A PRELIMINAR']
const RESOURCE_TYPES: ResourceType[] = ['MESA', 'ROBOT', 'PLANA', 'POSTE', 'MAQUILA', 'GENERAL']
const ETAPA_BASE = ['ROBOT', 'PRE-ROBOT', 'MESA', 'POST-LINEA', 'POST-PLANA-LINEA', 'ZIGZAG-LINEA', 'MAQUILA']

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  operacion?: OperacionFull | null
  robots: Robot[]
  nextFraccion: number
  existingEtapas?: string[]
  existingRecursos?: string[]
  onSave: (data: {
    id?: string
    fraccion: number; operacion: string; input_o_proceso: ProcessType
    etapa: string; recurso: ResourceType; rate: number; sec_per_pair: number
    robotIds: string[]
  }) => Promise<void>
}

export function OperacionDialog({ open, onOpenChange, operacion, robots, nextFraccion, existingEtapas = [], existingRecursos = [], onSave }: Props) {
  const [fraccion, setFraccion] = useState(1)
  const [nombre, setNombre] = useState('')
  const [proceso, setProceso] = useState<ProcessType>('PRELIMINARES')
  const [etapa, setEtapa] = useState('')
  const [recursos, setRecursos] = useState<string[]>(['MESA'])
  const [rate, setRate] = useState(0)
  const [selectedRobots, setSelectedRobots] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const allRecursos = [...new Set([...RESOURCE_TYPES, ...existingRecursos])]

  useEffect(() => {
    if (open) {
      if (operacion) {
        setFraccion(operacion.fraccion)
        setNombre(operacion.operacion)
        setProceso(operacion.input_o_proceso)
        setEtapa(operacion.etapa)
        // Parse comma-separated recurso
        setRecursos(operacion.recurso ? operacion.recurso.split(',').map((s) => s.trim()).filter(Boolean) : ['MESA'])
        setRate(operacion.rate)
        setSelectedRobots(
          robots.filter((r) => operacion.robots.includes(r.nombre)).map((r) => r.id)
        )
      } else {
        setFraccion(nextFraccion)
        setNombre('')
        setProceso('PRELIMINARES')
        setEtapa('')
        setRecursos(['MESA'])
        setRate(0)
        setSelectedRobots([])
      }
    }
  }, [open, operacion, nextFraccion, robots])

  function toggleRecurso(r: string) {
    setRecursos((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]
    )
  }

  function toggleRobot(id: string) {
    setSelectedRobots((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    )
  }

  async function handleSave() {
    if (!nombre.trim() || rate <= 0 || recursos.length === 0) return
    setSaving(true)
    const secPerPair = Math.round(3600 / rate)
    await onSave({
      id: operacion?.id,
      fraccion,
      operacion: nombre.trim(),
      input_o_proceso: proceso,
      etapa: etapa.trim(),
      recurso: recursos.join(',') as ResourceType,
      rate,
      sec_per_pair: secPerPair,
      robotIds: recursos.includes('ROBOT') ? selectedRobots : [],
    })
    setSaving(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{operacion ? 'Editar Operacion' : 'Nueva Operacion'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Fraccion *</Label>
              <Input
                type="number"
                min={1}
                value={fraccion}
                onChange={(e) => setFraccion(parseInt(e.target.value) || 1)}
                className="h-8 font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Rate (pares/hora) *</Label>
              <Input
                type="number"
                min={0}
                step={1}
                value={rate || ''}
                onChange={(e) => setRate(parseFloat(e.target.value) || 0)}
                className="h-8 font-mono"
              />
              {rate > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  = {Math.round(3600 / rate)} sec/par
                </span>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Operacion *</Label>
            <Input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="PEGAR FELPA"
              className="h-8"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Input/Proceso</Label>
              <Select value={proceso} onValueChange={(v) => setProceso(v as ProcessType)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROCESS_TYPES.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Etapa</Label>
              <Select
                value={etapa || '_NONE'}
                onValueChange={(v) => {
                  if (v === '_NEW') {
                    const label = window.prompt('Nombre de la nueva etapa:')?.trim()
                    if (label) setEtapa(label.toUpperCase().replace(/\s+/g, '-'))
                    return
                  }
                  setEtapa(v === '_NONE' ? '' : v)
                }}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_NONE">Sin etapa</SelectItem>
                  {[...new Set([...ETAPA_BASE, ...existingEtapas])].map((et) => (
                    <SelectItem key={et} value={et} className="text-xs">{et}</SelectItem>
                  ))}
                  <SelectItem value="_NEW" className="text-primary font-medium">+ Nueva etapa</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Recurso(s) *</Label>
            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
              {allRecursos.map((r) => (
                <label key={r} className="flex items-center gap-1 text-xs">
                  <Checkbox
                    checked={recursos.includes(r)}
                    onCheckedChange={() => toggleRecurso(r)}
                  />
                  {r}
                </label>
              ))}
              <Link
                href="/configuracion"
                className="text-xs text-primary font-medium hover:underline"
              >
                + Nuevo recurso
              </Link>
            </div>
            {recursos.length === 0 && (
              <p className="text-[10px] text-destructive">Selecciona al menos un recurso</p>
            )}
          </div>

          {recursos.includes('ROBOT') && (
            <div className="space-y-1">
              <Label className="text-xs">Robots Habilitados</Label>
              <div className="flex flex-wrap gap-2">
                {robots.map((r) => (
                  <label key={r.id} className="flex items-center gap-1 text-xs">
                    <Checkbox
                      checked={selectedRobots.includes(r.id)}
                      onCheckedChange={() => toggleRobot(r.id)}
                    />
                    {r.nombre}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button size="sm" onClick={handleSave} disabled={saving || !nombre.trim() || rate <= 0 || recursos.length === 0}>
              {saving ? 'Guardando...' : 'Guardar'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
