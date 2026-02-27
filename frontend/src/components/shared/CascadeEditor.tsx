'use client'

import { Fragment, useState, useMemo, useEffect, useRef, DragEvent } from 'react'
import type { OperacionFull } from '@/lib/hooks/useCatalogo'
import type { Restriccion } from '@/types'
import { STAGE_COLORS } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Trash2, Plus, X } from 'lucide-react'

// ─── Props ───────────────────────────────────────────────────────────

export interface CascadeEditorProps {
  operaciones: OperacionFull[]
  reglas: Restriccion[]
  onConnect: (origen: number[], destino: number[], buffer: number | 'todo') => Promise<void>
  onDeleteEdge: (reglaId: string) => Promise<void>
  onUpdateBuffer: (reglaId: string, buffer: number | 'todo') => Promise<void>
}

// ─── Helpers ─────────────────────────────────────────────────────────

interface ArrowInfo { reglaId: string; buffer: unknown }

function buildArrowMap(reglas: Restriccion[]): Map<string, ArrowInfo> {
  const map = new Map<string, ArrowInfo>()
  for (const r of reglas) {
    const p = r.parametros as Record<string, unknown>
    const origFracs = (p.fracciones_origen as number[]) || []
    const destFracs = (p.fracciones_destino as number[]) || []
    for (const o of origFracs) {
      for (const d of destFracs) {
        map.set(`${o}->${d}`, { reglaId: r.id, buffer: p.buffer_pares })
      }
    }
  }
  return map
}

function deriveGrid(
  operaciones: OperacionFull[],
  reglas: Restriccion[],
): { grid: (number | null)[][]; placements: Map<string, number>; groupBoundaries: number[] } {
  const allFracs = new Set(operaciones.map((op) => op.fraccion))
  const connectedFracs = new Set<number>()
  const adj = new Map<number, number[]>()
  const predecessors = new Map<number, Set<number>>()

  for (const f of allFracs) { adj.set(f, []); predecessors.set(f, new Set()) }

  for (const r of reglas) {
    const p = r.parametros as Record<string, unknown>
    const origFracs = ((p.fracciones_origen as number[]) || []).filter((f) => allFracs.has(f))
    const destFracs = ((p.fracciones_destino as number[]) || []).filter((f) => allFracs.has(f))
    for (const o of origFracs) {
      for (const d of destFracs) {
        connectedFracs.add(o); connectedFracs.add(d)
        const t = adj.get(o)!; if (!t.includes(d)) t.push(d)
        predecessors.get(d)!.add(o)
      }
    }
  }

  const placements = new Map<string, number>()
  if (connectedFracs.size === 0) {
    const empty: (number | null)[][] = []
    for (let i = 0; i < 5; i++) empty.push([null, null, null])
    return { grid: empty, placements, groupBoundaries: [] }
  }

  const depth = new Map<number, number>()
  const roots = [...connectedFracs].filter((f) => predecessors.get(f)!.size === 0).sort((a, b) => a - b)
  const queue: number[] = [...roots]
  for (const r of roots) depth.set(r, 0)
  while (queue.length > 0) {
    const cur = queue.shift()!
    const curDepth = depth.get(cur)!
    for (const next of (adj.get(cur) || []).sort((a, b) => a - b)) {
      const newDepth = curDepth + 1
      if (!depth.has(next) || depth.get(next)! < newDepth) { depth.set(next, newDepth); queue.push(next) }
    }
  }

  const visited = new Set<number>()
  const chains: number[][] = []
  // Returns main chain FIRST, then branch chains — so root ends up at the top row
  function buildChainWithBranches(start: number): number[][] {
    const chain: number[] = []
    const pendingBranches: number[] = []
    let current: number | undefined = start
    while (current !== undefined && !visited.has(current)) {
      visited.add(current); chain.push(current)
      const successors: number[] = (adj.get(current) || []).filter((t) => !visited.has(t)).sort((a, b) => a - b)
      if (successors.length === 0) break
      const [next, ...branches] = successors
      for (const b of branches) pendingBranches.push(b)
      current = next
    }
    const result: number[][] = [chain]
    for (const b of pendingBranches) {
      if (!visited.has(b)) result.push(...buildChainWithBranches(b))
    }
    return result
  }
  const groupBoundaries: number[] = []
  for (const root of roots) {
    if (!visited.has(root)) {
      groupBoundaries.push(chains.length)
      const sub = buildChainWithBranches(root)
      for (const c of sub) { if (c.length > 0) chains.push(c) }
    }
  }

  const maxDepth = Math.max(0, ...([...depth.values()]))
  const numCols = Math.max(3, maxDepth + 1)
  const grid: (number | null)[][] = []
  for (const chain of chains) {
    const row: (number | null)[] = Array(numCols).fill(null)
    for (const frac of chain) { const col = depth.get(frac) ?? 0; row[col] = frac; placements.set(`${grid.length},${col}`, frac) }
    grid.push(row)
  }
  while (grid.length < 5) grid.push(Array(numCols).fill(null))
  return { grid, placements, groupBoundaries }
}

