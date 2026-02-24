'use client'

import { useState } from 'react'
import { useCatalogo } from '@/lib/hooks/useCatalogo'
import type { ModeloFull, OperacionFull } from '@/lib/hooks/useCatalogo'
import { KpiCard } from '@/components/shared/KpiCard'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Robot } from '@/types'
import { STAGE_COLORS, RESOURCE_COLORS } from '@/types'
import { ChevronDown, ChevronRight, Loader2, ScrollText, Plus, Pencil, Trash2 } from 'lucide-react'
import { ModelRulesDialog } from './ModelRulesDialog'
import { ModeloDialog } from './ModeloDialog'
import { OperacionDialog } from './OperacionDialog'

export default function CatalogoPage() {
  const catalogo = useCatalogo()
  const { loading, modelos, robots } = catalogo
  const [modeloDialog, setModeloDialog] = useState<{ open: boolean; modelo: ModeloFull | null }>({ open: false, modelo: null })
  const [confirmModelo, setConfirmModelo] = useState<{ open: boolean; action: () => Promise<void>; title: string; desc: string }>({
    open: false, action: async () => {}, title: '', desc: '',
  })

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Cargando catalogo...
      </div>
    )
  }

  const totalOps = modelos.reduce((sum, m) => sum + m.operaciones.length, 0)
  const robotOps = modelos.reduce(
    (sum, m) => sum + m.operaciones.filter((o) => o.recurso === 'ROBOT').length,
    0,
  )

  function confirmEditModelo(m: ModeloFull) {
    setConfirmModelo({
      open: true,
      title: `Editar modelo ${m.modelo_num}`,
      desc: 'Esta accion modificara el modelo en el catalogo.',
      action: async () => { setModeloDialog({ open: true, modelo: m }) },
    })
  }

  function confirmDeleteModelo(m: ModeloFull) {
    setConfirmModelo({
      open: true,
      title: `Eliminar modelo ${m.modelo_num}`,
      desc: `Se eliminara el modelo y sus ${m.operaciones.length} operaciones permanentemente.`,
      action: async () => { await catalogo.deleteModelo(m.id) },
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Catalogo de Operaciones</h1>
          <p className="text-sm text-muted-foreground">
            Modelos, fracciones y asignacion de robots
          </p>
        </div>
        <Button size="sm" onClick={() => setModeloDialog({ open: true, modelo: null })}>
          <Plus className="mr-1 h-3 w-3" /> Nuevo Modelo
        </Button>
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
      {modelos.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          Catalogo vacio. Crea un modelo o importa desde Excel.
        </div>
      ) : (
        modelos.map((m) => (
          <ModeloCard
            key={m.id}
            modelo={m}
            robots={robots}
            catalogo={catalogo}
            onEdit={() => confirmEditModelo(m)}
            onDelete={() => confirmDeleteModelo(m)}
          />
        ))
      )}

      <ModeloDialog
        open={modeloDialog.open}
        onOpenChange={(open) => setModeloDialog({ open, modelo: modeloDialog.modelo })}
        modelo={modeloDialog.modelo}
        onSave={async (data) => {
          if (data.id) {
            await catalogo.updateModelo(data.id, {
              modelo_num: data.modeloNum,
              codigo_full: data.codigoFull,
              clave_material: data.claveMaterial,
              alternativas: data.alternativas,
            })
            if (data.imageFile) {
              await catalogo.uploadModeloImagen(data.id, data.modeloNum, data.imageFile)
            }
          } else {
            await catalogo.addModelo(data.modeloNum, data.codigoFull, data.claveMaterial, data.alternativas)
            // Find the newly created model to upload image
            if (data.imageFile) {
              const newMod = catalogo.modelos.find((m) => m.modelo_num === data.modeloNum)
              if (newMod) {
                await catalogo.uploadModeloImagen(newMod.id, data.modeloNum, data.imageFile)
              }
            }
          }
        }}
      />

      <ConfirmDialog
        open={confirmModelo.open}
        onOpenChange={(open) => setConfirmModelo((prev) => ({ ...prev, open }))}
        title={confirmModelo.title}
        description={confirmModelo.desc}
        onConfirm={confirmModelo.action}
      />
    </div>
  )
}

