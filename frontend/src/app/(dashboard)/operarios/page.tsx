'use client'

import { useState } from 'react'
import { useOperarios, type OperarioFull } from '@/lib/hooks/useOperarios'
import { KpiCard } from '@/components/shared/KpiCard'
import { TableExport } from '@/components/shared/TableExport'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Trash2, Plus, Pencil } from 'lucide-react'
import { OperarioForm } from './OperarioForm'
import { HeadcountTable } from './HeadcountTable'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { SKILL_GROUPS, SKILL_LABELS } from '@/types'

export default function OperariosPage() {
  const {
    loading, operarios, dias,
    toggleActivo, deleteOperario, saveOperario,
  } = useOperarios()
  const [editing, setEditing] = useState<OperarioFull | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; nombre: string } | null>(null)

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

  function skillSummary(op: OperarioFull) {
    return Object.entries(SKILL_GROUPS).map(([, g]) => {
      const count = g.skills.filter((s) => op.habilidades.includes(s)).length
      return count > 0 ? `${g.label.slice(0, 6)}: ${count}` : null
    }).filter(Boolean).join(' | ')
  }

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
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Listado de Operarios</span>
            <TableExport
              title="Operarios"
              headers={['Nombre', 'Habilidades', 'Eficiencia', 'Sabado', 'Activo']}
              rows={operarios.map((op) => [
                op.nombre,
                op.habilidades.map((h) => SKILL_LABELS[h]).join(', '),
                `${(op.eficiencia * 100).toFixed(0)}%`,
                op.dias.includes('Sab') ? 'Si' : 'No',
                op.activo ? 'Si' : 'No',
              ])}
            />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Habilidades</TableHead>
                <TableHead>Eficiencia</TableHead>
                <TableHead>Sabado</TableHead>
                <TableHead>Activo</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operarios.map((op) => (
                <TableRow key={op.id} className={!op.activo ? 'opacity-50' : ''}>
                  <TableCell className="font-medium">{op.nombre}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(SKILL_GROUPS).map(([key, group]) => {
                        const count = group.skills.filter((s) => op.habilidades.includes(s)).length
                        if (count === 0) return null
                        return (
                          <Badge
                            key={key}
                            variant="secondary"
                            className="text-xs"
                            style={{ backgroundColor: group.color + '20', color: group.color }}
                          >
                            {group.label.slice(0, 6)} {count}/{group.skills.length}
                          </Badge>
                        )
                      })}
                    </div>
                  </TableCell>
                  <TableCell>{(op.eficiencia * 100).toFixed(0)}%</TableCell>
                  <TableCell>
                    {op.dias.includes('Sab') ? (
                      <Badge variant="secondary" className="text-xs">Si</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">No</span>
                    )}
                  </TableCell>
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
                        onClick={() => setDeleteTarget({ id: op.id, nombre: op.nombre })}
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

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Eliminar Operario"
        description={`¿Seguro que deseas eliminar a ${deleteTarget?.nombre || ''}?`}
        onConfirm={() => { if (deleteTarget) deleteOperario(deleteTarget.id) }}
      />
    </div>
  )
}
