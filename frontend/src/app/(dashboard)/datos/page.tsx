'use client'

import { useState } from 'react'
import { usePedido } from '@/lib/hooks/usePedido'
import { useAppStore } from '@/lib/store/useAppStore'
import { importPedido, importCatalog } from '@/lib/api/fastapi'
import { KpiCard } from '@/components/shared/KpiCard'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Trash2, Plus, Upload, Download, CheckCircle, Loader2 } from 'lucide-react'
import type { PedidoItem } from '@/types'

export default function DatosPage() {
  const pedido = usePedido()

  if (pedido.loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Datos</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Pedido semanal y catalogo de operaciones.
      </p>

      <Tabs defaultValue="pedido">
        <TabsList>
          <TabsTrigger value="pedido">Pedido Semanal</TabsTrigger>
          <TabsTrigger value="catalogo">Catalogo de Operaciones</TabsTrigger>
        </TabsList>

        <TabsContent value="pedido">
          <PedidoTab pedido={pedido} />
        </TabsContent>
        <TabsContent value="catalogo">
          <CatalogoTab pedido={pedido} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ============================================================
// Tab: Pedido Semanal
// ============================================================

function PedidoTab({ pedido }: { pedido: ReturnType<typeof usePedido> }) {
  const setCurrentPedido = useAppStore((s) => s.setCurrentPedido)
  const [year, setYear] = useState(new Date().getFullYear())
  const [week, setWeek] = useState(getISOWeek(new Date()))
  const [newModelo, setNewModelo] = useState('')
  const [newColor, setNewColor] = useState('')
  const [newClave, setNewClave] = useState('')
  const [newFabrica, setNewFabrica] = useState('')
  const [newVolumen, setNewVolumen] = useState(100)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const semana = `sem_${week}_${year}`

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
    if (!pedido.currentPedidoId) {
      // Auto-create pedido
      const id = await pedido.createPedido(semana)
      if (!id) return
      await pedido.loadPedido(id)
    }
    await pedido.addItem({
      modelo_num: newModelo,
      color: newColor,
      clave_material: newClave,
      fabrica: newFabrica,
      volumen: newVolumen,
    })
    setNewModelo('')
    setNewColor('')
    setNewClave('')
    setNewVolumen(100)
  }

  async function handleUploadExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const res = await importPedido(semana, file)
      setMessage(`Importados ${res.items_importados} items`)
      // Reload
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

  return (
    <div className="space-y-4 mt-4">
      {message && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <KpiCard label="Total Pares" value={pedido.totalPares.toLocaleString()} />
        <KpiCard label="Modelos" value={pedido.modelosUnicos} />
        <KpiCard label="Items" value={pedido.items.length} />
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

      {/* Upload Excel */}
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
          </div>
        </CardContent>
      </Card>

      {/* Add item form */}
      <Card>
        <CardHeader><CardTitle className="text-base">Agregar Item</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Modelo</Label>
              <Select value={newModelo} onValueChange={setNewModelo}>
                <SelectTrigger className="h-8 w-32">
                  <SelectValue placeholder="Modelo..." />
                </SelectTrigger>
                <SelectContent>
                  {pedido.catalogo.map((m) => (
                    <SelectItem key={m.id} value={m.modelo_num}>{m.modelo_num}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Color</Label>
              <Input value={newColor} onChange={(e) => setNewColor(e.target.value)} className="h-8 w-20" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Clave Material</Label>
              <Input value={newClave} onChange={(e) => setNewClave(e.target.value)} className="h-8 w-28" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fabrica</Label>
              <Select value={newFabrica} onValueChange={setNewFabrica}>
                <SelectTrigger className="h-8 w-28">
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
                <TableHead>Clave Material</TableHead>
                <TableHead>Fabrica</TableHead>
                <TableHead>Volumen</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pedido.items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="font-mono">{it.modelo_num}</TableCell>
                  <TableCell>{it.color}</TableCell>
                  <TableCell>{it.clave_material}</TableCell>
                  <TableCell>{it.fabrica}</TableCell>
                  <TableCell>
                    <Input
                      type="number" min={50} step={50}
                      value={it.volumen}
                      onChange={(e) => pedido.updateItem(it.id, { volumen: parseInt(e.target.value) || 0 })}
                      className="h-7 w-24"
                    />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => pedido.deleteItem(it.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {pedido.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
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
          size="sm" variant="outline"
          onClick={async () => {
            if (!pedido.currentPedidoId) return
            const consolidated = pedido.consolidateDuplicates()
            await pedido.saveItems(pedido.currentPedidoId, consolidated.map(({ id: _, pedido_id: __, ...rest }) => rest))
          }}
          disabled={pedido.items.length === 0}
        >
          Consolidar Duplicados
        </Button>
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

// ============================================================
// Tab: Catalogo
// ============================================================

function CatalogoTab({ pedido }: { pedido: ReturnType<typeof usePedido> }) {
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function handleUploadCatalog(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const res = await importCatalog(file)
      setMessage(`Importados ${res.modelos_importados} modelos, ${res.total_operaciones} operaciones`)
      await pedido.reload()
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : 'Error'}`)
    }
    setUploading(false)
  }

  const totalOps = pedido.catalogo.reduce((sum, m) => sum + m.num_ops, 0)

  return (
    <div className="space-y-4 mt-4">
      {message && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <KpiCard label="Modelos" value={pedido.catalogo.length} />
        <KpiCard label="Total Operaciones" value={totalOps} />
        <KpiCard
          label="Sec/Par Promedio"
          value={pedido.catalogo.length > 0
            ? Math.round(pedido.catalogo.reduce((s, m) => s + m.total_sec_per_pair, 0) / pedido.catalogo.length)
            : 0
          }
        />
      </div>

      {/* Import */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <Label className="text-sm">Importar Catalogo Excel:</Label>
            <Input
              type="file" accept=".xlsx,.xls"
              onChange={handleUploadCatalog}
              className="h-8 w-64"
              disabled={uploading}
            />
            {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
          </div>
        </CardContent>
      </Card>

      {/* Catalogo table */}
      <Card>
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Modelo</TableHead>
                <TableHead>Codigo Full</TableHead>
                <TableHead>Alternativas</TableHead>
                <TableHead>Clave Material</TableHead>
                <TableHead>Operaciones</TableHead>
                <TableHead>Sec/Par</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pedido.catalogo.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono font-medium">{m.modelo_num}</TableCell>
                  <TableCell>{m.codigo_full}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {m.alternativas.map((a) => (
                        <Badge key={a} variant="outline" className="text-xs">{a}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{m.clave_material}</TableCell>
                  <TableCell>{m.num_ops}</TableCell>
                  <TableCell>{m.total_sec_per_pair}</TableCell>
                </TableRow>
              ))}
              {pedido.catalogo.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Catalogo vacio. Importa un Excel para comenzar.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

// Helper
function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}
