'use client'

import { useState, useRef, useEffect } from 'react'
import { useCatalogo } from '@/lib/hooks/useCatalogo'
import type { ModeloFull, OperacionFull } from '@/lib/hooks/useCatalogo'
import { KpiCard } from '@/components/shared/KpiCard'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { TableExport } from '@/components/shared/TableExport'
import { exportCatalogoPDF, type CatalogModelGroup } from '@/lib/export'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Robot } from '@/types'
import { STAGE_COLORS, RESOURCE_COLORS } from '@/types'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import type { ProcessType, ResourceType } from '@/types'
import { ChevronDown, ChevronRight, Loader2, ScrollText, Plus, Pencil, Trash2, Save, X, Check } from 'lucide-react'

const PROCESS_TYPES: ProcessType[] = ['PRELIMINARES', 'ROBOT', 'POST', 'MAQUILA', 'N/A PRELIMINAR']
const RESOURCE_TYPES: ResourceType[] = ['MESA', 'ROBOT', 'PLANA', 'POSTE', 'MAQUILA', 'GENERAL']
const ETAPA_OPTIONS = ['ROBOT', 'PRE-ROBOT', 'MESA', 'POST-LINEA', 'POST-PLANA-LINEA', 'ZIGZAG-LINEA', 'MAQUILA']

