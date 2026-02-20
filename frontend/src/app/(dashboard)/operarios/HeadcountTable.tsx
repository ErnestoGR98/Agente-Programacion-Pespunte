'use client'

import type { OperarioFull } from '@/lib/hooks/useOperarios'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import type { ResourceType, DayName } from '@/types'

export function HeadcountTable({
  operarios,
  dias,
}: {
  operarios: OperarioFull[]
  dias: { nombre: string; plantilla: number }[]
}) {
  const resourceTypes: ResourceType[] = ['MESA', 'ROBOT', 'PLANA', 'POSTE', 'MAQUILA']

  const rows = dias.map((d) => {
    const disponibles = operarios.filter((o) => (o.dias || []).includes(d.nombre as DayName))
    const byResource: Record<string, number> = {}
    for (const rt of resourceTypes) {
      byResource[rt] = disponibles.filter((o) => (o.recursos || []).includes(rt)).length
    }
    return {
      dia: d.nombre,
      plantilla: d.plantilla,
      disponibles: disponibles.length,
      ...byResource,
    }
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Validacion Headcount</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dia</TableHead>
              <TableHead>Plantilla</TableHead>
              <TableHead>Disponibles</TableHead>
              {resourceTypes.map((rt) => (
                <TableHead key={rt}>{rt}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.dia}>
                <TableCell className="font-medium">{row.dia}</TableCell>
                <TableCell>{row.plantilla}</TableCell>
                <TableCell className={row.disponibles < row.plantilla ? 'text-destructive font-bold' : ''}>
                  {row.disponibles}
                </TableCell>
                {resourceTypes.map((rt) => (
                  <TableCell key={rt}>{row[rt as keyof typeof row]}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
