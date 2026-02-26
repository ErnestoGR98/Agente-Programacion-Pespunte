'use client'

import { useState } from 'react'
import type { useConfiguracion } from '@/lib/hooks/useConfiguracion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Trash2, Plus, Minus } from 'lucide-react'
import { TableExport } from '@/components/shared/TableExport'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import {
  ROBOT_TIPOS_BASE, ROBOT_TIPOS_MODS,
  PRELIMINAR_TIPOS_BASE,
  MAQUINA_TIPOS_BASE, MAQUINA_TIPOS_MODS,
  type Robot, type MaquinaTipo,
} from '@/types'

type Config = ReturnType<typeof useConfiguracion>

const ROBOT_BASE_VALUES = ROBOT_TIPOS_BASE.map((t) => t.value)
const PRELIM_BASE_VALUES = PRELIMINAR_TIPOS_BASE.map((t) => t.value)
const MAQUINA_BASE_VALUES = MAQUINA_TIPOS_BASE.map((t) => t.value)

const KNOWN_ROBOT_OR_PESPUNTE = new Set([...ROBOT_BASE_VALUES, ...MAQUINA_BASE_VALUES])

function getCategoria(r: Robot): 'robot' | 'complementaria' | 'pespunte' | 'sin_tipo' {
  if (r.tipos.some((t) => ROBOT_BASE_VALUES.includes(t))) return 'robot'
  if (r.tipos.some((t) => MAQUINA_BASE_VALUES.includes(t))) return 'pespunte'
  // Any machine with tipos that aren't robot/pespunte goes to complementarias
  if (r.tipos.length > 0 && r.tipos.some((t) => !KNOWN_ROBOT_OR_PESPUNTE.has(t))) return 'complementaria'
  return 'sin_tipo'
}

/** Prompt user for a new tipo name and return the normalized value, or null if cancelled/duplicate. */
function promptNewTipo(existing: { value: MaquinaTipo }[]): { value: MaquinaTipo; label: string } | null {
  const label = window.prompt('Nombre del nuevo tipo:')?.trim()
  if (!label) return null
  const value = label.toUpperCase().replace(/\s+/g, '_') as MaquinaTipo
  if (existing.some((t) => t.value === value)) {
    window.alert('Ese tipo ya existe.')
    return null
  }
  return { value, label }
}

