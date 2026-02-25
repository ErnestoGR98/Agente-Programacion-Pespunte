'use client'

import type { useConfiguracion } from '@/lib/hooks/useConfiguracion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TableExport } from '@/components/shared/TableExport'

export function PesosTab({ config }: { config: ReturnType<typeof useConfiguracion> }) {
  return (
    <div className="space-y-6 mt-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Pesos de Priorizacion</CardTitle>
          <TableExport
            title="Pesos de Priorizacion"
            headers={['Nombre', 'Valor']}
            rows={config.pesos.map((p) => [p.nombre, p.valor])}
          />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            {config.pesos.map((p) => (
              <div key={p.id} className="space-y-1">
                <Label className="text-xs">{p.nombre}</Label>
                <Input
                  type="number" value={p.valor}
                  onChange={(e) => config.updatePeso(p.id, parseInt(e.target.value) || 0)}
                  className="h-8"
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Parametros de Optimizacion</CardTitle>
          <TableExport
            title="Parametros de Optimizacion"
            headers={['Nombre', 'Valor']}
            rows={config.parametros.map((p) => [p.nombre, p.valor])}
          />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            {config.parametros.map((p) => (
              <div key={p.id} className="space-y-1">
                <Label className="text-xs">{p.nombre}</Label>
                <Input
                  type="number" value={p.valor}
                  onChange={(e) => config.updateParametro(p.id, parseFloat(e.target.value) || 0)}
                  className="h-8"
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