interface EditableOp {
  id: string
  fraccion: number
  operacion: string
  input_o_proceso: ProcessType
  etapa: string
  recurso: ResourceType
  rate: number
  robots: string[]
}
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

  // Global export: all models combined
  const globalExportHeaders = ['MODELO', 'FRACC', 'OPERACION', 'INPUT/PROCESO', 'ETAPA', 'RECURSO', 'RATE', 'ROBOTS']
  const globalExportRows = modelos.flatMap((m) =>
    m.operaciones.map((op) => [
      m.modelo_num, op.fraccion, op.operacion, op.input_o_proceso, op.etapa, op.recurso, op.rate, op.robots.join(', '),
    ] as (string | number)[])
  )

  function buildCatalogGroups(modelList: ModeloFull[]): CatalogModelGroup[] {
    return modelList.map((m) => ({
      modeloNum: m.modelo_num,
      rows: m.operaciones.map((op) => [
        op.fraccion, op.operacion, op.input_o_proceso, op.etapa, op.recurso, op.rate, op.robots.join(', '),
      ] as (string | number)[]),
    }))
  }

  const catalogoPDFHeaders = ['FRACC', 'OPERACION', 'INPUT/PROCESO', 'ETAPA', 'RECURSO', 'RATE', 'ROBOTS']

  function handleGlobalPDF() {
    exportCatalogoPDF('catalogo_completo', catalogoPDFHeaders, buildCatalogGroups(modelos))
  }

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
        <div className="flex items-center gap-2">
          <TableExport title="catalogo_completo" headers={globalExportHeaders} rows={globalExportRows} onCustomPDF={handleGlobalPDF} />
          <Button size="sm" onClick={() => setModeloDialog({ open: true, modelo: null })}>
            <Plus className="mr-1 h-3 w-3" /> Nuevo Modelo
          </Button>
        </div>
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
            onExportPDF={() => {
              exportCatalogoPDF(
                `catalogo_${m.modelo_num}`,
                catalogoPDFHeaders,
                buildCatalogGroups([m]),
              )
            }}
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
            if (data.altImageFiles) {
              for (const [alt, file] of Object.entries(data.altImageFiles)) {
                await catalogo.uploadAlternativaImagen(data.id, data.modeloNum, alt, file)
              }
            }
          } else {
            await catalogo.addModelo(data.modeloNum, data.codigoFull, data.claveMaterial, data.alternativas)
            const newMod = catalogo.modelos.find((m) => m.modelo_num === data.modeloNum)
            if (newMod) {
              if (data.imageFile) {
                await catalogo.uploadModeloImagen(newMod.id, data.modeloNum, data.imageFile)
              }
              if (data.altImageFiles) {
                for (const [alt, file] of Object.entries(data.altImageFiles)) {
                  await catalogo.uploadAlternativaImagen(newMod.id, data.modeloNum, alt, file)
                }
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

function ModeloCard({ modelo, robots, catalogo, onEdit, onDelete, onExportPDF }: {
  modelo: ModeloFull
  robots: Robot[]
  catalogo: ReturnType<typeof useCatalogo>
  onEdit: () => void
  onDelete: () => void
  onExportPDF: () => void
}) {
  const [open, setOpen] = useState(true)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [opDialog, setOpDialog] = useState<{ open: boolean; op: OperacionFull | null }>({ open: false, op: null })
  const [editing, setEditing] = useState(false)
  const [edits, setEdits] = useState<Record<string, EditableOp>>({})
  const [saving, setSaving] = useState(false)
  const [confirmSave, setConfirmSave] = useState(false)
  const [confirmEdit, setConfirmEdit] = useState(false)
  const [confirmOp, setConfirmOp] = useState<{ open: boolean; action: () => Promise<void>; title: string; desc: string }>({
    open: false, action: async () => {}, title: '', desc: '',
  })
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  const robotOps = modelo.operaciones.filter((o) => o.recurso === 'ROBOT').length
  function isOpChanged(orig: OperacionFull, ed: EditableOp) {
    return orig.fraccion !== ed.fraccion || orig.operacion !== ed.operacion ||
      orig.input_o_proceso !== ed.input_o_proceso || orig.etapa !== ed.etapa ||
      orig.recurso !== ed.recurso || orig.rate !== ed.rate ||
      JSON.stringify([...orig.robots].sort()) !== JSON.stringify([...ed.robots].sort())
  }

  const changedCount = Object.keys(edits).filter((id) => {
    const orig = modelo.operaciones.find((o) => o.id === id)
    const ed = edits[id]
    if (!orig || !ed) return false
    return isOpChanged(orig, ed)
  }).length

  function startEditing() {
    const map: Record<string, EditableOp> = {}
    for (const op of modelo.operaciones) {
      map[op.id] = {
        id: op.id, fraccion: op.fraccion, operacion: op.operacion,
        input_o_proceso: op.input_o_proceso, etapa: op.etapa,
        recurso: op.recurso, rate: op.rate, robots: [...op.robots],
      }
    }
    setEdits(map)
    setEditing(true)
  }

  function cancelEditing() {
    setEditing(false)
    setEdits({})
  }

  function updateOp(id: string, field: keyof EditableOp, value: string | number | string[]) {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }

  function toggleRobot(opId: string, robotName: string) {
    setEdits((prev) => {
      const ed = prev[opId]
      if (!ed) return prev
      const has = ed.robots.includes(robotName)
      const updated = has ? ed.robots.filter((r) => r !== robotName) : [...ed.robots, robotName]
      return { ...prev, [opId]: { ...ed, robots: updated } }
    })
  }

  async function saveAll() {
    setSaving(true)
    // Build robot name→id map
    const robotIdMap = new Map(robots.map((r) => [r.nombre, r.id]))
    for (const [id, ed] of Object.entries(edits)) {
      const orig = modelo.operaciones.find((o) => o.id === id)
      if (!orig || !isOpChanged(orig, ed)) continue
      const robotIds = ed.robots.map((name) => robotIdMap.get(name)).filter(Boolean) as string[]
      await catalogo.updateOperacion(id, modelo.id, {
        fraccion: ed.fraccion,
        operacion: ed.operacion,
        input_o_proceso: ed.input_o_proceso,
        etapa: ed.etapa,
        recurso: ed.recurso,
        rate: ed.rate,
        sec_per_pair: ed.rate > 0 ? Math.round(3600 / ed.rate) : 0,
        robotIds,
      })
    }
    setSaving(false)
    setEditing(false)
    setEdits({})
  }

  function getProcesoColor(proceso: string): string {
    if (!proceso) return '#94A3B8'
    if (proceso === 'N/A PRELIMINAR') return STAGE_COLORS['N/A PRELIMINAR']
    if (proceso === 'PRELIMINARES' || proceso.includes('PRELIMINAR')) return STAGE_COLORS.PRELIMINAR
    if (proceso === 'ROBOT') return STAGE_COLORS.ROBOT
    if (proceso === 'POST') return STAGE_COLORS.POST
    if (proceso === 'MAQUILA') return STAGE_COLORS.MAQUILA
    return '#94A3B8'
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
            <CardTitle className="text-base font-mono">{modelo.modelo_num}</CardTitle>
            {modelo.alternativas.length > 0 ? (
              <div className="flex gap-2">
                {modelo.alternativas.map((a) => (
                  <div key={a} className="flex items-center gap-1">
                    {modelo.alternativas_imagenes[a] && (
                      <img
                        src={modelo.alternativas_imagenes[a]}
                        alt={a}
                        className="h-10 w-auto rounded border object-contain bg-white cursor-pointer hover:ring-2 hover:ring-primary/50 transition-shadow"
                        onClick={(e) => { e.stopPropagation(); setLightboxUrl(modelo.alternativas_imagenes[a]) }}
                      />
                    )}
                    <Badge variant="outline" className="text-[10px]">{a}</Badge>
                  </div>
                ))}
              </div>
            ) : modelo.imagen_url ? (
              <img
                src={modelo.imagen_url}
                alt={modelo.modelo_num}
                className="h-10 w-auto rounded border object-contain bg-white cursor-pointer hover:ring-2 hover:ring-primary/50 transition-shadow"
                onClick={(e) => { e.stopPropagation(); setLightboxUrl(modelo.imagen_url) }}
              />
            ) : null}
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
          {/* Edit mode toolbar */}
          <div className="flex items-center gap-2 mb-2">
            {editing ? (
              <>
                <Button
                  size="sm"
                  className="h-6 text-[10px] px-2"
                  disabled={changedCount === 0 || saving}
                  onClick={() => setConfirmSave(true)}
                >
                  <Save className="mr-1 h-3 w-3" />
                  {saving ? 'Guardando...' : `Guardar ${changedCount} cambio${changedCount !== 1 ? 's' : ''}`}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] px-2"
                  onClick={cancelEditing}
                  disabled={saving}
                >
                  <X className="mr-1 h-3 w-3" /> Cancelar
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] px-2"
                onClick={() => setConfirmEdit(true)}
              >
                <Pencil className="mr-1 h-3 w-3" /> Editar tabla
              </Button>
            )}
            <div className="ml-auto">
              <TableExport
                title={`catalogo_${modelo.modelo_num}`}
                headers={['FRACC', 'OPERACION', 'INPUT/PROCESO', 'ETAPA', 'RECURSO', 'RATE', 'ROBOTS']}
                rows={modelo.operaciones.map((op) => [
                  op.fraccion,
                  op.operacion,
                  op.input_o_proceso,
                  op.etapa,
                  op.recurso,
                  op.rate,
                  op.robots.join(', '),
                ])}
                onCustomPDF={onExportPDF}
              />
            </div>
          </div>

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
                <th className="px-2 py-1 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {modelo.operaciones.map((op) => {
                const ed = edits[op.id]
                const proceso = editing && ed ? ed.input_o_proceso : op.input_o_proceso
                const recurso = editing && ed ? ed.recurso : op.recurso
                const procesoColor = getProcesoColor(proceso)
                const recursoColor = RESOURCE_COLORS[recurso] || '#94A3B8'

                const isModified = editing && ed && isOpChanged(op, ed)

                return (
                  <tr
                    key={op.id}
                    className={`border-b ${editing ? 'hover:bg-accent/50' : 'hover:bg-accent/30'} ${isModified ? 'ring-1 ring-inset ring-primary/30' : ''}`}
                    style={{ backgroundColor: isModified ? 'rgba(59,130,246,0.06)' : `${procesoColor}15` }}
                  >
                    {/* FRACCION */}
                    <td className="px-1 py-0.5 font-mono">
                      {editing && ed ? (
                        <Input
                          type="number" min={1}
                          value={ed.fraccion}
                          onChange={(e) => updateOp(op.id, 'fraccion', parseInt(e.target.value) || 0)}
                          className="h-6 w-14 text-xs font-mono px-1"
                        />
                      ) : op.fraccion}
                    </td>

                    {/* OPERACION */}
                    <td className="px-1 py-0.5">
                      {editing && ed ? (
                        <Input
                          value={ed.operacion}
                          onChange={(e) => updateOp(op.id, 'operacion', e.target.value)}
                          className="h-6 text-xs px-1"
                        />
                      ) : op.operacion}
                    </td>

                    {/* INPUT/PROCESO */}
                    <td className="px-1 py-0.5">
                      {editing && ed ? (
                        <Select value={ed.input_o_proceso} onValueChange={(v) => updateOp(op.id, 'input_o_proceso', v)}>
                          <SelectTrigger className="h-6 text-[10px] w-28 px-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PROCESS_TYPES.map((p) => (
                              <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline" className="text-[10px] font-medium" style={{ borderColor: procesoColor, color: procesoColor }}>
                          {op.input_o_proceso}
                        </Badge>
                      )}
                    </td>

                    {/* ETAPA */}
                    <td className="px-1 py-0.5">
                      {editing && ed ? (
                        <Select value={ed.etapa} onValueChange={(v) => updateOp(op.id, 'etapa', v)}>
                          <SelectTrigger className="h-6 text-[10px] w-32 px-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ETAPA_OPTIONS.map((et) => (
                              <SelectItem key={et} value={et} className="text-xs">{et}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-muted-foreground">{op.etapa}</span>
                      )}
                    </td>

                    {/* RECURSO */}
                    <td className="px-1 py-0.5">
                      {editing && ed ? (
                        <Select value={ed.recurso} onValueChange={(v) => updateOp(op.id, 'recurso', v)}>
                          <SelectTrigger className="h-6 text-[10px] w-24 px-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {RESOURCE_TYPES.map((r) => (
                              <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline" className="text-[10px]" style={{ borderColor: recursoColor, color: recursoColor }}>
                          {op.recurso}
                        </Badge>
                      )}
                    </td>

                    {/* RATE */}
                    <td className="px-1 py-0.5 text-right font-mono">
                      {editing && ed ? (
                        <Input
                          type="number" min={0} step={1}
                          value={ed.rate}
                          onChange={(e) => updateOp(op.id, 'rate', parseFloat(e.target.value) || 0)}
                          className="h-6 w-20 text-xs font-mono px-1 text-right"
                        />
                      ) : op.rate}
                    </td>

                    {/* ROBOTS */}
                    <td className="px-2 py-1">
                      {editing && ed && recurso === 'ROBOT' ? (
                        <RobotPicker
                          selected={ed.robots}
                          allRobots={robots}
                          onToggle={(name) => toggleRobot(op.id, name)}
                        />
                      ) : op.recurso === 'ROBOT' && op.robots.length > 0 ? (
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

                    {/* ACTIONS */}
                    <td className="px-1 py-0.5">
                      {!editing && (
                        <button
                          className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                          onClick={() => confirmDeleteOp(op)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                      {editing && isModified && (
                        <Check className="h-3 w-3 text-primary" />
                      )}
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
        operacion={null}
        robots={robots}
        nextFraccion={modelo.operaciones.length > 0 ? Math.max(...modelo.operaciones.map((o) => o.fraccion)) + 1 : 1}
        onSave={async (data) => {
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
        }}
      />

      {/* CAPTCHA to enter edit mode */}
      <ConfirmDialog
        open={confirmEdit}
        onOpenChange={setConfirmEdit}
        title={`Editar operaciones de ${modelo.modelo_num}`}
        description="Esta accion habilitara la edicion de operaciones del modelo."
        onConfirm={startEditing}
        variant="default"
      />

      {/* CAPTCHA for batch save */}
      <ConfirmDialog
        open={confirmSave}
        onOpenChange={setConfirmSave}
        title={`Guardar ${changedCount} cambio${changedCount !== 1 ? 's' : ''} en ${modelo.modelo_num}`}
        description={`Se modificaran ${changedCount} operacion${changedCount !== 1 ? 'es' : ''} del modelo.`}
        onConfirm={saveAll}
      />

      {/* CAPTCHA for delete */}
      <ConfirmDialog
        open={confirmOp.open}
        onOpenChange={(open) => setConfirmOp((prev) => ({ ...prev, open }))}
        title={confirmOp.title}
        description={confirmOp.desc}
        onConfirm={confirmOp.action}
      />

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm cursor-pointer"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white transition-colors"
            onClick={() => setLightboxUrl(null)}
          >
            <X className="h-8 w-8" />
          </button>
          <img
            src={lightboxUrl}
            alt="Vista ampliada"
            className="max-h-[85vh] max-w-[90vw] rounded-lg shadow-2xl object-contain bg-white"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </Card>
  )
}

function RobotPicker({ selected, allRobots, onToggle }: {
  selected: string[]
  allRobots: Robot[]
  onToggle: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <div className="flex flex-wrap items-center gap-1">
        {selected.map((name) => (
          <Badge
            key={name}
            className="text-[9px] px-1.5 py-0 cursor-pointer hover:line-through"
            style={{ backgroundColor: `${STAGE_COLORS.ROBOT}20`, color: STAGE_COLORS.ROBOT }}
            onClick={() => onToggle(name)}
          >
            {name}
          </Badge>
        ))}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="h-5 w-5 rounded border border-dashed border-muted-foreground/30 flex items-center justify-center text-muted-foreground hover:border-emerald-500 hover:text-emerald-500 transition-colors"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-card border rounded-md shadow-lg p-1 min-w-[160px] max-h-48 overflow-y-auto">
          {allRobots.map((r) => {
            const active = selected.includes(r.nombre)
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onToggle(r.nombre)}
                className={`w-full text-left text-xs px-2 py-1 rounded flex items-center gap-2 transition-colors ${
                  active ? 'bg-emerald-500/10 text-emerald-600' : 'hover:bg-accent text-foreground'
                }`}
              >
                <div className={`h-3 w-3 rounded border flex items-center justify-center ${
                  active ? 'border-emerald-500 bg-emerald-500' : 'border-muted-foreground/30'
                }`}>
                  {active && <Check className="h-2 w-2 text-white" />}
                </div>
                {r.nombre}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
