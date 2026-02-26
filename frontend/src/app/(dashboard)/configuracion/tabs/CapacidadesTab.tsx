'use client'

import type { useConfiguracion } from '@/lib/hooks/useConfiguracion'
import type { ResourceType } from '@/types'
import { RESOURCE_TYPES } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TableExport } from '@/components/shared/TableExport'

type Config = ReturnType<typeof useConfiguracion>

const RESOURCE_LABELS: Record<ResourceType, { label: string; source: string }> = {
  ROBOT: { label: 'Robots', source: 'Robots activos, area Pespunte' },
  MESA: { label: 'Mesa (Preliminar)', source: 'Maq. Preliminar activas, area Pespunte' },
  PLANA: { label: 'Plana', source: 'Maq. Plana activas, area Pespunte' },
  POSTE: { label: 'Poste', source: 'Maq. Poste activas, area Pespunte' },
  MAQUILA: { label: 'Maquila', source: 'Fabricas con es_maquila' },
  GENERAL: { label: 'General', source: 'Operarios activos' },
}

export function CapacidadesTab({ config }: { config: Config }) {
  const d = config.derivedCapacidades
  const rows: [ResourceType, number][] = RESOURCE_TYPES.map((t) => [t, d[t]])

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Cantidad de Recursos Disponibles</CardTitle>
        <TableExport
          title="Recursos Disponibles"
          headers={['Tipo de Recurso', 'Cantidad', 'Fuente']}
          rows={rows.map(([t, v]) => [RESOURCE_LABELS[t].label, v, RESOURCE_LABELS[t].source])}
        />
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-4">
          Conteos automaticos. Solo cuentan maquinas activas con area Pespunte. Las de Avios no cuentan (solo se prestan en emergencia).
        </p>
        <div className="grid grid-cols-3 gap-4">
          {rows.map(([tipo, count]) => (
            <div key={tipo} className="rounded-lg border p-3 space-y-1">
              <div className="text-xs font-medium text-muted-foreground">{RESOURCE_LABELS[tipo].label}</div>
              <div className="text-2xl font-bold">{count}</div>
              <div className="text-[10px] text-muted-foreground">{RESOURCE_LABELS[tipo].source}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
