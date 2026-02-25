'use client'

import { useState, Fragment } from 'react'
import type { usePedido } from '@/lib/hooks/usePedido'
import { useAppStore } from '@/lib/store/useAppStore'
import { importPedido, downloadTemplate } from '@/lib/api/fastapi'
import { KpiCard } from '@/components/shared/KpiCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Trash2, Plus, Download, CheckCircle, Loader2, Truck, ChevronDown, ChevronRight, X } from 'lucide-react'

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

export function PedidoTab({ pedido }: { pedido: ReturnType<typeof usePedido> }) {
  const setCurrentPedido = useAppStore((s) => s.setCurrentPedido)
  const [year, setYear] = useState(new Date().getFullYear())
  const [week, setWeek] = useState(getISOWeek(new Date()))
  const [newModelo, setNewModelo] = useState('')
  const [newColor, setNewColor] = useState('')
  const [newFabrica, setNewFabrica] = useState('')
  const [newVolumen, setNewVolumen] = useState(100)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())

  const semana = `sem_${week}_${year}`

  // Modelo seleccionado del catalogo (para sugerir colores)
  const selectedModelo = pedido.catalogo.find((m) => m.modelo_num === newModelo)

  function handleModeloChange(modelo: string) {
    setNewModelo(modelo)
    const cat = pedido.catalogo.find((m) => m.modelo_num === modelo)
    const alts = cat?.alternativas || []
    setNewColor(alts.length > 0 ? alts[0] : '')
    const fab = pedido.getFabricaForModelo(modelo)
    if (fab) setNewFabrica(fab)
  }

  async function handleSavePedido() {
    setSaving(true)
    const id = await pedido.createPedido(semana)
    if (id && pedido.items.length > 0) {
      await pedido.saveItems(id, pedido.items.map(({ id: _, pedido_id: __, ...rest }) => rest))
    }
    setSaving(false)
    setMessage(`Pedido guardado como "${semana}"`)
  }

  async function handleLoadPedido(pedidoId: string) {
    await pedido.loadPedido(pedidoId)
  }

  async function handleAddItem() {
    if (!newModelo || newVolumen <= 0) return
    let pid = pedido.currentPedidoId
    if (!pid) {
      pid = await pedido.createPedido(semana)
      if (!pid) return
    }
    await pedido.addItem({
      modelo_num: newModelo,
      color: newColor,
      clave_material: '',
      fabrica: newFabrica,
      volumen: newVolumen,
    }, pid)
    setNewModelo('')
    setNewColor('')
    setNewVolumen(100)
  }

  async function handleUploadExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const res = await importPedido(semana, file)
      setMessage(`Importados ${res.items_importados} items`)
      const ped = pedido.pedidos.find((p) => p.nombre === semana)
      if (ped) await pedido.loadPedido(ped.id)
      await pedido.reload()
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : 'Error'}`)
    }
    setUploading(false)
  }

  function handleCargarOptimizador() {
    const ped = pedido.pedidos.find((p) => p.id === pedido.currentPedidoId)
    if (ped) {
      setCurrentPedido(ped.nombre, semana)
      setMessage('Pedido cargado al optimizador')
    }
  }

  function toggleExpand(itemId: string) {
    setExpandedItems((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  // Count items with maquila ops
  const itemsConMaquila = pedido.items.filter(
    (it) => (pedido.maquilaOps[it.modelo_num] || []).length > 0
  ).length
  const itemsMaquilaAsignados = pedido.items.filter((it) => {
    const ops = pedido.maquilaOps[it.modelo_num] || []
    if (ops.length === 0) return false
    const asigs = pedido.asignaciones.filter((a) => a.pedido_item_id === it.id)
    return asigs.length > 0
  }).length

  return (
    <div className="space-y-4 mt-4">
      {message && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard label="Total Pares" value={pedido.totalPares.toLocaleString()} />
        <KpiCard label="Modelos" value={pedido.modelosUnicos} />
        <KpiCard label="Items" value={pedido.items.length} />
        {itemsConMaquila > 0 && (
          <KpiCard
            label="Maquila"
            value={`${itemsMaquilaAsignados}/${itemsConMaquila}`}
            detail="items asignados"
          />
        )}
      </div>

      {/* Semana selector + Save/Load */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-end gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Ano</Label>
              <Input
                type="number" value={year}
                onChange={(e) => setYear(parseInt(e.target.value) || 2026)}
                className="h-8 w-24"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Semana ISO</Label>
              <Input
                type="number" min={1} max={53} value={week}
                onChange={(e) => setWeek(parseInt(e.target.value) || 1)}
                className="h-8 w-24"
              />
            </div>
            <Badge variant="secondary" className="h-8 flex items-center">{semana}</Badge>
            <Button size="sm" onClick={handleSavePedido} disabled={saving}>
              {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
              Guardar
            </Button>

            {/* Selector pedidos guardados */}
            <div className="space-y-1">
              <Label className="text-xs">Cargar pedido</Label>
              <Select onValueChange={handleLoadPedido}>
                <SelectTrigger className="h-8 w-44">
                  <SelectValue placeholder="Seleccionar..." />
                </SelectTrigger>
                <SelectContent>
                  {pedido.pedidos.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Upload Excel + Template Download */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <Label className="text-sm">Importar Excel:</Label>
            <Input
              type="file" accept=".xlsx,.xls"
              onChange={handleUploadExcel}
              className="h-8 w-64"
              disabled={uploading}
            />
            {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
            <Button variant="outline" size="sm" onClick={() => downloadTemplate().catch(() => setMessage('Error descargando template'))}>
              <Download className="mr-1 h-3 w-3" /> Descargar Template
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Add item form */}
      <Card>
        <CardHeader><CardTitle className="text-base">Agregar Item</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1">
              <Label className="text-xs">Modelo</Label>
              <Select value={newModelo} onValueChange={handleModeloChange}>
                <SelectTrigger className="h-8 w-36">
                  <SelectValue placeholder="Modelo..." />
                </SelectTrigger>
                <SelectContent>
                  {pedido.catalogo.map((m) => (
                    <SelectItem key={m.id} value={m.modelo_num}>
                      {m.modelo_num}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Color</Label>
              {selectedModelo && (selectedModelo.alternativas || []).length > 0 ? (
                <Select value={newColor} onValueChange={setNewColor}>
                  <SelectTrigger className="h-8 w-24">
                    <SelectValue placeholder="Color..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(selectedModelo.alternativas || []).map((alt) => (
                      <SelectItem key={alt} value={alt}>{alt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={newColor} onChange={(e) => setNewColor(e.target.value)} className="h-8 w-24" placeholder="Color..." />
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fabrica</Label>
              <Select value={newFabrica} onValueChange={setNewFabrica}>
                <SelectTrigger className="h-8 w-36">
                  <SelectValue placeholder="Fabrica..." />
                </SelectTrigger>
                <SelectContent>
                  {pedido.fabricas.map((f) => (
                    <SelectItem key={f.id} value={f.nombre}>{f.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Volumen</Label>
              <Input
                type="number" min={50} step={50}
                value={newVolumen}
                onChange={(e) => setNewVolumen(parseInt(e.target.value) || 0)}
                className="h-8 w-24"
              />
            </div>
            <Button size="sm" onClick={handleAddItem}>
              <Plus className="mr-1 h-3 w-3" /> Agregar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Items table */}
      <Card>
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Modelo</TableHead>
                <TableHead>Color</TableHead>
                <TableHead>Fabrica</TableHead>
                <TableHead>Volumen</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pedido.items.map((it) => {
                const maqOps = pedido.maquilaOps[it.modelo_num] || []
                const hasMaquila = maqOps.length > 0
                const isExpanded = expandedItems.has(it.id)
                const itemAsigs = pedido.asignaciones.filter((a) => a.pedido_item_id === it.id)
                const allAssigned = hasMaquila && itemAsigs.length > 0

                return (
                  <Fragment key={it.id}>
                    <TableRow>
                      <TableCell className="font-mono">
                        <span className="flex items-center gap-2">
                          {(() => {
                            const cat = pedido.catalogo.find((c) => c.modelo_num === it.modelo_num)
                            const imgUrl = cat?.alternativas_imagenes?.[it.color] || cat?.imagen_url
                            return imgUrl ? <img src={imgUrl} alt={`${it.modelo_num} ${it.color}`} className="h-8 w-auto rounded border object-contain bg-white" /> : null
                          })()}
                          {it.modelo_num}
                          {hasMaquila && (
                            <button
                              className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded hover:bg-destructive/10 transition-colors"
                              onClick={() => toggleExpand(it.id)}
                            >
                              <Truck className={`h-3.5 w-3.5 shrink-0 ${allAssigned ? 'text-destructive' : 'text-destructive/40'}`} />
                              {isExpanded
                                ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                                : <ChevronRight className="h-3 w-3 text-muted-foreground" />
                              }
                            </button>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>{it.color}</TableCell>
                      <TableCell>{it.fabrica}</TableCell>
                      <TableCell>
                        <Input
                          type="number" min={50} step={50}
                          value={it.volumen}
                          onChange={(e) => {
                            const v = parseInt(e.target.value)
                            if (v > 0) pedido.updateItem(it.id, { volumen: v })
                          }}
                          className="h-7 w-24"
                        />
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => pedido.deleteItem(it.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>

                    {/* Maquila distribution expandable row */}
                    {hasMaquila && isExpanded && (
                      <TableRow key={`${it.id}-maquila`}>
                        <TableCell colSpan={5} className="bg-destructive/5 border-l-2 border-destructive/30 p-3">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-destructive flex items-center gap-1">
                                <Truck className="h-3.5 w-3.5" />
                                Operaciones de Maquila ({maqOps.length} fracciones)
                              </span>
                              <div className="flex items-center gap-2">
                                {itemAsigs.length > 0 && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs text-muted-foreground hover:text-destructive"
                                    onClick={() => pedido.clearMaquilaAssignments(it.id)}
                                  >
                                    <X className="h-3 w-3 mr-1" /> Limpiar
                                  </Button>
                                )}
                                <span className="text-xs text-muted-foreground">Asignar a una:</span>
                                <Select onValueChange={(val) => pedido.setAllMaquilaForItem(it.id, it.modelo_num, val, it.volumen)}>
                                  <SelectTrigger className="h-7 w-40 text-xs">
                                    <SelectValue placeholder="Maquila..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {pedido.maquilaFabricas.map((f) => (
                                      <SelectItem key={f.id} value={f.nombre}>{f.nombre}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>

                            {/* Distribution table */}
                            {itemAsigs.length > 0 && (
                              <div className="border rounded-md overflow-hidden">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b bg-muted/50">
                                      <th className="px-2 py-1.5 text-left w-40">Maquila</th>
                                      <th className="px-2 py-1.5 text-left">Fracciones</th>
                                      <th className="px-2 py-1.5 text-right w-24">Pares</th>
                                      <th className="px-2 py-1.5 w-10"></th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {itemAsigs.map((asig) => {
                                      const allFracs = maqOps.map((op) => op.fraccion)
                                      return (
                                        <tr key={asig.id} className="border-b last:border-0">
                                          <td className="px-2 py-1.5">
                                            <Select
                                              value={asig.maquila}
                                              onValueChange={(val) => {
                                                pedido.removeMaquilaAssignment(asig.id).then(() =>
                                                  pedido.addMaquilaAssignment(it.id, val, asig.pares, asig.fracciones)
                                                )
                                              }}
                                            >
                                              <SelectTrigger className="h-7 text-xs">
                                                <SelectValue />
                                              </SelectTrigger>
                                              <SelectContent>
                                                {pedido.maquilaFabricas.map((f) => (
                                                  <SelectItem key={f.id} value={f.nombre}>{f.nombre}</SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                          </td>
                                          <td className="px-2 py-1.5">
                                            <div className="flex flex-wrap gap-1">
                                              {allFracs.map((frac) => {
                                                const isSelected = asig.fracciones.includes(frac)
                                                const op = maqOps.find((o) => o.fraccion === frac)
                                                const shortName = op?.operacion
                                                  ? op.operacion.length > 18
                                                    ? op.operacion.slice(0, 18) + '…'
                                                    : op.operacion
                                                  : ''
                                                return (
                                                  <button
                                                    key={frac}
                                                    className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono border transition-colors ${
                                                      isSelected
                                                        ? 'bg-destructive/10 border-destructive/40 text-destructive'
                                                        : 'border-muted text-muted-foreground hover:border-destructive/30'
                                                    }`}
                                                    title={op?.operacion || `F${frac}`}
                                                    onClick={() => {
                                                      const newFracs = isSelected
                                                        ? asig.fracciones.filter((f) => f !== frac)
                                                        : [...asig.fracciones, frac].sort((a, b) => a - b)
                                                      if (newFracs.length > 0) {
                                                        pedido.updateMaquilaAssignment(asig.id, { fracciones: newFracs })
                                                      }
                                                    }}
                                                  >
                                                    F{frac}{shortName && ` ${shortName}`}
                                                  </button>
                                                )
                                              })}
                                            </div>
                                          </td>
                                          <td className="px-2 py-1.5 text-right">
                                            {(() => {
                                              const otherPares = itemAsigs
                                                .filter((a) => a.id !== asig.id)
                                                .reduce((sum, a) => sum + a.pares, 0)
                                              const maxPares = it.volumen - otherPares
                                              return (
                                                <Input
                                                  type="number"
                                                  min={0}
                                                  max={maxPares}
                                                  step={50}
                                                  className="h-7 w-20 text-xs text-right ml-auto"
                                                  defaultValue={asig.pares}
                                                  onBlur={(e) => {
                                                    let val = parseInt(e.target.value)
                                                    if (isNaN(val)) return
                                                    val = Math.max(0, Math.min(val, maxPares))
                                                    e.target.value = String(val)
                                                    if (val !== asig.pares) {
                                                      pedido.updateMaquilaAssignment(asig.id, { pares: val })
                                                    }
                                                  }}
                                                />
                                              )
                                            })()}
                                          </td>
                                          <td className="px-2 py-1.5">
                                            <button
                                              className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                                              onClick={() => pedido.removeMaquilaAssignment(asig.id)}
                                            >
                                              <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                          </td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {/* Total + Add button */}
                            <div className="flex items-center justify-between">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => {
                                  const allFracs = maqOps.map((op) => op.fraccion)
                                  const usedPares = itemAsigs.reduce((sum, a) => sum + a.pares, 0)
                                  const remaining = Math.max(0, it.volumen - usedPares)
                                  const usedMaquilas = new Set(itemAsigs.map((a) => a.maquila))
                                  const nextMaquila = pedido.maquilaFabricas.find((f) => !usedMaquilas.has(f.nombre))
                                  if (nextMaquila) {
                                    pedido.addMaquilaAssignment(it.id, nextMaquila.nombre, remaining, allFracs)
                                  }
                                }}
                                disabled={
                                  itemAsigs.length >= pedido.maquilaFabricas.length ||
                                  itemAsigs.reduce((sum, a) => sum + a.pares, 0) >= it.volumen
                                }
                              >
                                <Plus className="h-3 w-3 mr-1" /> Agregar maquila
                              </Button>
                              {itemAsigs.length > 0 && (() => {
                                const totalPares = itemAsigs.reduce((sum, a) => sum + a.pares, 0)
                                const match = totalPares === it.volumen
                                return (
                                  <span className={`text-xs font-medium ${match ? 'text-green-600' : 'text-amber-600'}`}>
                                    Total: {totalPares} / {it.volumen} pares
                                  </span>
                                )
                              })()}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
              {pedido.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    Sin items. Agrega modelos o importa un Excel.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={handleCargarOptimizador}
          disabled={pedido.items.length === 0}
        >
          <CheckCircle className="mr-1 h-3 w-3" /> Cargar al Optimizador
        </Button>
      </div>
    </div>
  )
}