function processColor(proceso: string): string {
  if (!proceso) return '#94A3B8'
  if (proceso === 'N/A PRELIMINAR') return STAGE_COLORS['N/A PRELIMINAR'] || '#94A3B8'
  if (proceso === 'PRELIMINARES' || proceso.includes('PRELIMINAR')) return STAGE_COLORS.PRELIMINAR
  if (proceso === 'ROBOT') return STAGE_COLORS.ROBOT
  if (proceso === 'POST') return STAGE_COLORS.POST
  if (proceso === 'MAQUILA') return STAGE_COLORS.MAQUILA
  return '#94A3B8'
}

// ─── Component ───────────────────────────────────────────────────────

export function CascadeEditor({
  operaciones, reglas, onConnect, onDeleteEdge, onUpdateBuffer,
}: CascadeEditorProps) {
  const opMap = useMemo(() => {
    const m = new Map<number, OperacionFull>()
    for (const op of operaciones) m.set(op.fraccion, op)
    return m
  }, [operaciones])

  const arrowMap = useMemo(() => buildArrowMap(reglas), [reglas])
  const arrowMapRef = useRef(arrowMap)
  arrowMapRef.current = arrowMap
  // Stable refs for callbacks (avoid useEffect re-runs during drag)
  const onConnectRef = useRef(onConnect)
  onConnectRef.current = onConnect
  const onDeleteEdgeRef = useRef(onDeleteEdge)
  onDeleteEdgeRef.current = onDeleteEdge
  const derived = useMemo(() => deriveGrid(operaciones, reglas), [operaciones, reglas])

  // Manual placements: "row,col" → fraccion
  const [manualPlacements, setManualPlacements] = useState<Map<string, number>>(new Map())
  const manualRef = useRef(manualPlacements)
  manualRef.current = manualPlacements

  // Cleanup manual placements when rules cover them
  const rulesKey = reglas.map((r) => r.id).join(',')
  useEffect(() => {
    const ruleConnected = new Set<number>()
    for (const [, frac] of derived.placements) ruleConnected.add(frac)
    setManualPlacements((prev) => {
      const next = new Map(prev)
      let changed = false
      for (const [key, frac] of prev) {
        if (ruleConnected.has(frac)) { next.delete(key); changed = true }
      }
      return changed ? next : prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rulesKey])

  const [extraRows, setExtraRows] = useState(0)
  const [extraCols, setExtraCols] = useState(0)
  const baseNumCols = derived.grid.length > 0 ? derived.grid[0].length : 3
  const totalCols = baseNumCols + extraCols
  const totalRows = derived.grid.length + extraRows

  // Merge derived + manual into display grid
  const displayGrid = useMemo(() => {
    const g: (number | null)[][] = []
    for (let r = 0; r < totalRows; r++) {
      const row: (number | null)[] = []
      for (let c = 0; c < totalCols; c++) {
        const manual = manualPlacements.get(`${r},${c}`)
        const fromRules = derived.grid[r]?.[c] ?? null
        row.push(manual !== undefined ? manual : fromRules)
      }
      g.push(row)
    }
    return g
  }, [derived.grid, totalRows, totalCols, manualPlacements])

  const displayGridRef = useRef(displayGrid)
  displayGridRef.current = displayGrid

  const placed = useMemo(() => {
    const s = new Set<number>()
    for (const [, frac] of derived.placements) s.add(frac)
    for (const [, frac] of manualPlacements) s.add(frac)
    return s
  }, [derived.placements, manualPlacements])
  const placedRef = useRef(placed)
  placedRef.current = placed

  const unplacedCount = operaciones.filter((op) => !placed.has(op.fraccion)).length

  // ─── Cell spanning (rowSpan) ──────────────────────────────────────

  const { spanMap, skipSet, getEffectiveFrac } = useMemo(() => {
    const spanMap = new Map<string, number>()   // "row,col" → span count
    const skipSet = new Set<string>()           // "row,col" → skip rendering (covered by span)

    for (let col = 0; col < totalCols; col++) {
      for (let row = 0; row < totalRows; row++) {
        const frac = displayGrid[row]?.[col]
        if (frac == null) continue

        // Find all connected rows in adjacent columns
        let maxRow = row

        // Successors in col+1
        for (let r = 0; r < totalRows; r++) {
          const target = displayGrid[r]?.[col + 1]
          if (target != null && arrowMap.has(`${frac}->${target}`)) {
            maxRow = Math.max(maxRow, r)
          }
        }

        // Predecessors in col-1
        for (let r = 0; r < totalRows; r++) {
          const source = displayGrid[r]?.[col - 1]
          if (source != null && arrowMap.has(`${source}->${frac}`)) {
            maxRow = Math.max(maxRow, r)
          }
        }

        // Only span downward, and only if all cells below are empty
        if (maxRow > row) {
          let canSpan = true
          for (let r = row + 1; r <= maxRow; r++) {
            if (displayGrid[r]?.[col] != null) { canSpan = false; break }
          }
          if (canSpan) {
            spanMap.set(`${row},${col}`, maxRow - row + 1)
            for (let r = row + 1; r <= maxRow; r++) {
              skipSet.add(`${r},${col}`)
            }
          }
        }
      }
    }

    // Effective frac: returns the frac at (row, col) considering spans from above
    function getEffectiveFrac(row: number, col: number): number | null {
      const direct = displayGrid[row]?.[col]
      if (direct != null) return direct
      // Check if a cell above spans into this position
      for (let r = row - 1; r >= 0; r--) {
        const span = spanMap.get(`${r},${col}`)
        if (span && r + span > row) return displayGrid[r]?.[col] ?? null
        if (displayGrid[r]?.[col] != null) break
      }
      return null
    }

    return { spanMap, skipSet, getEffectiveFrac }
  }, [displayGrid, totalRows, totalCols, arrowMap])

  // DnD state
  const [dragFrac, setDragFrac] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  // Buffer edit modal
  const [editArrow, setEditArrow] = useState<{
    mode: 'edit' | 'create'; reglaId: string | null; fromFrac: number; toFrac: number; buffer: unknown
  } | null>(null)
  const [editType, setEditType] = useState<'todo' | 'numero'>('numero')
  const [editVal, setEditVal] = useState('0')

  // ─── Card resize (stretch to span multiple rows) ─────────────────
  const [resizeSpan, setResizeSpan] = useState<{ key: string; span: number } | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const resizeRef = useRef<{ row: number; col: number; frac: number; initialSpan: number; span: number } | null>(null)
  const tableBodyRef = useRef<HTMLTableSectionElement>(null)

  function startResize(e: React.MouseEvent, row: number, col: number, frac: number, currentSpan: number) {
    e.preventDefault()
    e.stopPropagation()
    const s = currentSpan || 1
    resizeRef.current = { row, col, frac, initialSpan: s, span: s }
    setResizeSpan({ key: `${row},${col}`, span: s })
    setIsResizing(true)
  }

  useEffect(() => {
    if (!isResizing) return
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current || !tableBodyRef.current) return
      const tbodyRows = tableBodyRef.current.children
      const { row: startRow, col } = resizeRef.current
      let newSpan = 1
      for (let r = startRow + 1; r < tbodyRows.length - 1; r++) { // -1 skip AGREGAR+ row
        const rowEl = tbodyRows[r] as HTMLElement
        const rect = rowEl.getBoundingClientRect()
        if (e.clientY > rect.top + 10) {
          if (displayGridRef.current[r]?.[col] != null) break
          newSpan = r - startRow + 1
        } else { break }
      }
      newSpan = Math.max(1, newSpan)
      resizeRef.current.span = newSpan
      setResizeSpan({ key: `${startRow},${col}`, span: newSpan })
    }

    const handleMouseUp = async () => {
      const info = resizeRef.current
      if (info) {
        const grid = displayGridRef.current
        const arrows = arrowMapRef.current
        // Grow: create connections for newly covered rows
        for (let r = info.row + info.initialSpan; r < info.row + info.span; r++) {
          const parentFrac = grid[r]?.[info.col - 1]
          if (parentFrac != null && !arrows.has(`${parentFrac}->${info.frac}`)) {
            try { await onConnectRef.current([parentFrac], [info.frac], 0) } catch { /* ignore */ }
          }
        }
        // Shrink: remove connections for rows no longer covered
        for (let r = info.row + info.span; r < info.row + info.initialSpan; r++) {
          const parentFrac = grid[r]?.[info.col - 1]
          if (parentFrac != null) {
            const arrow = arrows.get(`${parentFrac}->${info.frac}`)
            if (arrow) {
              try { await onDeleteEdgeRef.current(arrow.reglaId) } catch { /* ignore */ }
            }
          }
        }
      }
      resizeRef.current = null
      setResizeSpan(null)
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing]) // Only depends on isResizing — callbacks use stable refs

  // ─── Helpers ────────────────────────────────────────────────────────

  // Find the single owning parent at col-1 for a given row.
  // Each parent "owns" from its row downward until the next parent in the same column.
  function findOwnerSource(row: number, col: number, grid: (number | null)[][]): number | null {
    if (col <= 0) return null
    // Same row first
    const sameRow = grid[row]?.[col - 1]
    if (sameRow != null) return sameRow
    // Look upward for nearest parent
    for (let r = row - 1; r >= 0; r--) {
      const f = grid[r]?.[col - 1]
      if (f != null) return f
    }
    // Nothing above — look downward
    for (let r = row + 1; r < grid.length; r++) {
      const f = grid[r]?.[col - 1]
      if (f != null) return f
    }
    return null
  }

  // ─── Buffer rendering ─────────────────────────────────────────────

  function renderBufferCell(rowIdx: number, colIdx: number) {
    // Use effective frac (accounts for rowSpan) so spanning cells show direct arrows
    const curFrac = getEffectiveFrac(rowIdx, colIdx)
    const nxtFrac = getEffectiveFrac(rowIdx, colIdx + 1)

    if (curFrac == null && nxtFrac == null) return null

    // Direct connection between effective fracs
    const hasDirectPair = curFrac != null && nxtFrac != null
    const directRule = hasDirectPair ? arrowMap.get(`${curFrac}->${nxtFrac}`) : null

    // Cross-row connections NOT covered by spans
    const crossRowConns: { fromFrac: number; toFrac: number; arrow: ArrowInfo }[] = []

    if (curFrac != null) {
      for (let r = 0; r < totalRows; r++) {
        if (r === rowIdx) continue
        const targetFrac = displayGrid[r]?.[colIdx + 1]
        if (targetFrac == null) continue
        const arrow = arrowMap.get(`${curFrac}->${targetFrac}`)
        if (!arrow) continue
        // Skip if the other row already shows this as direct (because span covers it)
        if (getEffectiveFrac(r, colIdx) === curFrac) continue
        crossRowConns.push({ fromFrac: curFrac, toFrac: targetFrac, arrow })
      }
    }

    if (nxtFrac != null) {
      for (let r = 0; r < totalRows; r++) {
        if (r === rowIdx) continue
        const sourceFrac = displayGrid[r]?.[colIdx]
        if (sourceFrac == null) continue
        const arrow = arrowMap.get(`${sourceFrac}->${nxtFrac}`)
        if (!arrow) continue
        if (getEffectiveFrac(r, colIdx + 1) === nxtFrac) continue
        crossRowConns.push({ fromFrac: sourceFrac, toFrac: nxtFrac, arrow })
      }
    }

    const showFadedArrow = hasDirectPair && !directRule
    if (!directRule && !showFadedArrow && crossRowConns.length === 0) return null

    return (
      <div className="flex flex-col items-center gap-0.5">
        {hasDirectPair && (
          directRule ? (
            <button
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors cursor-pointer text-emerald-400"
              onClick={() => openBufferEdit(curFrac!, nxtFrac!)}
            >
              <span className="text-[10px] font-bold whitespace-nowrap">
                {directRule.buffer === 'todo' ? 'Todo' : `${directRule.buffer || 0}p`}
              </span>
              <span className="text-sm font-bold">&rarr;</span>
            </button>
          ) : showFadedArrow ? (
            <button
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-muted-foreground/20 hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-colors cursor-pointer text-muted-foreground/30 hover:text-emerald-400"
              onClick={() => openBufferEdit(curFrac!, nxtFrac!)}
              title="Clic para vincular y asignar buffer"
            >
              <span className="text-[10px]">---</span>
              <span className="text-sm">&rarr;</span>
            </button>
          ) : null
        )}

        {crossRowConns.map((c, i) => {
          const isForward = c.fromFrac === curFrac
          const label = isForward ? `\u2192 F${c.toFrac}` : `F${c.fromFrac} \u2192`
          return (
            <button
              key={i}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 hover:bg-cyan-500/20 transition-colors cursor-pointer text-cyan-400"
              onClick={() => openBufferEdit(c.fromFrac, c.toFrac)}
              title={`F${c.fromFrac} \u2192 F${c.toFrac}`}
            >
              <span className="text-[8px] font-semibold">{label}</span>
              <span className="text-[8px] font-bold">
                {c.arrow.buffer === 'todo' ? 'Todo' : `${c.arrow.buffer || 0}p`}
              </span>
            </button>
          )
        })}
      </div>
    )
  }

  // ─── DnD handlers ─────────────────────────────────────────────────

  function handleDragStart(e: DragEvent, frac: number) {
    setDragFrac(frac)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(frac))
  }

  function handleDragOver(e: DragEvent, id: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTarget(id)
  }

  function handleDragLeave() { setDropTarget(null) }

  async function handleDrop(e: DragEvent, row: number, col: number) {
    e.preventDefault()
    setDropTarget(null)
    const frac = parseInt(e.dataTransfer.getData('text/plain'))
    if (isNaN(frac)) return
    setDragFrac(null)

    if (displayGrid[row]?.[col] != null) return
    if (placedRef.current.has(frac)) return

    setManualPlacements((prev) => {
      const next = new Map(prev)
      next.set(`${row},${col}`, frac)
      return next
    })

    if (col > 0) {
      const freshManual = new Map(manualRef.current)
      freshManual.set(`${row},${col}`, frac)
      const freshGrid: (number | null)[][] = []
      for (let r = 0; r < totalRows; r++) {
        const rowArr: (number | null)[] = []
        for (let c = 0; c < totalCols; c++) {
          const m = freshManual.get(`${r},${c}`)
          const fromR = derived.grid[r]?.[c] ?? null
          rowArr.push(m !== undefined ? m : fromR)
        }
        freshGrid.push(rowArr)
      }

      const ownerFrac = findOwnerSource(row, col, freshGrid)
      if (ownerFrac != null && ownerFrac !== frac) {
        try {
          await onConnect([ownerFrac], [frac], 0)
        } catch (err) {
          console.warn('[CascadeEditor] auto-create failed:', err)
        }
      }
    }
  }

  // ─── Buffer modal ──────────────────────────────────────────────────

  function openBufferEdit(fromFrac: number, toFrac: number) {
    const key = `${fromFrac}->${toFrac}`
    const arrow = arrowMap.get(key)
    if (arrow) {
      const isTodo = arrow.buffer === 'todo'
      setEditArrow({ mode: 'edit', reglaId: arrow.reglaId, fromFrac, toFrac, buffer: arrow.buffer })
      setEditType(isTodo ? 'todo' : 'numero')
      setEditVal(isTodo ? '0' : String(arrow.buffer || 0))
    } else {
      setEditArrow({ mode: 'create', reglaId: null, fromFrac, toFrac, buffer: 0 })
      setEditType('numero')
      setEditVal('0')
    }
  }

  async function saveBuffer() {
    if (!editArrow) return
    const buffer = editType === 'todo' ? ('todo' as const) : parseInt(editVal) || 0
    try {
      if (editArrow.mode === 'create') {
        await onConnect([editArrow.fromFrac], [editArrow.toFrac], buffer)
      } else if (editArrow.reglaId) {
        await onUpdateBuffer(editArrow.reglaId, buffer)
      }
      setEditArrow(null)
    } catch (err) {
      console.error('[CascadeEditor] saveBuffer failed:', err)
    }
  }

  async function deleteConnection() {
    if (!editArrow || !editArrow.reglaId) return
    await onDeleteEdge(editArrow.reglaId)
    setEditArrow(null)
  }

  async function removeOperation(frac: number) {
    setManualPlacements((prev) => {
      const next = new Map(prev)
      for (const [key, val] of prev) { if (val === frac) next.delete(key) }
      return next
    })
    const rulesToDelete = new Set<string>()
    for (const [key, arrow] of arrowMap.entries()) {
      if (key.startsWith(`${frac}->`) || key.endsWith(`->${frac}`)) rulesToDelete.add(arrow.reglaId)
    }
    for (const id of rulesToDelete) await onDeleteEdge(id)
  }

  // ─── Render ─────────────────────────────────────────────────────────

  if (operaciones.length === 0) {
    return <div className="text-sm text-muted-foreground py-8 text-center">Sin operaciones.</div>
  }

  return (
    <div className="space-y-3">
      {/* Operations palette */}
      <div className="border rounded-lg bg-muted/30 p-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Operaciones — arrastra a la tabla ({unplacedCount} sin asignar)
        </h4>
        <div className="flex flex-wrap gap-2">
          {operaciones.map((op) => {
            const isPlaced = placed.has(op.fraccion)
            const color = processColor(op.input_o_proceso)
            return (
              <div
                key={op.fraccion}
                draggable={!isPlaced}
                onDragStart={!isPlaced ? (e) => handleDragStart(e, op.fraccion) : undefined}
                className={`rounded-md border-l-4 bg-card border shadow-sm px-2.5 py-1.5 w-40 select-none transition-opacity ${
                  isPlaced ? 'opacity-30 cursor-default' : 'cursor-grab active:cursor-grabbing hover:shadow-md'
                }`}
                style={{ borderLeftColor: color }}
              >
                <div className="text-[10px] text-muted-foreground font-mono font-bold">F{op.fraccion}</div>
                <div className="text-xs font-medium truncate" title={op.operacion}>{op.operacion}</div>
                <span className="text-[8px] font-semibold px-1 py-0.5 rounded-full mt-0.5 inline-block"
                  style={{ backgroundColor: color + '20', color }}>{op.input_o_proceso}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Grid */}
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-muted/50 border-b">
              <th className="px-2 py-2 text-left font-semibold w-12 border-r">#</th>
              {Array.from({ length: totalCols }, (_, c) => (
                <Fragment key={c}>
                  <th className="px-2 py-2 text-center font-semibold min-w-[140px] border-r">{c + 1}</th>
                  {c < totalCols - 1 && (
                    <th className="px-2 py-2 text-center font-semibold text-muted-foreground min-w-[80px] border-r">BUFFER</th>
                  )}
                </Fragment>
              ))}
              <th className="px-2 py-2 w-20">
                <Button size="sm" variant="ghost" className="h-6 text-[10px]"
                  onClick={() => setExtraCols((c) => c + 1)}>AGREGAR +</Button>
              </th>
            </tr>
          </thead>
          <tbody ref={tableBodyRef}>
            {displayGrid.map((row, rowIdx) => {
              const isGroupStart = rowIdx > 0 && derived.groupBoundaries.includes(rowIdx)
              return (
              <tr key={rowIdx} className={`border-b hover:bg-muted/10 ${isGroupStart ? 'border-t-2 border-t-muted-foreground/25' : ''}`}>
                <td className="px-3 py-3 font-bold text-muted-foreground border-r text-center">{rowIdx + 1}</td>
                {row.map((frac, colIdx) => {
                  const cellKey = `${rowIdx},${colIdx}`
                  const isResizeSource = resizeSpan?.key === cellKey
                  const isResizeCovered = !isResizeSource && resizeSpan != null && (() => {
                    const [rr, rc] = resizeSpan.key.split(',').map(Number)
                    return colIdx === rc && rowIdx > rr && rowIdx < rr + resizeSpan.span
                  })()
                  const isSkipped = skipSet.has(cellKey) || isResizeCovered

                  // Cell covered by a rowSpan from above or resize → only render buffer cell
                  if (isSkipped) {
                    return (
                      <Fragment key={colIdx}>
                        {/* Operation td is NOT rendered — covered by rowSpan above */}
                        {colIdx < row.length - 1 && (
                          <td className="px-1 py-2 border-r min-w-[80px] align-middle text-center">
                            {renderBufferCell(rowIdx, colIdx)}
                          </td>
                        )}
                      </Fragment>
                    )
                  }

                  const span = isResizeSource ? resizeSpan!.span : spanMap.get(cellKey)
                  const op = frac != null ? opMap.get(frac) : null
                  const color = op ? processColor(op.input_o_proceso) : '#94A3B8'
                  const cellId = `${rowIdx}-${colIdx}`
                  const isDropHere = dropTarget === cellId

                  return (
                    <Fragment key={colIdx}>
                      {/* Operation cell (with potential rowSpan) */}
                      <td
                        rowSpan={span}
                        className={`px-2 py-2 border-r min-w-[140px] align-middle ${
                          frac == null && dragFrac != null ? 'bg-muted/5' : ''
                        } ${isDropHere ? 'bg-indigo-500/10' : ''} ${isResizeSource && resizeSpan!.span > 1 ? 'bg-indigo-500/5' : ''}`}
                        onDragOver={frac == null ? (e) => handleDragOver(e, cellId) : undefined}
                        onDragLeave={frac == null ? handleDragLeave : undefined}
                        onDrop={frac == null ? (e) => handleDrop(e, rowIdx, colIdx) : undefined}
                      >
                        {op ? (
                          <div className="group relative rounded-md border-l-4 bg-card border shadow-sm px-2 py-1.5 select-none"
                            style={{ borderLeftColor: color }}>
                            <button
                              className="absolute -top-1.5 -right-1.5 bg-destructive/80 hover:bg-destructive rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                              onClick={() => removeOperation(frac!)}>
                              <X className="h-2.5 w-2.5 text-white" />
                            </button>
                            <div className="text-[10px] text-muted-foreground font-mono font-bold">F{frac}</div>
                            <div className="text-xs font-medium truncate" title={op.operacion}>{op.operacion}</div>
                            <span className="text-[8px] font-semibold px-1 py-0.5 rounded-full mt-0.5 inline-block"
                              style={{ backgroundColor: color + '20', color }}>{op.input_o_proceso}</span>
                            {/* Resize handle — drag to stretch card across rows */}
                            <div
                              className="absolute -bottom-1 left-2 right-2 h-3 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity flex justify-center items-center"
                              onMouseDown={(e) => startResize(e, rowIdx, colIdx, frac!, span || 1)}
                              title="Arrastra para estirar"
                            >
                              <div className="w-8 h-[3px] bg-indigo-400/50 rounded-full hover:bg-indigo-400" />
                            </div>
                          </div>
                        ) : isDropHere ? (
                          <div className="h-14 rounded-md border-2 border-dashed border-indigo-500 bg-indigo-500/10 flex items-center justify-center">
                            <span className="text-[10px] text-indigo-400">Soltar aqui</span>
                          </div>
                        ) : (
                          <div className={`h-14 rounded-md border border-dashed flex items-center justify-center ${
                            dragFrac != null ? 'border-muted-foreground/30 bg-muted/5' : 'border-muted-foreground/10'
                          }`}>
                            <Plus className="h-3 w-3 text-muted-foreground/15" />
                          </div>
                        )}
                      </td>

                      {/* Buffer cell */}
                      {colIdx < row.length - 1 && (
                        <td className="px-1 py-2 border-r min-w-[80px] align-middle text-center">
                          {renderBufferCell(rowIdx, colIdx)}
                        </td>
                      )}
                    </Fragment>
                  )
                })}
                <td className="px-2 py-2" />
              </tr>
            )})}
            <tr>
              <td colSpan={totalCols * 2} className="px-3 py-2 text-center">
                <Button size="sm" variant="ghost" className="text-xs text-muted-foreground"
                  onClick={() => setExtraRows((r) => r + 1)}>AGREGAR +</Button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Buffer modal */}
      {editArrow && (
        <div className="fixed inset-0 z-50 bg-black/20" onClick={() => setEditArrow(null)}>
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card border rounded-lg shadow-lg p-4 min-w-[320px] z-50"
            onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-medium mb-1">
              {editArrow.mode === 'create' ? 'Crear Precedencia' : 'Editar Buffer'}
            </div>
            <div className="text-xs text-muted-foreground mb-3">
              F{editArrow.fromFrac} &rarr; F{editArrow.toFrac}
            </div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-muted-foreground">Buffer:</span>
              <Select value={editType} onValueChange={(v) => setEditType(v as 'todo' | 'numero')}>
                <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todo">Todo</SelectItem>
                  <SelectItem value="numero">Especifico</SelectItem>
                </SelectContent>
              </Select>
              {editType === 'numero' && (
                <>
                  <Input type="number" min={0} step={50} className="h-8 w-24 text-xs"
                    value={editVal} onChange={(e) => setEditVal(e.target.value)} />
                  <span className="text-xs text-muted-foreground">pares</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" className="text-xs" onClick={saveBuffer}>
                {editArrow.mode === 'create' ? 'Crear' : 'Guardar'}
              </Button>
              {editArrow.mode === 'edit' && (
                <Button size="sm" variant="ghost" className="text-xs text-destructive" onClick={deleteConnection}>
                  <Trash2 className="h-3 w-3 mr-1" /> Eliminar
                </Button>
              )}
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => setEditArrow(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
