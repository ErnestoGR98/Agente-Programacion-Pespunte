'use client'

import { useState } from 'react'
import { useCatalogo } from '@/lib/hooks/useCatalogo'
import type { ModeloFull } from '@/lib/hooks/useCatalogo'
import { KpiCard } from '@/components/shared/KpiCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { STAGE_COLORS, RESOURCE_COLORS } from '@/types'
import { ChevronDown, ChevronRight, Loader2, ScrollText } from 'lucide-react'
import { ModelRulesDialog } from './ModelRulesDialog'

export default function CatalogoPage() {
  const { loading, modelos, robots } = useCatalogo()

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Cargando catalogo...
      </div>
    )
  }

  if (modelos.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Catalogo vacio. Importa datos desde la seccion Datos.
      </div>
    )
  }

  const totalOps = modelos.reduce((sum, m) => sum + m.operaciones.length, 0)
  const robotOps = modelos.reduce(
    (sum, m) => sum + m.operaciones.filter((o) => o.recurso === 'ROBOT').length,
    0,
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Catalogo de Operaciones</h1>
        <p className="text-sm text-muted-foreground">
          Modelos, fracciones y asignacion de robots
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard label="Modelos" value={modelos.length} />
        <KpiCard label="Total Operaciones" value={totalOps} />
        <KpiCard label="Operaciones Robot" value={robotOps} />
        <KpiCard label="Robots Activos" value={robots.length} />
      </div>

      {/* Legend */}
      <div className="flex gap-6">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">Proceso:</div>
        {Object.entries(STAGE_COLORS).map(([name, color]) => (
          <div key={name} className="flex items-center gap-1">
            <div className="h-3 w-3 rounded border" style={{ backgroundColor: name === 'N/A PRELIMINAR' ? '#fff' : color }} />
            <span className="text-xs">{name}</span>
          </div>
        ))}
      </div>

      {/* Models */}
      {modelos.map((m) => (
        <ModeloCard key={m.id} modelo={m} />
      ))}
    </div>
  )
}

function ModeloCard({ modelo }: { modelo: ModeloFull }) {
  const [open, setOpen] = useState(true)
  const [rulesOpen, setRulesOpen] = useState(false)

  const robotOps = modelo.operaciones.filter((o) => o.recurso === 'ROBOT').length

  function getProcesoColor(proceso: string): string {
    if (!proceso) return '#94A3B8'
    if (proceso === 'N/A PRELIMINAR') return STAGE_COLORS['N/A PRELIMINAR']
    if (proceso === 'PRELIMINARES' || proceso.includes('PRELIMINAR')) return STAGE_COLORS.PRELIMINAR
    if (proceso === 'ROBOT') return STAGE_COLORS.ROBOT
    if (proceso === 'POST') return STAGE_COLORS.POST
    if (proceso === 'MAQUILA') return STAGE_COLORS.MAQUILA
    return '#94A3B8'
  }

  return (
    <Card>
      <CardHeader
        className="cursor-pointer py-3"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {open ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <CardTitle className="text-base font-mono">{modelo.modelo_num}</CardTitle>
            {modelo.alternativas.length > 0 && (
              <div className="flex gap-1">
                {modelo.alternativas.map((a) => (
                  <Badge key={a} variant="outline" className="text-[10px]">{a}</Badge>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>{modelo.operaciones.length} ops</span>
            {robotOps > 0 && <span>{robotOps} en robot</span>}
            <span>{modelo.total_sec_per_pair} sec/par</span>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={(e) => { e.stopPropagation(); setRulesOpen(true) }}
            >
              <ScrollText className="mr-1 h-3 w-3" /> Reglas
            </Button>
          </div>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="pt-0 overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-1 text-left w-16">FRACC</th>
                <th className="px-2 py-1 text-left">OPERACION</th>
                <th className="px-2 py-1 text-left">INPUT/PROCESO</th>
                <th className="px-2 py-1 text-left">ETAPA</th>
                <th className="px-2 py-1 text-left">RECURSO</th>
                <th className="px-2 py-1 text-right">RATE</th>
                <th className="px-2 py-1 text-left">ROBOTS</th>
              </tr>
            </thead>
            <tbody>
              {modelo.operaciones.map((op) => {
                const procesoColor = getProcesoColor(op.input_o_proceso)
                const recursoColor = RESOURCE_COLORS[op.recurso] || '#94A3B8'

                return (
                  <tr
                    key={op.id}
                    className="border-b hover:bg-accent/30"
                    style={{ backgroundColor: `${procesoColor}15` }}
                  >
                    <td className="px-2 py-1 font-mono">{op.fraccion}</td>
                    <td className="px-2 py-1">{op.operacion}</td>
                    <td className="px-2 py-1">
                      <Badge
                        variant="outline"
                        className="text-[10px] font-medium"
                        style={{ borderColor: procesoColor, color: procesoColor }}
                      >
                        {op.input_o_proceso}
                      </Badge>
                    </td>
                    <td className="px-2 py-1">
                      <span className="text-muted-foreground">{op.etapa}</span>
                    </td>
                    <td className="px-2 py-1">
                      <Badge
                        variant="outline"
                        className="text-[10px]"
                        style={{ borderColor: recursoColor, color: recursoColor }}
                      >
                        {op.recurso}
                      </Badge>
                    </td>
                    <td className="px-2 py-1 text-right font-mono">{op.rate}</td>
                    <td className="px-2 py-1">
                      {op.recurso === 'ROBOT' && op.robots.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {op.robots.map((r) => (
                            <Badge
                              key={r}
                              className="text-[9px] px-1.5 py-0"
                              style={{ backgroundColor: `${STAGE_COLORS.ROBOT}20`, color: STAGE_COLORS.ROBOT }}
                            >
                              {r}
                            </Badge>
                          ))}
                        </div>
                      ) : op.recurso === 'ROBOT' ? (
                        <span className="text-[10px] text-destructive">Sin robot</span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">-</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      )}

      <ModelRulesDialog
        open={rulesOpen}
        onOpenChange={setRulesOpen}
        modeloNum={modelo.modelo_num}
        operaciones={modelo.operaciones}
      />
    </Card>
  )
}
