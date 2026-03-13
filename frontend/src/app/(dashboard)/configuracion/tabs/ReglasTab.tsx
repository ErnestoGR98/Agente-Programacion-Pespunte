'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useReglas } from '@/lib/hooks/useReglas'
import { supabase } from '@/lib/supabase/client'
import type { OperacionFull } from '@/lib/hooks/useCatalogo'
import { KpiCard } from '@/components/shared/KpiCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Trash2, Plus, Wand2, Download, Loader2 } from 'lucide-react'
import { TableExport } from '@/components/shared/TableExport'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { CONSTRAINT_TYPES_PERMANENTES, type ConstraintType, type Restriccion } from '@/types'
import { ConstraintParams } from '@/app/(dashboard)/restricciones/ConstraintParams'
import { CascadeEditor } from '@/components/shared/CascadeEditor'

interface CatalogoModelo {
  modelo_num: string
  clave_material: string
}

export function ReglasTab() {
  const reglas = useReglas()
  const [showForm, setShowForm] = useState(false)
  const [tipo, setTipo] = useState<ConstraintType>('PRECEDENCIA_OPERACION')
  const [modelo, setModelo] = useState('')
  const [params, setParams] = useState<Record<string, unknown>>({})
  const [nota, setNota] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [showClearAll, setShowClearAll] = useState(false)
  const [modeloItems, setModeloItems] = useState<{ modelo_num: string; color: string }[]>([])
  const [operaciones, setOperaciones] = useState<OperacionFull[]>([])

  // Bulk PDF export state
  const [bulkExporting, setBulkExporting] = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0, modelo: '' })
  const [bulkRenderData, setBulkRenderData] = useState<{ ops: OperacionFull[]; rules: Restriccion[]; title: string } | null>(null)
  const bulkContainerRef = useRef<HTMLDivElement>(null)

  const loadModelos = useCallback(async () => {
    const { data: modelos } = await supabase
      .from('catalogo_modelos')
      .select('modelo_num, clave_material')
      .order('modelo_num')
    if (modelos) {
      setModeloItems(modelos.map((m: CatalogoModelo) => ({
        modelo_num: m.modelo_num,
        color: m.clave_material,
      })))
    }
  }, [])

  useEffect(() => { loadModelos() }, [loadModelos])

  // Load operaciones for graph when modelo changes (PRECEDENCIA)
  const loadOperaciones = useCallback(async () => {
    if (!modelo || modelo === '*') { setOperaciones([]); return }
    const { data: mod } = await supabase
      .from('catalogo_modelos')
      .select('id')
      .eq('modelo_num', modelo)
      .single()
    if (!mod) { setOperaciones([]); return }
    const { data: ops } = await supabase
      .from('catalogo_operaciones')
      .select('id, fraccion, operacion, input_o_proceso, etapa, recurso, recurso_raw, rate, sec_per_pair')
      .eq('modelo_id', mod.id)
      .order('fraccion')
    if (ops) {
      // Load robots for each operation
      const opIds = ops.map((o: { id: string }) => o.id)
      const { data: robotLinks } = await supabase
        .from('catalogo_operaciones_robots')
        .select('operacion_id, robot_id')
        .in('operacion_id', opIds)
      const robotMap = new Map<string, string[]>()
      for (const link of (robotLinks || [])) {
        const list = robotMap.get(link.operacion_id) || []
        list.push(link.robot_id)
        robotMap.set(link.operacion_id, list)
      }
      setOperaciones(ops.map((o: Record<string, unknown>) => ({
        ...o,
        robots: robotMap.get(o.id as string) || [],
      })) as OperacionFull[])
    }
  }, [modelo])

  useEffect(() => {
    if (tipo === 'PRECEDENCIA_OPERACION') loadOperaciones()
  }, [tipo, loadOperaciones])

  // Tipos donde el modelo se especifica en los parametros
  const TIPOS_SIN_MODELO: ConstraintType[] = [
    'SECUENCIA', 'AGRUPAR_MODELOS',
  ]
  const hideModelo = TIPOS_SIN_MODELO.includes(tipo)

  // Whether to show the graph for PRECEDENCIA
  const showGraph = tipo === 'PRECEDENCIA_OPERACION' && modelo && modelo !== '*' && operaciones.length > 0

  // Filter precedencia rules for the selected model (for graph)
  const precedenciasForModel = useMemo(
    () => reglas.reglas.filter((r) => r.tipo === 'PRECEDENCIA_OPERACION' && r.modelo_num === modelo),
    [reglas.reglas, modelo],
  )

  // --- Graph callbacks ---
  async function graphCreatePrecedencia(fracsOrig: number[], fracsDest: number[], buffer: number | 'todo' | 'rate') {
    await reglas.addRegla({
      tipo: 'PRECEDENCIA_OPERACION',
      modelo_num: modelo,
      activa: true,
      parametros: {
        fracciones_origen: fracsOrig,
        fracciones_destino: fracsDest,
        buffer_pares: buffer,
      },
    })
  }

  async function graphUpdateBuffer(id: string, buffer: number | 'todo' | 'rate') {
    const regla = reglas.reglas.find((r) => r.id === id)
    if (!regla) return
    const parametros = { ...regla.parametros as Record<string, unknown>, buffer_pares: buffer }
    const { error } = await supabase.from('restricciones').update({ parametros }).eq('id', id)
    if (error) {
      console.error('[ReglasTab] graphUpdateBuffer failed:', error)
      throw error
    }
    await reglas.reload()
  }

  async function graphAutoGenerate() {
    // Group fracciones by input_o_proceso (stage)
    const groups = new Map<string, number[]>()
    for (const op of operaciones) {
      const list = groups.get(op.input_o_proceso) || []
      list.push(op.fraccion)
      groups.set(op.input_o_proceso, list)
    }
    // Sort stages by average fraccion number
    const ordered = [...groups.entries()]
      .map(([proceso, fracs]) => ({
        proceso,
        fracs: fracs.sort((a, b) => a - b),
      }))
      .sort((a, b) => {
        const avgA = a.fracs.reduce((s, f) => s + f, 0) / a.fracs.length
        const avgB = b.fracs.reduce((s, f) => s + f, 0) / b.fracs.length
        return avgA - avgB
      })

    // Collect all existing individual pairs (expanded from group rules too)
    const existingPairs = new Set<string>()
    for (const r of precedenciasForModel) {
      const p = r.parametros as Record<string, unknown>
      const orig = (p.fracciones_origen as number[]) || []
      const dest = (p.fracciones_destino as number[]) || []
      for (const o of orig) {
        for (const d of dest) {
          existingPairs.add(`${o}->${d}`)
        }
      }
    }

    // Build virtual grid: each stage = one column, fracs sorted in rows
    // Use findOwnerSource logic to create connections (same as manual drop)
    const virtualGrid: (number | null)[][] = []
    const maxRows = Math.max(...ordered.map((s) => s.fracs.length))
    for (let r = 0; r < maxRows; r++) {
      virtualGrid.push(ordered.map((stage) => stage.fracs[r] ?? null))
    }

    const newRows = []
    for (let col = 1; col < ordered.length; col++) {
      for (let row = 0; row < ordered[col].fracs.length; row++) {
        const destFrac = ordered[col].fracs[row]
        // Find source: same row in prev column first, then scan up, then down
        let srcFrac: number | null = null
        const prevCol = col - 1
        if (virtualGrid[row]?.[prevCol] != null) {
          srcFrac = virtualGrid[row][prevCol]
        } else {
          for (let r = row - 1; r >= 0; r--) {
            if (virtualGrid[r]?.[prevCol] != null) { srcFrac = virtualGrid[r][prevCol]; break }
          }
          if (srcFrac == null) {
            for (let r = row + 1; r < maxRows; r++) {
              if (virtualGrid[r]?.[prevCol] != null) { srcFrac = virtualGrid[r][prevCol]; break }
            }
          }
        }
        if (srcFrac == null || srcFrac === destFrac) continue
        const pairKey = `${srcFrac}->${destFrac}`
        if (existingPairs.has(pairKey)) continue
        existingPairs.add(pairKey)
        newRows.push({
          semana: null,
          tipo: 'PRECEDENCIA_OPERACION' as ConstraintType,
          modelo_num: modelo,
          activa: true,
          parametros: {
            fracciones_origen: [srcFrac],
            fracciones_destino: [destFrac],
            buffer_pares: 0,
            nota: `${ordered[prevCol].proceso} → ${ordered[col].proceso}`,
          },
        })
      }
    }
    if (newRows.length > 0) {
      await supabase.from('restricciones').insert(newRows)
      await reglas.reload()
    }
  }

  // Models that have PRECEDENCIA_OPERACION rules
  const modelsWithPrecedencias = useMemo(() => {
    const models = new Set<string>()
    for (const r of reglas.reglas) {
      if (r.tipo === 'PRECEDENCIA_OPERACION' && r.modelo_num !== '*') {
        models.add(r.modelo_num)
      }
    }
    return [...models].sort()
  }, [reglas.reglas])

  async function exportAllCascadesPdf() {
    if (modelsWithPrecedencias.length === 0) return
    setBulkExporting(true)
    try {
      const html2canvas = (await import('html2canvas-pro')).default
      const { jsPDF } = await import('jspdf')

      const root = document.documentElement
      const wasDark = root.classList.contains('dark')
      if (wasDark) root.classList.remove('dark')
      root.classList.add('light')

      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      let firstPage = true

      for (let i = 0; i < modelsWithPrecedencias.length; i++) {
        const modeloNum = modelsWithPrecedencias[i]
        setBulkProgress({ current: i + 1, total: modelsWithPrecedencias.length, modelo: modeloNum })

        // Load operaciones
        const { data: mod } = await supabase
          .from('catalogo_modelos').select('id').eq('modelo_num', modeloNum).single()
        if (!mod) continue
        const { data: ops } = await supabase
          .from('catalogo_operaciones')
          .select('id, fraccion, operacion, input_o_proceso, etapa, recurso, recurso_raw, rate, sec_per_pair')
          .eq('modelo_id', mod.id).order('fraccion')
        if (!ops || ops.length === 0) continue

        const opIds = ops.map((o: { id: string }) => o.id)
        const { data: robotLinks } = await supabase
          .from('catalogo_operaciones_robots')
          .select('operacion_id, robot_id').in('operacion_id', opIds)
        const robotMap = new Map<string, string[]>()
        for (const link of (robotLinks || [])) {
          const list = robotMap.get(link.operacion_id) || []
          list.push(link.robot_id)
          robotMap.set(link.operacion_id, list)
        }
        const fullOps = ops.map((o: Record<string, unknown>) => ({
          ...o, robots: robotMap.get(o.id as string) || [],
        })) as OperacionFull[]

        const modelRules = reglas.reglas.filter(
          (r) => r.tipo === 'PRECEDENCIA_OPERACION' && r.modelo_num === modeloNum
        )

        // Render CascadeEditor offscreen
        setBulkRenderData({ ops: fullOps, rules: modelRules, title: `Cascada-${modeloNum}` })

        // Wait for React render + paint
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 400)))
        })

        // Capture the grid
        const gridEl = bulkContainerRef.current?.querySelector('.cascade-grid') as HTMLElement | null
        if (!gridEl) continue

        // Force overflow visible so html2canvas captures the full width
        const origOverflow = gridEl.style.overflow
        gridEl.style.overflow = 'visible'

        // Hide interactive elements (same logic as CascadeEditor.exportPdf)
        const hidden: HTMLElement[] = []
        gridEl.querySelectorAll('tbody tr').forEach((tr) => {
          if ((tr as HTMLElement).textContent?.includes('AGREGAR')) {
            (tr as HTMLElement).style.display = 'none'
            hidden.push(tr as HTMLElement)
            return
          }
          const hasOp = tr.querySelector('[style*="border-left-color"]') !== null
          const hasBuf = Array.from(tr.querySelectorAll('button')).some((b) => {
            const cls = b.className || ''
            return cls.includes('emerald') || cls.includes('cyan')
          })
          if (!hasOp && !hasBuf) {
            (tr as HTMLElement).style.display = 'none'
            hidden.push(tr as HTMLElement)
          }
        })
        gridEl.querySelectorAll('button').forEach((btn) => {
          const cls = (btn as HTMLElement).className || ''
          if (cls.includes('emerald') || cls.includes('cyan')) return
          ;(btn as HTMLElement).style.display = 'none'
          hidden.push(btn as HTMLElement)
        })
        gridEl.querySelectorAll('.cursor-ns-resize').forEach((el) => {
          (el as HTMLElement).style.display = 'none'
          hidden.push(el as HTMLElement)
        })
        const thLast = gridEl.querySelector('thead tr th:last-child') as HTMLElement | null
        if (thLast?.textContent?.includes('AGREGAR')) {
          thLast.style.display = 'none'
          hidden.push(thLast)
          gridEl.querySelectorAll('tbody tr').forEach((tr) => {
            const lastTd = tr.querySelector('td:last-child') as HTMLElement | null
            if (lastTd) { lastTd.style.display = 'none'; hidden.push(lastTd) }
          })
        }

        const canvas = await html2canvas(gridEl, {
          backgroundColor: '#ffffff',
          scale: 2,
          useCORS: true,
          width: gridEl.scrollWidth,
        })

        // Restore hidden elements and overflow
        hidden.forEach((el) => { el.style.display = '' })
        gridEl.style.overflow = origOverflow

        // Add page to PDF
        if (!firstPage) pdf.addPage()
        firstPage = false

        const pageW = pdf.internal.pageSize.getWidth()
        const margin = 10
        const maxW = pageW - margin * 2
        const scale = maxW / canvas.width
        const finalW = maxW
        const finalH = canvas.height * scale

        // Title
        pdf.setFontSize(14)
        pdf.text(`Cascada - ${modeloNum}`, margin, 12)
        pdf.setFontSize(8)
        pdf.setTextColor(120)
        pdf.text(new Date().toLocaleDateString('es-MX'), margin, 17)
        pdf.setTextColor(0)

        // If image is too tall, scale to fit page
        const pageH = pdf.internal.pageSize.getHeight()
        const maxH = pageH - 25
        if (finalH > maxH) {
          const fitScale = maxH / finalH
          pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, 20, finalW * fitScale, maxH)
        } else {
          pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, 20, finalW, finalH)
        }
      }

      // Restore dark mode
      root.classList.remove('light')
      if (wasDark) root.classList.add('dark')

      pdf.save('Todas-Cascadas-Precedencia.pdf')
    } catch (err) {
      console.error('[ReglasTab] Bulk PDF export failed:', err)
    } finally {
      setBulkExporting(false)
      setBulkRenderData(null)
      setBulkProgress({ current: 0, total: 0, modelo: '' })
    }
  }

  async function handleAdd() {
    const parametros = nota ? { ...params, nota } : params
    await reglas.addRegla({
      tipo,
      modelo_num: hideModelo ? '*' : modelo,
      activa: true,
      parametros,
    })
    setShowForm(false)
    setModelo('')
    setParams({})
    setNota('')
  }

  if (reglas.loading) return null

  return (
    <div className="space-y-4 mt-4">
      <p className="text-sm text-muted-foreground">
        Reglas permanentes que aplican automaticamente en toda optimizacion. No dependen de la semana.
        Tambien puedes auto-generar precedencias desde el boton <strong>Reglas</strong> en cada modelo del Catalogo.
      </p>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
        <KpiCard label="Total" value={reglas.reglas.length} />
        <KpiCard label="Activas" value={reglas.activas} />
        <KpiCard label="Inactivas" value={reglas.inactivas} />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="mr-1 h-3 w-3" /> Agregar Regla
        </Button>
        {modelsWithPrecedencias.length > 0 && (
          <Button size="sm" variant="outline" onClick={exportAllCascadesPdf} disabled={bulkExporting}>
            {bulkExporting ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                {bulkProgress.current}/{bulkProgress.total} — {bulkProgress.modelo}
              </>
            ) : (
              <>
                <Download className="mr-1 h-3 w-3" /> Descargar Todas PDF
              </>
            )}
          </Button>
        )}
        {reglas.reglas.length > 0 && (
          <Button size="sm" variant="ghost" className="text-destructive"
            onClick={() => setShowClearAll(true)}
          >
            <Trash2 className="mr-1 h-3 w-3" /> Limpiar todas
          </Button>
        )}
      </div>

      {/* Add form */}
      {showForm && (
        <Card>
          <CardHeader><CardTitle className="text-base">Nueva Regla</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className={`grid gap-3 sm:gap-4 ${hideModelo ? 'grid-cols-1 sm:grid-cols-2' : (tipo === 'PRECEDENCIA_OPERACION' ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3')}`}>
              <div className="space-y-1">
                <Label className="text-xs">Tipo</Label>
                <Select value={tipo} onValueChange={(v) => {
                  const newTipo = v as ConstraintType
                  setTipo(newTipo)
                  setParams({})
                  if (TIPOS_SIN_MODELO.includes(newTipo)) setModelo('*')
                }}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CONSTRAINT_TYPES_PERMANENTES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!hideModelo && (
                <div className="space-y-1">
                  <Label className="text-xs">Modelo</Label>
                  <Select value={modelo} onValueChange={setModelo}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="Seleccionar modelo..." /></SelectTrigger>
                    <SelectContent>
                      {modeloItems.map((item, i) => (
                        <SelectItem key={`${item.modelo_num}-${item.color}-${i}`} value={item.modelo_num}>
                          {item.modelo_num} — {item.color}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {!showGraph && (
                <div className="space-y-1">
                  <Label className="text-xs">Nota</Label>
                  <Input value={nota} onChange={(e) => setNota(e.target.value)} className="h-8" />
                </div>
              )}
            </div>

            {/* PRECEDENCIA → Cascade editor with drag-and-drop */}
            {showGraph ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={graphAutoGenerate}>
                    <Wand2 className="mr-1 h-3 w-3" /> Auto-generar por bloques
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Arrastra operaciones a las cascadas. Haz clic en una flecha para editar buffer o eliminar.
                  </span>
                </div>
                <CascadeEditor
                  operaciones={operaciones}
                  reglas={precedenciasForModel}
                  onConnect={graphCreatePrecedencia}
                  onDeleteEdge={reglas.deleteRegla}
                  onUpdateBuffer={graphUpdateBuffer}
                  title={`Cascada-${modelo}`}
                />
              </div>
            ) : (
              <>
                {/* Dynamic params for non-PRECEDENCIA or when no model selected */}
                <ConstraintParams
                  tipo={tipo}
                  params={params}
                  setParams={setParams}
                  modeloItems={modeloItems}
                  selectedModelo={hideModelo ? undefined : modelo}
                />

                <div className="flex gap-2">
                  <Button size="sm" onClick={handleAdd}>Agregar</Button>
                  <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-0">
          <CardTitle className="text-base">Reglas</CardTitle>
          <TableExport
            title="Reglas Permanentes"
            headers={['Tipo', 'Modelo', 'Parametros', 'Activa']}
            rows={reglas.reglas.map((r) => {
              const { nota: _nota, ...rest } = (r.parametros || {}) as Record<string, unknown>
              const display = Object.keys(rest).length > 0 ? JSON.stringify(rest) : ''
              const paramStr = _nota ? `${display} (${_nota})` : display
              return [r.tipo, r.modelo_num, paramStr, r.activa ? 'Si' : 'No']
            })}
          />
        </CardHeader>
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead>Parametros</TableHead>
                <TableHead>Activa</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reglas.reglas.map((r) => (
                <TableRow key={r.id} className={!r.activa ? 'opacity-50' : ''}>
                  <TableCell>
                    <Badge variant="secondary">{r.tipo}</Badge>
                  </TableCell>
                  <TableCell className="font-mono">{r.modelo_num}</TableCell>
                  <TableCell className="text-xs max-w-xs truncate">
                    {(() => {
                      const { nota: _nota, ...rest } = (r.parametros || {}) as Record<string, unknown>
                      const display = Object.keys(rest).length > 0 ? JSON.stringify(rest) : '—'
                      return _nota ? `${display} (${_nota})` : display
                    })()}
                  </TableCell>
                  <TableCell>
                    <Checkbox
                      checked={r.activa}
                      onCheckedChange={(v) => reglas.toggleActiva(r.id, v === true)}
                    />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteId(r.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {reglas.reglas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    Sin reglas. Agrega una para comenzar.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null) }}
        title="Eliminar Regla"
        description="¿Seguro que deseas eliminar esta regla?"
        onConfirm={() => { if (deleteId) reglas.deleteRegla(deleteId) }}
      />
      <ConfirmDialog
        open={showClearAll}
        onOpenChange={setShowClearAll}
        title="Limpiar Todas las Reglas"
        description="¿Seguro que deseas eliminar TODAS las reglas? Esta accion no se puede deshacer."
        onConfirm={async () => {
          for (const r of reglas.reglas) await reglas.deleteRegla(r.id)
        }}
      />

      {/* Hidden offscreen container for bulk PDF rendering */}
      {bulkRenderData && (
        <div
          ref={bulkContainerRef}
          className="light"
          style={{ position: 'fixed', left: '-9999px', top: 0, width: '4000px', background: 'white', zIndex: -1, overflow: 'visible' }}
        >
          <CascadeEditor
            operaciones={bulkRenderData.ops}
            reglas={bulkRenderData.rules}
            onConnect={async () => {}}
            onDeleteEdge={async () => {}}
            onUpdateBuffer={async () => {}}
            title={bulkRenderData.title}
          />
        </div>
      )}
    </div>
  )
}
