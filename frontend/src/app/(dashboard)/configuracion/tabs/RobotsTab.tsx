'use client'

import { useState } from 'react'
import type { useConfiguracion } from '@/lib/hooks/useConfiguracion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Trash2, Plus } from 'lucide-react'
import type { Robot } from '@/types'

export function RobotsTab({ config }: { config: ReturnType<typeof useConfiguracion> }) {
  const [newName, setNewName] = useState('')
  const [newAlias, setNewAlias] = useState('')
  const [aliasRobot, setAliasRobot] = useState('')

  return (
    <div className="space-y-6 mt-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Robots Fisicos</CardTitle></CardHeader>
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
              {config.robots.map((r) => (
                <TableRow key={r.id}>
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
                    <Button variant="ghost" size="icon" onClick={() => config.deleteRobot(r.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-3 flex gap-2">
            <Input
              placeholder="Nuevo robot..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-8 w-48"
            />
            <Button
              size="sm"
              onClick={() => { if (newName.trim()) { config.addRobot(newName.trim()); setNewName('') } }}
            >
              <Plus className="mr-1 h-3 w-3" /> Agregar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Aliases de Robots</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Alias (nombre en Excel)</TableHead>
                <TableHead>Robot Real</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {config.aliases.map((a) => {
                const robot = config.robots.find((r) => r.id === a.robot_id)
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-sm">{a.alias}</TableCell>
                    <TableCell>{robot?.nombre || '?'}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => config.deleteAlias(a.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <div className="mt-3 flex gap-2">
            <Input
              placeholder="Alias..."
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              className="h-8 w-40"
            />
            <Select value={aliasRobot} onValueChange={setAliasRobot}>
              <SelectTrigger className="h-8 w-44">
                <SelectValue placeholder="Robot..." />
              </SelectTrigger>
              <SelectContent>
                {config.robots.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={() => {
                if (newAlias.trim() && aliasRobot) {
                  config.addAlias(newAlias.trim(), aliasRobot)
                  setNewAlias('')
                  setAliasRobot('')
                }
              }}
            >
              <Plus className="mr-1 h-3 w-3" /> Agregar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
