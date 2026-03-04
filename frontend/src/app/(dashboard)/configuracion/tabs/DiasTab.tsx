'use client'

import { useMemo } from 'react'
import type { useConfiguracion } from '@/lib/hooks/useConfiguracion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { TableExport } from '@/components/shared/TableExport'
import type { DiaLaboral, Horario } from '@/types'

/** Calcula minutos productivos de un horario (salida - entrada - comida). */
function calcMinutos(h: Horario): number {
  const toMin = (t: string) => {
    const [hh, mm] = t.split(':').map(Number)
    return hh * 60 + (mm || 0)
  }
  const total = toMin(h.salida) - toMin(h.entrada)
  if (h.comida_inicio && h.comida_fin) {
    return total - (toMin(h.comida_fin) - toMin(h.comida_inicio))
  }
  return total
}

export function DiasTab({ config }: { config: ReturnType<typeof useConfiguracion> }) {
  function handleDiaChange(id: string, field: keyof DiaLaboral, value: number | boolean) {
    config.updateDia(id, { [field]: value })
  }

  function handleHorarioChange(id: string, field: keyof Horario, value: string | number) {
    config.updateHorario(id, { [field]: value })
  }

  // Lookup: es_sabado → FINSEMANA, else → SEMANA
  const horarioSemana = config.horarios.find((h) => h.tipo === 'SEMANA')
  const horarioFinsemana = config.horarios.find((h) => h.tipo === 'FINSEMANA')

  // Calcular minutos por dia basado en horario
  const minutosMap = useMemo(() => {
    const map: Record<string, number> = {}
    for (const d of config.dias) {
      const h = d.es_sabado ? horarioFinsemana : horarioSemana
      map[d.id] = h ? calcMinutos(h) : d.minutos
    }
    return map
  }, [config.dias, horarioSemana, horarioFinsemana])

  // Sync minutos to DB when horario changes (derived value)
  // We auto-save via the existing updateDia on render if different
  for (const d of config.dias) {
    const expected = minutosMap[d.id]
    if (expected && d.minutos !== expected) {
      config.updateDia(d.id, { minutos: expected })
    }
  }

  return (
    <div className="space-y-4 mt-4">
      {/* Horarios */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Horarios</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Entrada</TableHead>
                <TableHead>Salida</TableHead>
                <TableHead>Comida Inicio</TableHead>
                <TableHead>Comida Fin</TableHead>
                <TableHead>Min. Productivos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {config.horarios.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="font-medium">{h.tipo === 'SEMANA' ? 'Semana' : 'Fin de Semana'}</TableCell>
                  <TableCell>
                    <Input
                      type="time" value={h.entrada || '08:00'}
                      onChange={(e) => handleHorarioChange(h.id, 'entrada', e.target.value)}
                      className="h-8 w-28"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="time" value={h.salida || '18:00'}
                      onChange={(e) => handleHorarioChange(h.id, 'salida', e.target.value)}
                      className="h-8 w-28"
                    />
                  </TableCell>
                  <TableCell>
                    {h.tipo === 'FINSEMANA' && !h.comida_inicio ? (
                      <span className="text-xs text-muted-foreground">Sin comida</span>
                    ) : (
                      <Input
                        type="time" value={h.comida_inicio || ''}
                        onChange={(e) => handleHorarioChange(h.id, 'comida_inicio', e.target.value || null as unknown as string)}
                        className="h-8 w-28"
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    {h.tipo === 'FINSEMANA' && !h.comida_fin ? (
                      <span className="text-xs text-muted-foreground">-</span>
                    ) : (
                      <Input
                        type="time" value={h.comida_fin || ''}
                        onChange={(e) => handleHorarioChange(h.id, 'comida_fin', e.target.value || null as unknown as string)}
                        className="h-8 w-28"
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-mono font-medium">{calcMinutos(h)} min</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dias Laborales */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Dias Laborales y Plantilla</CardTitle>
          <TableExport
            title="Dias Laborales y Plantilla"
            headers={['Dia', 'Minutos', 'Plantilla', 'Min OT', 'Plant. OT', 'Sabado']}
            rows={config.dias.map((d) => [
              d.nombre,
              minutosMap[d.id] ?? d.minutos,
              d.plantilla,
              d.minutos_ot,
              d.plantilla_ot,
              d.es_sabado ? 'Si' : 'No',
            ])}
          />
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
                    <span className="text-sm font-mono text-muted-foreground">{minutosMap[d.id] ?? d.minutos}</span>
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number" value={d.plantilla}
                      onChange={(e) => handleDiaChange(d.id, 'plantilla', parseInt(e.target.value) || 0)}
                      className="h-8 w-20"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number" value={d.minutos_ot}
                      onChange={(e) => handleDiaChange(d.id, 'minutos_ot', parseInt(e.target.value) || 0)}
                      className="h-8 w-20"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number" value={d.plantilla_ot}
                      onChange={(e) => handleDiaChange(d.id, 'plantilla_ot', parseInt(e.target.value) || 0)}
                      className="h-8 w-20"
                    />
                  </TableCell>
                  <TableCell>
                    <Checkbox
                      checked={d.es_sabado}
                      onCheckedChange={(v) => handleDiaChange(d.id, 'es_sabado', v === true)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
