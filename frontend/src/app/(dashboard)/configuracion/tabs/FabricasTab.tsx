'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import type { useConfiguracion } from '@/lib/hooks/useConfiguracion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Trash2, Plus, Building2, Truck } from 'lucide-react'
import { TableExport } from '@/components/shared/TableExport'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'

/** Input that keeps local state and only saves on blur */
function EditableNameInput({
  value,
  onSave,
  className,
}: {
  value: string
  onSave: (v: string) => void
  className?: string
}) {
  const [local, setLocal] = useState(value)
  const prev = useRef(value)

  // Sync from parent when value changes externally
  useEffect(() => {
    if (value !== prev.current) {
      setLocal(value)
      prev.current = value
    }
  }, [value])

  function handleBlur() {
    const trimmed = local.trim()
    if (trimmed && trimmed !== value) {
      onSave(trimmed)
      prev.current = trimmed
    }
  }

  return (
    <Input
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      className={className}
    />
  )
}

export function FabricasTab({ config }: { config: ReturnType<typeof useConfiguracion> }) {
  const [newName, setNewName] = useState('')
  const [newEsMaquila, setNewEsMaquila] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const internas = useMemo(() => config.fabricas.filter((f) => !f.es_maquila), [config.fabricas])
  const maquilas = useMemo(() => config.fabricas.filter((f) => f.es_maquila), [config.fabricas])

  function handleAdd() {
    if (!newName.trim()) return
    config.addFabrica(newName.trim(), newEsMaquila)
    setNewName('')
    setNewEsMaquila(false)
  }

  return (
    <div className="mt-4 space-y-4">
      {/* Fabricas Internas */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" />
            Fabricas Internas
          </CardTitle>
          <TableExport
            title="Fabricas Internas"
            headers={['Nombre']}
            rows={internas.map((f) => [f.nombre])}
          />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {internas.map((f) => (
                <TableRow key={f.id}>
                  <TableCell>
                    <EditableNameInput
                      value={f.nombre}
                      onSave={(nombre) => config.updateFabrica(f.id, { nombre })}
                      className="h-8 w-48"
                    />
                  </TableCell>
                  <TableCell className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => config.updateFabrica(f.id, { es_maquila: true })}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Truck className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteId(f.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {internas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-muted-foreground py-4">
                    Sin fabricas internas
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Maquilas */}
      <Card className="border-destructive/30 bg-destructive/5">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <Truck className="h-4 w-4" />
            Maquilas (Produccion Externa)
          </CardTitle>
          <TableExport
            title="Maquilas"
            headers={['Nombre']}
            rows={maquilas.map((f) => [f.nombre])}
          />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {maquilas.map((f) => (
                <TableRow key={f.id}>
                  <TableCell>
                    <EditableNameInput
                      value={f.nombre}
                      onSave={(nombre) => config.updateFabrica(f.id, { nombre })}
                      className="h-8 w-48"
                    />
                  </TableCell>
                  <TableCell className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => config.updateFabrica(f.id, { es_maquila: false })}
                      className="text-muted-foreground hover:text-primary"
                    >
                      <Building2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteId(f.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {maquilas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-muted-foreground py-4">
                    Sin maquilas registradas
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add new */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Nueva fabrica..."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="h-8 w-48"
        />
        <label className="flex items-center gap-1.5 text-xs">
          <Checkbox
            checked={newEsMaquila}
            onCheckedChange={(v) => setNewEsMaquila(!!v)}
          />
          Maquila
        </label>
        <Button size="sm" onClick={handleAdd}>
          <Plus className="mr-1 h-3 w-3" /> Agregar
        </Button>
      </div>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null) }}
        title="Eliminar Fabrica"
        description="¿Seguro que deseas eliminar esta fabrica?"
        onConfirm={() => { if (deleteId) config.deleteFabrica(deleteId) }}
        simple
      />
    </div>
  )
}
