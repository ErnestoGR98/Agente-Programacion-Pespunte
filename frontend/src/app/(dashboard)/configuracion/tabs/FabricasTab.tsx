'use client'

import { useState } from 'react'
import type { useConfiguracion } from '@/lib/hooks/useConfiguracion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Trash2, Plus } from 'lucide-react'

export function FabricasTab({ config }: { config: ReturnType<typeof useConfiguracion> }) {
  const [newName, setNewName] = useState('')

  return (
    <Card className="mt-4">
      <CardHeader><CardTitle className="text-base">Fabricas</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {config.fabricas.map((f) => (
              <TableRow key={f.id}>
                <TableCell>
                  <Input
                    value={f.nombre}
                    onChange={(e) => config.updateFabrica(f.id, e.target.value)}
                    className="h-8 w-48"
                  />
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => config.deleteFabrica(f.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="mt-3 flex gap-2">
          <Input
            placeholder="Nueva fabrica..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="h-8 w-48"
          />
          <Button
            size="sm"
            onClick={() => { if (newName.trim()) { config.addFabrica(newName.trim()); setNewName('') } }}
          >
            <Plus className="mr-1 h-3 w-3" /> Agregar
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