function MaquinaSection({
  title,
  items,
  baseTypes,
  mods,
  config,
  onDelete,
}: {
  title: string
  items: Robot[]
  baseTypes: { value: MaquinaTipo; label: string }[]
  mods: { value: MaquinaTipo; label: string }[]
  config: Config
  onDelete: (id: string) => void
}) {
  const [newName, setNewName] = useState('')
  const [newBase, setNewBase] = useState<MaquinaTipo | ''>('')
  const [newMods, setNewMods] = useState<MaquinaTipo[]>([])

  const activos = items.filter((r) => r.estado === 'ACTIVO').length

  // Detect custom base types from data
  const baseSet = new Set(baseTypes.map((t) => t.value))
  const modSet = new Set(mods.map((m) => m.value))
  const customBase: { value: MaquinaTipo; label: string }[] = []
  for (const r of items) {
    for (const t of r.tipos) {
      if (!baseSet.has(t) && !modSet.has(t) && !customBase.some((c) => c.value === t)) {
        customBase.push({ value: t, label: t.replace(/_/g, ' ') })
      }
    }
  }
  const allBaseTypes = [...baseTypes, ...customBase]
  const allBaseValues = allBaseTypes.map((t) => t.value)

  function getBase(r: Robot): MaquinaTipo | '' {
    return r.tipos.find((t) => allBaseValues.includes(t)) || ''
  }

  function handleTipoChange(robotId: string, v: string) {
    if (v === '_NEW') {
      const nt = promptNewTipo(allBaseTypes)
      if (nt) config.setBaseTipo(robotId, nt.value, allBaseValues)
      return
    }
    config.setBaseTipo(robotId, v === '_NONE' ? null : v as MaquinaTipo, allBaseValues)
  }

  function handleNewBaseTipo(v: string) {
    if (v === '_NEW') {
      const nt = promptNewTipo(allBaseTypes)
      if (nt) setNewBase(nt.value)
      return
    }
    setNewBase(v === '_NONE' ? '' : v as MaquinaTipo)
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            {title}
            <Badge variant="secondary" className="text-xs">
              {activos}/{items.length} activos
            </Badge>
          </CardTitle>
          <TableExport
            title={title}
            headers={['Nombre', 'Estado', 'Area', 'Tipo', ...mods.map((m) => m.label)]}
            rows={items.map((r) => {
              const base = allBaseTypes.find((t) => r.tipos.includes(t.value))
              return [
                r.nombre, r.estado, r.area, base?.label || '',
                ...mods.map((m) => r.tipos.includes(m.value) ? 'Si' : ''),
              ]
            })}
          />
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No hay registros. Usa el formulario de abajo para agregar.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Area</TableHead>
                  <TableHead>Tipo</TableHead>
                  {mods.map((m) => (
                    <TableHead key={m.value} className="text-center w-16 text-xs">
                      {m.label}
                    </TableHead>
                  ))}
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <TableRow key={r.id} className={r.estado !== 'ACTIVO' ? 'opacity-50' : ''}>
                    <TableCell>
                      <Input
                        defaultValue={r.nombre}
                        className="h-8 font-mono text-sm w-32"
                        onBlur={(e) => {
                          const v = e.target.value.trim()
                          if (v && v !== r.nombre) config.updateRobot(r.id, { nombre: v })
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={r.estado}
                        onValueChange={(v) => config.updateRobot(r.id, { estado: v as Robot['estado'] })}
                      >
                        <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ACTIVO">ACTIVO</SelectItem>
                          <SelectItem value="FUERA DE SERVICIO">FUERA DE SERVICIO</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={r.area}
                        onValueChange={(v) => config.updateRobot(r.id, { area: v as Robot['area'] })}
                      >
                        <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PESPUNTE">PESPUNTE</SelectItem>
                          <SelectItem value="AVIOS">AVIOS</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={getBase(r) || '_NONE'}
                        onValueChange={(v) => handleTipoChange(r.id, v)}
                      >
                        <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_NONE">Sin tipo</SelectItem>
                          {allBaseTypes.map((t) => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                          <SelectItem value="_NEW" className="text-primary font-medium">+ Nuevo tipo</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    {mods.map((m) => (
                      <TableCell key={m.value} className="text-center">
                        <Checkbox
                          checked={r.tipos.includes(m.value)}
                          onCheckedChange={(v) => config.toggleTipo(r.id, m.value, v === true)}
                        />
                      </TableCell>
                    ))}
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => onDelete(r.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Agregar nuevo */}
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          placeholder={`Nuevo ${title.toLowerCase().slice(0, -1)}...`}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="h-8 w-48"
        />
        <Select value={newBase || '_NONE'} onValueChange={handleNewBaseTipo}>
          <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_NONE">Sin tipo</SelectItem>
            {allBaseTypes.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
            <SelectItem value="_NEW" className="text-primary font-medium">+ Nuevo tipo</SelectItem>
          </SelectContent>
        </Select>
        {mods.map((m) => (
          <label key={m.value} className="flex items-center gap-1 text-xs">
            <Checkbox
              checked={newMods.includes(m.value)}
              onCheckedChange={(v) => {
                setNewMods((prev) => v ? [...prev, m.value] : prev.filter((x) => x !== m.value))
              }}
            />
            {m.label}
          </label>
        ))}
        <Button
          size="sm"
          onClick={() => {
            if (newName.trim()) {
              const tipos: MaquinaTipo[] = []
              if (newBase) tipos.push(newBase)
              for (const m of newMods) tipos.push(m)
              config.addRobot(newName.trim(), tipos.length > 0 ? tipos : undefined)
              setNewName('')
              setNewBase('')
              setNewMods([])
            }
          }}
        >
          <Plus className="mr-1 h-3 w-3" /> Agregar
        </Button>
      </div>
    </>
  )
}

function ComplementarySection({
  items,
  baseTypes,
  config,
  onDelete,
}: {
  items: Robot[]
  baseTypes: { value: MaquinaTipo; label: string }[]
  config: Config
  onDelete: (id: string) => void
}) {
  // Merge hardcoded base types + any custom types found in data
  const baseValues = new Set(baseTypes.map((t) => t.value))
  const customTypes: { value: MaquinaTipo; label: string }[] = []
  for (const r of items) {
    for (const t of r.tipos) {
      if (!baseValues.has(t) && !customTypes.some((c) => c.value === t)) {
        customTypes.push({ value: t, label: t.replace(/_/g, ' ') })
      }
    }
  }
  const allTypes = [...baseTypes, ...customTypes]

  const total = items.length
  const activos = items.filter((r) => r.estado === 'ACTIVO').length

  async function addOne(tipo: MaquinaTipo, label: string) {
    const n = items.filter((r) => r.tipos.includes(tipo)).length + 1
    await config.addRobot(`${label} ${n}`, [tipo])
  }

  function removeOne(tipo: MaquinaTipo) {
    const matching = items.filter((r) => r.tipos.includes(tipo))
    if (matching.length > 0) onDelete(matching[matching.length - 1].id)
  }

  /** Set how many of a type are FUERA DE SERVICIO. Marks the last N as inactive. */
  async function setFueraCount(tipo: MaquinaTipo, fueraCount: number) {
    const matching = items.filter((r) => r.tipos.includes(tipo))
    const clamped = Math.max(0, Math.min(fueraCount, matching.length))
    const activoTarget = matching.length - clamped
    // Make first activoTarget ACTIVO, rest FUERA DE SERVICIO
    for (let i = 0; i < matching.length; i++) {
      const desired = i < activoTarget ? 'ACTIVO' : 'FUERA DE SERVICIO'
      if (matching[i].estado !== desired) {
        await config.updateRobot(matching[i].id, { estado: desired })
      }
    }
  }

  function handleAddTipo() {
    const nt = promptNewTipo(allTypes)
    if (nt) config.addRobot(`${nt.label} 1`, [nt.value])
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          Máquinas Complementarias
          <Badge variant="secondary" className="text-xs">
            {activos}/{total} activos
          </Badge>
        </CardTitle>
        <TableExport
          title="Máquinas Complementarias"
          headers={['Tipo', 'Total', 'Activos', 'Fuera de Servicio']}
          rows={allTypes.map((t) => {
            const matching = items.filter((r) => r.tipos.includes(t.value))
            const act = matching.filter((r) => r.estado === 'ACTIVO').length
            return [t.label, matching.length, act, matching.length - act]
          })}
        />
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-center w-24">Total</TableHead>
              <TableHead className="text-center w-24">Activos</TableHead>
              <TableHead className="text-center w-32">F. Servicio</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {allTypes.map((t) => {
              const matching = items.filter((r) => r.tipos.includes(t.value))
              const act = matching.filter((r) => r.estado === 'ACTIVO').length
              const fuera = matching.length - act
              return (
                <TableRow key={t.value}>
                  <TableCell>
                    <Input
                      defaultValue={t.label}
                      className="h-8 font-medium w-48"
                      onBlur={(e) => {
                        const newLabel = e.target.value.trim()
                        if (!newLabel || newLabel === t.label) return
                        const newValue = newLabel.toUpperCase().replace(/\s+/g, '_') as MaquinaTipo
                        if (newValue !== t.value) config.renameTipo(t.value, newValue)
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    />
                  </TableCell>
                  <TableCell className="text-center text-lg font-bold">{matching.length}</TableCell>
                  <TableCell className="text-center text-emerald-500 font-semibold">{act}</TableCell>
                  <TableCell className="text-center">
                    <Input
                      type="number"
                      min={0}
                      max={matching.length}
                      value={fuera}
                      onChange={(e) => setFueraCount(t.value, parseInt(e.target.value) || 0)}
                      className="h-7 w-16 text-center mx-auto"
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        disabled={matching.length === 0}
                        onClick={() => removeOne(t.value)}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => addOne(t.value, t.label)}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        <div className="mt-3">
          <Button size="sm" variant="outline" onClick={handleAddTipo}>
            <Plus className="mr-1 h-3 w-3" /> Nuevo tipo
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function MaquinasTab({ config }: { config: Config }) {
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const robotItems = config.robots.filter((r) => {
    const cat = getCategoria(r)
    return cat === 'robot' || cat === 'sin_tipo'
  })
  const prelimItems = config.robots.filter((r) => getCategoria(r) === 'complementaria')
  const pespunteItems = config.robots.filter((r) => getCategoria(r) === 'pespunte')

  return (
    <div className="space-y-6 mt-4">
      {/* Robots */}
      <MaquinaSection
        title="Robots"
        items={robotItems}
        baseTypes={ROBOT_TIPOS_BASE}
        mods={ROBOT_TIPOS_MODS}
        config={config}
        onDelete={setDeleteId}
      />

      {/* Máquinas Complementarias */}
      <ComplementarySection
        items={prelimItems}
        baseTypes={PRELIMINAR_TIPOS_BASE}
        config={config}
        onDelete={setDeleteId}
      />

      {/* Maquinas Pespunte Convencional */}
      <MaquinaSection
        title="Maquinas Pespunte"
        items={pespunteItems}
        baseTypes={MAQUINA_TIPOS_BASE}
        mods={MAQUINA_TIPOS_MODS}
        config={config}
        onDelete={setDeleteId}
      />

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null) }}
        title="Eliminar Maquina"
        description="¿Seguro que deseas eliminar esta maquina?"
        onConfirm={() => { if (deleteId) config.deleteRobot(deleteId) }}
      />
    </div>
  )
}
