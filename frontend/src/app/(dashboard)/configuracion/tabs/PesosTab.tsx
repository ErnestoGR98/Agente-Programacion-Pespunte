'use client'

import type { useConfiguracion } from '@/lib/hooks/useConfiguracion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TableExport } from '@/components/shared/TableExport'

const PARAM_LABELS: Record<string, { label: string; desc: string }> = {
  lote_minimo: { label: 'Lote Minimo', desc: 'Minimo de pares por lote' },
  lote_preferido: { label: 'Lote Preferido', desc: 'Tamanio preferido de lote' },
  lead_time_maquila: { label: 'Lead Time Maquila', desc: 'Dias de anticipacion para maquila' },
  timeout: { label: 'Timeout (s)', desc: 'Tiempo maximo del solver' },
  factor_eficiencia: { label: 'Factor Eficiencia', desc: 'Factor global de eficiencia' },
  lineas_post: { label: 'Lineas POST (Conveyor)', desc: 'Conveyors disponibles. Limita modelos simultaneos en POST. 0 = sin limite.' },
}

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
            {config.parametros.map((p) => {
              const meta = PARAM_LABELS[p.nombre]
              return (
                <div key={p.id} className="space-y-1">
                  <Label className="text-xs">{meta?.label || p.nombre}</Label>
                  {meta?.desc && <p className="text-[11px] text-muted-foreground">{meta.desc}</p>}
                  <Input
                    type="number" value={p.valor}
                    onChange={(e) => config.updateParametro(p.id, parseFloat(e.target.value) || 0)}
                    className="h-8"
                  />
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
