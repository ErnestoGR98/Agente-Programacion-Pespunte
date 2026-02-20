'use client'

import type { useConfiguracion } from '@/lib/hooks/useConfiguracion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import type { DiaLaboral } from '@/types'

export function DiasTab({ config }: { config: ReturnType<typeof useConfiguracion> }) {
  function handleChange(id: string, field: keyof DiaLaboral, value: number | boolean) {
    config.updateDia(id, { [field]: value })
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-base">Dias Laborales y Plantilla</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dia</TableHead>
              <TableHead>Minutos</TableHead>
              <TableHead>Plantilla</TableHead>
              <TableHead>Min OT</TableHead>
              <TableHead>Plant. OT</TableHead>
              <TableHead>Sabado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {config.dias.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.nombre}</TableCell>
                <TableCell>
                  <Input
                    type="number" value={d.minutos}
                    onChange={(e) => handleChange(d.id, 'minutos', parseInt(e.target.value) || 0)}
                    className="h-8 w-20"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number" value={d.plantilla}
                    onChange={(e) => handleChange(d.id, 'plantilla', parseInt(e.target.value) || 0)}
                    className="h-8 w-20"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number" value={d.minutos_ot}
                    onChange={(e) => handleChange(d.id, 'minutos_ot', parseInt(e.target.value) || 0)}
                    className="h-8 w-20"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number" value={d.plantilla_ot}
                    onChange={(e) => handleChange(d.id, 'plantilla_ot', parseInt(e.target.value) || 0)}
                    className="h-8 w-20"
                  />
                </TableCell>
                <TableCell>
                  <Checkbox
                    checked={d.es_sabado}
                    onCheckedChange={(v) => handleChange(d.id, 'es_sabado', v === true)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
