'use client'

import type { useConfiguracion } from '@/lib/hooks/useConfiguracion'
import type { Robot, MaquinaTipo } from '@/types'
import {
  ROBOT_TIPOS_BASE, ROBOT_TIPOS_MODS,
  MAQUINA_TIPOS_BASE, MAQUINA_TIPOS_MODS,
  PRELIMINAR_TIPOS_BASE,
} from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TableExport } from '@/components/shared/TableExport'

type Config = ReturnType<typeof useConfiguracion>

const ROBOT_BASE_SET = new Set(ROBOT_TIPOS_BASE.map((t) => t.value))
const MAQUINA_BASE_SET = new Set(MAQUINA_TIPOS_BASE.map((t) => t.value))
const MODIFIER_SET = new Set([
  ...ROBOT_TIPOS_MODS.map((t) => t.value),
  ...MAQUINA_TIPOS_MODS.map((t) => t.value),
])

// Labels for known tipos
const TIPO_LABELS: Record<string, string> = {}
for (const t of [...ROBOT_TIPOS_BASE, ...MAQUINA_TIPOS_BASE, ...PRELIMINAR_TIPOS_BASE]) {
  TIPO_LABELS[t.value] = t.label
}

function tipoLabel(tipo: string): string {
  return TIPO_LABELS[tipo] || tipo.replace(/_/g, ' ')
}

/** Count active machines by tipo, excluding modifiers */
function countByTipo(machines: Robot[]): [string, number][] {
  const map = new Map<string, number>()
  for (const m of machines) {
    for (const t of m.tipos) {
      if (!MODIFIER_SET.has(t as MaquinaTipo)) {
        map.set(t, (map.get(t) || 0) + 1)
      }
    }
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1])
}

function CategoryCard({
  title,
  total,
  tipos,
  color,
}: {
  title: string
  total: number
  tipos: [string, number][]
  color: 'emerald' | 'blue' | 'amber' | 'slate'
}) {
  const borderColor = {
    emerald: 'border-l-emerald-500',
    blue: 'border-l-blue-500',
    amber: 'border-l-amber-500',
    slate: 'border-l-slate-500',
  }[color]

  const bgColor = {
    emerald: 'bg-emerald-500/10',
    blue: 'bg-blue-500/10',
    amber: 'bg-amber-500/10',
    slate: 'bg-slate-500/10',
  }[color]

  return (
    <Card className={`border-l-4 ${borderColor}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          {title}
          <Badge variant="secondary" className="text-xs">{total} activos</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {tipos.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin registros</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {tipos.map(([tipo, count]) => (
              <div key={tipo} className={`rounded-lg border p-3 ${bgColor}`}>
                <div className="text-xs font-medium text-muted-foreground truncate" title={tipoLabel(tipo)}>
                  {tipoLabel(tipo)}
                </div>
                <div className="text-2xl font-bold">{count}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function CapacidadesTab({ config }: { config: Config }) {
  const machines = config.robots
  const fabricas = config.fabricas

  const active = machines.filter((m) => m.estado === 'ACTIVO')

  // Categorize active machines (same logic as MaquinasTab)
  const robotActive = active.filter((m) => m.tipos.some((t) => ROBOT_BASE_SET.has(t)))
  const pespunteActive = active.filter((m) => m.tipos.some((t) => MAQUINA_BASE_SET.has(t)))
  const complementaryActive = active.filter((m) => {
    const isRobot = m.tipos.some((t) => ROBOT_BASE_SET.has(t))
    const isPespunte = m.tipos.some((t) => MAQUINA_BASE_SET.has(t))
    return !isRobot && !isPespunte && m.tipos.length > 0
  })

  const robotTipos = countByTipo(robotActive)
  const pespunteTipos = countByTipo(pespunteActive)
  const complementaryTipos = countByTipo(complementaryActive)

  const maquilaCount = fabricas.filter((f) => f.es_maquila).length
  const generalCount = config.derivedCapacidades.GENERAL || 0

  // For export
  const allRows = [
    ...robotTipos.map(([t, c]) => ['Robots', tipoLabel(t), c]),
    ...pespunteTipos.map(([t, c]) => ['Maq. Pespunte', tipoLabel(t), c]),
    ...complementaryTipos.map(([t, c]) => ['Complementarias', tipoLabel(t), c]),
    ['Otros', 'Maquila', maquilaCount],
    ['Otros', 'General (Operarios)', generalCount],
  ]

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Cantidad de Recursos Disponibles</h2>
          <p className="text-xs text-muted-foreground">
            Conteos automaticos basados en maquinas activas registradas.
          </p>
        </div>
        <TableExport
          title="Recursos Disponibles"
          headers={['Categoria', 'Tipo', 'Cantidad']}
          rows={allRows}
        />
      </div>

      {/* Robots */}
      <CategoryCard
        title="Robots"
        total={robotActive.length}
        tipos={robotTipos}
        color="emerald"
      />

      {/* Máquinas Pespunte */}
      <CategoryCard
        title="Máquinas Pespunte"
        total={pespunteActive.length}
        tipos={pespunteTipos}
        color="blue"
      />

      {/* Complementarias */}
      <CategoryCard
        title="Máquinas Complementarias"
        total={complementaryActive.length}
        tipos={complementaryTipos}
        color="amber"
      />

      {/* Otros */}
      <Card className="border-l-4 border-l-slate-500">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Otros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            <div className="rounded-lg border p-3 bg-slate-500/10">
              <div className="text-xs font-medium text-muted-foreground">Maquila</div>
              <div className="text-2xl font-bold">{maquilaCount}</div>
              <div className="text-[10px] text-muted-foreground">Fabricas con es_maquila</div>
            </div>
            <div className="rounded-lg border p-3 bg-slate-500/10">
              <div className="text-xs font-medium text-muted-foreground">General</div>
              <div className="text-2xl font-bold">{generalCount}</div>
              <div className="text-[10px] text-muted-foreground">Operarios activos</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
