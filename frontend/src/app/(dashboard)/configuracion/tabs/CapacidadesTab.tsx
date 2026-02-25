'use client'

import type { useConfiguracion } from '@/lib/hooks/useConfiguracion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TableExport } from '@/components/shared/TableExport'

export function CapacidadesTab({ config }: { config: ReturnType<typeof useConfiguracion> }) {
  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Cantidad de Recursos Disponibles</CardTitle>
        <TableExport
          title="Recursos Disponibles"
          headers={['Tipo de Recurso', 'Cantidad']}
          rows={config.capacidades.map((c) => [c.tipo, c.pares_hora])}
        />
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4">
          {config.capacidades.map((c) => (
            <div key={c.id} className="space-y-1">
              <Label className="text-xs">{c.tipo}</Label>
              <Input
                type="number"
                value={c.pares_hora}
                onChange={(e) => config.updateCapacidad(c.id, parseInt(e.target.value) || 0)}
                className="h-8"
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
