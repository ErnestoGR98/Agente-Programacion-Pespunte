'use client'

import { useState, useMemo } from 'react'
import type { useConfiguracion } from '@/lib/hooks/useConfiguracion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Trash2, Plus } from 'lucide-react'
import { TableExport } from '@/components/shared/TableExport'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { ROBOT_TIPOS, type Robot, type RobotTipo } from '@/types'

export function RobotsTab({ config }: { config: ReturnType<typeof useConfiguracion> }) {
  const [newName, setNewName] = useState('')
  const [newTipo, setNewTipo] = useState<RobotTipo>('3020')
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const grouped = useMemo(() => {
    const map: Record<string, typeof config.robots> = {}
    for (const tipo of ROBOT_TIPOS) {
      map[tipo.value] = config.robots.filter((r) => r.tipo === tipo.value)
    }
    const sinTipo = config.robots.filter((r) => !r.tipo)
    if (sinTipo.length > 0) map['SIN_TIPO'] = sinTipo
    return map
  }, [config.robots])

  return (
    <div className="space-y-4 mt-4">
      {ROBOT_TIPOS.map((tipo) => {
        const robots = grouped[tipo.value] || []
        if (robots.length === 0) return null
        const activos = robots.filter((r) => r.estado === 'ACTIVO').length
        return (
          <Card key={tipo.value}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                {tipo.label}
                <Badge variant="secondary" className="text-xs">
                  {activos}/{robots.length} activos
                </Badge>
              </CardTitle>
              <TableExport
                title={`Robots ${tipo.label}`}
                headers={['Nombre', 'Estado', 'Area']}
                rows={robots.map((r) => [r.nombre, r.estado, r.area])}
              />
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Area</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {robots.map((r) => (
                    <TableRow key={r.id} className={r.estado !== 'ACTIVO' ? 'opacity-50' : ''}>
                      <TableCell className="font-mono text-sm">{r.nombre}</TableCell>
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
                        <Button variant="ghost" size="icon" onClick={() => setDeleteId(r.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )
      })}

      {/* Sin tipo */}
      {(grouped['SIN_TIPO'] || []).length > 0 && (
        <Card className="border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-muted-foreground">Sin Tipo Asignado</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(grouped['SIN_TIPO'] || []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm">{r.nombre}</TableCell>
                    <TableCell>
                      <Select
                        value=""
                        onValueChange={(v) => config.updateRobot(r.id, { tipo: v as RobotTipo })}
                      >
                        <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Asignar tipo..." /></SelectTrigger>
                        <SelectContent>
                          {ROBOT_TIPOS.map((t) => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>{r.estado}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteId(r.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Agregar nuevo */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Nuevo robot..."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="h-8 w-48"
        />
        <Select value={newTipo} onValueChange={(v) => setNewTipo(v as RobotTipo)}>
          <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ROBOT_TIPOS.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          onClick={() => {
            if (newName.trim()) {
              config.addRobot(newName.trim(), newTipo)
              setNewName('')
            }
          }}
        >
          <Plus className="mr-1 h-3 w-3" /> Agregar
        </Button>
      </div>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null) }}
        title="Eliminar Robot"
        description="¿Seguro que deseas eliminar este robot?"
        onConfirm={() => { if (deleteId) config.deleteRobot(deleteId) }}
      />
    </div>
  )
}