function ModeloCard({ modelo, robots, catalogo, onEdit, onDelete }: {
  modelo: ModeloFull
  robots: Robot[]
  catalogo: ReturnType<typeof useCatalogo>
  onEdit: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(true)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [opDialog, setOpDialog] = useState<{ open: boolean; op: OperacionFull | null }>({ open: false, op: null })
  const [confirmOp, setConfirmOp] = useState<{ open: boolean; action: () => Promise<void>; title: string; desc: string }>({
    open: false, action: async () => {}, title: '', desc: '',
  })

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

  function confirmEditOp(op: OperacionFull) {
    setConfirmOp({
      open: true,
      title: `Editar F${op.fraccion} ${op.operacion}`,
      desc: 'Esta accion modificara la operacion.',
      action: async () => { setOpDialog({ open: true, op }) },
    })
  }

  function confirmDeleteOp(op: OperacionFull) {
    setConfirmOp({
      open: true,
      title: `Eliminar F${op.fraccion} ${op.operacion}`,
      desc: 'Se eliminara la operacion permanentemente.',
      action: async () => { await catalogo.deleteOperacion(op.id, modelo.id) },
    })
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
            {modelo.imagen_url && (
              <img
                src={modelo.imagen_url}
                alt={modelo.modelo_num}
                className="h-10 w-10 rounded border object-cover"
              />
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
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => { e.stopPropagation(); onEdit() }}
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => { e.stopPropagation(); onDelete() }}
            >
              <Trash2 className="h-3 w-3 text-destructive" />
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
                <th className="px-2 py-1 w-16"></th>
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
                    <td className="px-2 py-1">
                      <div className="flex gap-0.5">
                        <button
                          className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                          onClick={() => confirmEditOp(op)}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                          onClick={() => confirmDeleteOp(op)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="mt-2">
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={() => setOpDialog({ open: true, op: null })}
            >
              <Plus className="mr-1 h-3 w-3" /> Operacion
            </Button>
          </div>
        </CardContent>
      )}

      <ModelRulesDialog
        open={rulesOpen}
        onOpenChange={setRulesOpen}
        modeloNum={modelo.modelo_num}
        operaciones={modelo.operaciones}
      />

      <OperacionDialog
        open={opDialog.open}
        onOpenChange={(open) => setOpDialog({ open, op: opDialog.op })}
        operacion={opDialog.op}
        robots={robots}
        nextFraccion={modelo.operaciones.length > 0 ? Math.max(...modelo.operaciones.map((o) => o.fraccion)) + 1 : 1}
        onSave={async (data) => {
          if (data.id) {
            await catalogo.updateOperacion(data.id, modelo.id, {
              fraccion: data.fraccion,
              operacion: data.operacion,
              input_o_proceso: data.input_o_proceso,
              etapa: data.etapa,
              recurso: data.recurso,
              rate: data.rate,
              sec_per_pair: data.sec_per_pair,
              robotIds: data.robotIds,
            })
          } else {
            await catalogo.addOperacion(modelo.id, {
              fraccion: data.fraccion,
              operacion: data.operacion,
              input_o_proceso: data.input_o_proceso,
              etapa: data.etapa,
              recurso: data.recurso,
              rate: data.rate,
              sec_per_pair: data.sec_per_pair,
              robotIds: data.robotIds,
            })
          }
        }}
      />

      <ConfirmDialog
        open={confirmOp.open}
        onOpenChange={(open) => setConfirmOp((prev) => ({ ...prev, open }))}
        title={confirmOp.title}
        description={confirmOp.desc}
        onConfirm={confirmOp.action}
      />
    </Card>
  )
}
