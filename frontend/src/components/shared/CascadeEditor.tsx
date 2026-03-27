'use client'

import { Fragment, useState, useMemo, useEffect, useRef, useCallback, DragEvent } from 'react'
import type { OperacionFull } from '@/lib/hooks/useCatalogo'
import type { Restriccion } from '@/types'
import { STAGE_COLORS } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Trash2, Plus, X, Download, Layers, Link } from 'lucide-react'

// ─── Props ───────────────────────────────────────────────────────────

export interface CascadeEditorProps {
  operaciones: OperacionFull[]
  reglas: Restriccion[]
  onConnect: (origen: number[], destino: number[], buffer: number | 'todo' | 'rate' | 'dia') => Promise<void>
  onDeleteEdge: (reglaId: string) => Promise<void>
  onUpdateBuffer: (reglaId: string, buffer: number | 'todo' | 'rate' | 'dia') => Promise<void>
  /** Optional title used for the PDF export filename */
  title?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────

interface ArrowInfo { reglaId: string; buffer: unknown }
interface GroupInfo { stage: string; fracs: number[]; ops: OperacionFull[] }
interface CrossArrowPos { key: string; x1: number; y1: number; x2: number; y2: number; label: string; fromFrac: number; toFrac: number }

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

  // Compute depths via topological order (Kahn's algorithm) — immune to cycles
  const depth = new Map<number, number>()
  const inDeg = new Map<number, number>()
  for (const f of connectedFracs) inDeg.set(f, 0)
  for (const [, dsts] of adj) {
    for (const d of dsts) {
      if (connectedFracs.has(d)) inDeg.set(d, (inDeg.get(d) || 0) + 1)
    }
  }
  const roots = [...connectedFracs].filter((f) => (inDeg.get(f) || 0) === 0).sort((a, b) => a - b)
  const queue: number[] = [...roots]
  for (const r of roots) depth.set(r, 0)
  while (queue.length > 0) {
    const cur = queue.shift()!
    const curDepth = depth.get(cur) ?? 0
    for (const next of (adj.get(cur) || []).sort((a, b) => a - b)) {
      if (!connectedFracs.has(next)) continue
      const newDepth = curDepth + 1
      if (!depth.has(next) || depth.get(next)! < newDepth) depth.set(next, newDepth)
      const newIn = (inDeg.get(next) || 1) - 1
      inDeg.set(next, newIn)
      if (newIn <= 0) queue.push(next)
    }
  }
  // Nodes in cycles won't be visited — assign them depth 0
  for (const f of connectedFracs) { if (!depth.has(f)) depth.set(f, 0) }

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
  // Pre-compute chain lengths to sort roots: longest chain first
  function chainLength(start: number, vis: Set<number>): number {
    let len = 0
    let cur: number | undefined = start
    while (cur !== undefined && !vis.has(cur)) {
      vis.add(cur); len++
      const succs: number[] = (adj.get(cur) || []).filter((t: number) => !vis.has(t))
      cur = succs.length > 0 ? succs.sort((a: number, b: number) => a - b)[0] : undefined
    }
    return len
  }
  const rootLengths = roots.map((r) => ({ root: r, len: chainLength(r, new Set(visited)) }))
  rootLengths.sort((a, b) => b.len - a.len || a.root - b.root)

  const groupBoundaries: number[] = []
  for (const { root } of rootLengths) {
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
  operaciones, reglas, onConnect, onDeleteEdge, onUpdateBuffer, title,
}: CascadeEditorProps) {
  // ─── Stage collapsing ──────────────────────────────────────────────
  const [collapsedStages, setCollapsedStages] = useState<Set<string>>(new Set())

  const uniqueStages = useMemo(() => {
    const stages = new Set<string>()
    for (const op of operaciones) stages.add(op.input_o_proceso)
    return [...stages]
  }, [operaciones])

  function toggleCollapse(stage: string) {
    setCollapsedStages((prev) => {
      const next = new Set(prev)
      if (next.has(stage)) next.delete(stage); else next.add(stage)
      return next
    })
  }

  // Pre-process: collapse stages into virtual representative nodes
  const { effectiveOps, effectiveReglas, groupInfo, collapsedFracSet } = useMemo(() => {
    if (collapsedStages.size === 0) {
      return {
        effectiveOps: operaciones, effectiveReglas: reglas,
        groupInfo: new Map<number, GroupInfo>(), collapsedFracSet: new Set<number>(),
      }
    }

    const groupInfo = new Map<number, GroupInfo>()
    const collapsedFracs = new Map<number, number>() // frac → representative
    const collapsedFracSet = new Set<number>()
    const effectiveOps: OperacionFull[] = []

    for (const stage of collapsedStages) {
      const stageOps = operaciones.filter((op) => op.input_o_proceso === stage).sort((a, b) => a.fraccion - b.fraccion)
      if (stageOps.length === 0) continue
      const fracs = stageOps.map((op) => op.fraccion)
      const rep = fracs[0]

      for (const f of fracs) { collapsedFracs.set(f, rep); collapsedFracSet.add(f) }
      groupInfo.set(rep, { stage, fracs, ops: stageOps })

      effectiveOps.push({
        ...stageOps[0],
        fraccion: rep,
        operacion: `${stage} (F${fracs[0]}\u2013F${fracs[fracs.length - 1]})`,
      })
    }

    for (const op of operaciones) {
      if (!collapsedFracSet.has(op.fraccion)) effectiveOps.push(op)
    }

    const seenKeys = new Set<string>()
    const effectiveReglas: Restriccion[] = []
    for (const r of reglas) {
      const p = r.parametros as Record<string, unknown>
      const origFracs = (p.fracciones_origen as number[]) || []
      const destFracs = (p.fracciones_destino as number[]) || []

      const newOrig = [...new Set(origFracs.map((f) => collapsedFracs.get(f) ?? f))].sort((a, b) => a - b)
      const newDest = [...new Set(destFracs.map((f) => collapsedFracs.get(f) ?? f))].sort((a, b) => a - b)

      // Skip internal rules within collapsed stage
      if (newOrig.length === 1 && newDest.length === 1 && newOrig[0] === newDest[0]) continue

      const key = `${newOrig.join(',')}->${newDest.join(',')}`
      if (seenKeys.has(key)) continue
      seenKeys.add(key)

      effectiveReglas.push({
        ...r,
        parametros: { ...p, fracciones_origen: newOrig, fracciones_destino: newDest },
      })
    }

    return { effectiveOps, effectiveReglas, groupInfo, collapsedFracSet }
  }, [operaciones, reglas, collapsedStages])

  // ─── Derived data from effective (possibly collapsed) ops/reglas ───
  const opMap = useMemo(() => {
    const m = new Map<number, OperacionFull>()
    for (const op of effectiveOps) m.set(op.fraccion, op)
    return m
  }, [effectiveOps])

  const arrowMap = useMemo(() => buildArrowMap(effectiveReglas), [effectiveReglas])
  const arrowMapRef = useRef(arrowMap)
  arrowMapRef.current = arrowMap
  // Stable refs for callbacks (avoid useEffect re-runs during drag)
  const onConnectRef = useRef(onConnect)
  onConnectRef.current = onConnect
  const onDeleteEdgeRef = useRef(onDeleteEdge)
  onDeleteEdgeRef.current = onDeleteEdge
  // Stabilize row order: match new rows to previous rows by any shared frac
  const prevRowOrderRef = useRef<number[][]>([])
  const derived = useMemo(() => {
    const raw = deriveGrid(effectiveOps, effectiveReglas)
    const prevOrder = prevRowOrderRef.current

    // If no previous state, use as-is
    if (prevOrder.length === 0 || raw.grid.length === 0) {
      prevRowOrderRef.current = raw.grid.map((row) => row.filter((v): v is number => v !== null))
      return raw
    }

    const newRows = raw.grid.filter((row) => row.some((v) => v !== null))
    const emptyRows = raw.grid.filter((row) => row.every((v) => v === null))

    // Map each frac → which new row it belongs to
    const fracToNewRow = new Map<number, number>()
    for (let i = 0; i < newRows.length; i++) {
      for (const v of newRows[i]) {
        if (v !== null) fracToNewRow.set(v, i)
      }
    }

    const stabilized: (number | null)[][] = []
    const placedNewIdx = new Set<number>()

    // First: for each previous row, find the best matching new row
    // (the new row that contains the most fracs from the previous row)
    for (const prevFracs of prevOrder) {
      if (prevFracs.length === 0) continue
      // Count how many fracs from this prev row land in each new row
      const hits = new Map<number, number>()
      for (const f of prevFracs) {
        const idx = fracToNewRow.get(f)
        if (idx !== undefined) hits.set(idx, (hits.get(idx) || 0) + 1)
      }
      // Pick the new row with the most overlap (not yet placed)
      let bestIdx = -1
      let bestCount = 0
      for (const [idx, count] of hits) {
        if (!placedNewIdx.has(idx) && count > bestCount) {
          bestIdx = idx
          bestCount = count
        }
      }
      if (bestIdx >= 0) {
        stabilized.push(newRows[bestIdx])
        placedNewIdx.add(bestIdx)
      }
    }

    // Then: append any new rows not matched to previous order
    for (let i = 0; i < newRows.length; i++) {
      if (!placedNewIdx.has(i)) stabilized.push(newRows[i])
    }

    // Pad with empty rows
    for (const row of emptyRows) stabilized.push(row)
    while (stabilized.length < 5) stabilized.push(Array(raw.grid[0]?.length ?? 3).fill(null))

    // Rebuild placements for stabilized grid
    const stablePlacements = new Map<string, number>()
    for (let r = 0; r < stabilized.length; r++) {
      for (let c = 0; c < stabilized[r].length; c++) {
        const v = stabilized[r][c]
        if (v !== null) stablePlacements.set(`${r},${c}`, v)
      }
    }

    prevRowOrderRef.current = stabilized.map((row) => row.filter((v): v is number => v !== null))
    return { grid: stabilized, placements: stablePlacements, groupBoundaries: raw.groupBoundaries }
  }, [effectiveOps, effectiveReglas])

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

  // Frac → column lookup (for detecting non-adjacent connections)
  const fracCol = useMemo(() => {
    const m = new Map<number, number>()
    for (let r = 0; r < totalRows; r++) {
      for (let c = 0; c < totalCols; c++) {
        const f = displayGrid[r]?.[c]
        if (f != null) m.set(f, c)
      }
    }
    return m
  }, [displayGrid, totalRows, totalCols])

  // ─── Cross-column SVG arrows ──────────────────────────────────────
  const crossColConns = useMemo(() => {
    const conns: { src: number; dst: number; buffer: unknown }[] = []
    for (const [key, arrow] of arrowMap) {
      const idx = key.indexOf('->')
      const src = parseInt(key.substring(0, idx))
      const dst = parseInt(key.substring(idx + 2))
      const srcCol = fracCol.get(src)
      const dstCol = fracCol.get(dst)
      if (srcCol == null || dstCol == null) continue
      if (Math.abs(dstCol - srcCol) > 1) {
        conns.push({ src, dst, buffer: arrow.buffer })
      }
    }
    return conns
  }, [arrowMap, fracCol])

  const [crossArrowPositions, setCrossArrowPositions] = useState<CrossArrowPos[]>([])

  useEffect(() => {
    if (crossColConns.length === 0) { setCrossArrowPositions([]); return }

    function compute() {
      const wrapper = svgWrapperRef.current
      if (!wrapper) return
      const wrapperRect = wrapper.getBoundingClientRect()

      const positions: CrossArrowPos[] = []
      for (const conn of crossColConns) {
        const srcEl = wrapper.querySelector(`[data-frac="${conn.src}"]`) as HTMLElement | null
        const dstEl = wrapper.querySelector(`[data-frac="${conn.dst}"]`) as HTMLElement | null
        if (!srcEl || !dstEl) continue

        const srcRect = srcEl.getBoundingClientRect()
        const dstRect = dstEl.getBoundingClientRect()

        // Connect at right edge of source → left edge of destination
        const isForward = dstRect.left > srcRect.right
        const x1 = (isForward ? srcRect.right : srcRect.left) - wrapperRect.left
        const x2 = (isForward ? dstRect.left : dstRect.right) - wrapperRect.left
        // Connect at upper-third of card (near operation name, above badges)
        const y1 = srcRect.top + Math.min(srcRect.height * 0.35, 28) - wrapperRect.top
        const y2 = dstRect.top + Math.min(dstRect.height * 0.35, 28) - wrapperRect.top

        const label = conn.buffer === 'todo' ? 'Todo' : conn.buffer === 'rate' ? '1h rate' : conn.buffer === 'dia' ? '1 día' : `${conn.buffer || 0}p`
        positions.push({ key: `${conn.src}->${conn.dst}`, x1, y1, x2, y2, label, fromFrac: conn.src, toFrac: conn.dst })
      }
      setCrossArrowPositions(positions)
    }

    const raf = requestAnimationFrame(compute)
    const observer = new ResizeObserver(() => requestAnimationFrame(compute))
    const el = svgWrapperRef.current
    if (el) observer.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crossColConns, displayGrid])

  const placed = useMemo(() => {
    const s = new Set<number>()
    for (const [, frac] of derived.placements) s.add(frac)
    for (const [, frac] of manualPlacements) s.add(frac)
    // Mark non-representative collapsed fracs as placed (hidden from palette)
    for (const f of collapsedFracSet) {
      // Don't mark representative fracs — they appear as group cards in palette
      let isRep = false
      for (const [rep] of groupInfo) { if (rep === f) { isRep = true; break } }
      if (!isRep) s.add(f)
    }
    return s
  }, [derived.placements, manualPlacements, collapsedFracSet])
  const placedRef = useRef(placed)
  placedRef.current = placed

  const unplacedCount = effectiveOps.filter((op) => !placed.has(op.fraccion)).length

  // ─── Cell spanning (rowSpan) ──────────────────────────────────────

  const { spanMap, skipSet, getEffectiveFrac } = useMemo(() => {
    const spanMap = new Map<string, number>()   // "row,col" → span count
    const skipSet = new Set<string>()           // "row,col" → skip rendering (covered by span)

    // Build frac → row lookup for all placed fracs
    const fracRow = new Map<number, number>()
    for (let r = 0; r < totalRows; r++) {
      for (let c = 0; c < totalCols; c++) {
        const f = displayGrid[r]?.[c]
        if (f != null) fracRow.set(f, r)
      }
    }

    for (let col = 0; col < totalCols; col++) {
      for (let row = 0; row < totalRows; row++) {
        const frac = displayGrid[row]?.[col]
        if (frac == null) continue

        // Find max row across ALL connected fracs (predecessors + successors, any column)
        let maxRow = row
        for (const [key] of arrowMap) {
          const idx = key.indexOf('->')
          const src = parseInt(key.substring(0, idx))
          const dst = parseInt(key.substring(idx + 2))
          if (src !== frac && dst !== frac) continue
          const otherRow = fracRow.get(src === frac ? dst : src)
          if (otherRow != null) maxRow = Math.max(maxRow, otherRow)
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

  const [exporting, setExporting] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const svgWrapperRef = useRef<HTMLDivElement>(null)

  const exportPdf = useCallback(async () => {
    if (!gridRef.current) return
    setExporting(true)
    try {
      const html2canvas = (await import('html2canvas-pro')).default
      const { jsPDF } = await import('jspdf')

      // Temporarily switch to light mode for the screenshot
      const root = document.documentElement
      const wasDark = root.classList.contains('dark')
      if (wasDark) root.classList.remove('dark')
      root.classList.add('light')
      // Small delay for styles to repaint
      await new Promise((r) => setTimeout(r, 50))

      const hidden: HTMLElement[] = []

      // 1. Hide empty rows + AGREGAR row
      gridRef.current.querySelectorAll('tbody tr').forEach((tr) => {
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

      // 2. Hide non-buffer buttons (X delete, dashed arrows, AGREGAR+)
      //    Keep buffer pills (emerald/cyan themed)
      gridRef.current.querySelectorAll('button').forEach((btn) => {
        const cls = (btn as HTMLElement).className || ''
        if (cls.includes('emerald') || cls.includes('cyan')) return
        ;(btn as HTMLElement).style.display = 'none'
        hidden.push(btn as HTMLElement)
      })

      // 3. Hide resize handles
      gridRef.current.querySelectorAll('.cursor-ns-resize').forEach((el) => {
        (el as HTMLElement).style.display = 'none'
        hidden.push(el as HTMLElement)
      })

      // 4. Hide AGREGAR+ column header + last td in each row
      const thLast = gridRef.current.querySelector('thead tr th:last-child') as HTMLElement | null
      if (thLast?.textContent?.includes('AGREGAR')) {
        thLast.style.display = 'none'
        hidden.push(thLast)
        gridRef.current.querySelectorAll('tbody tr').forEach((tr) => {
          const lastTd = tr.querySelector('td:last-child') as HTMLElement | null
          if (lastTd) { lastTd.style.display = 'none'; hidden.push(lastTd) }
        })
      }

      const canvas = await html2canvas(gridRef.current, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        width: gridRef.current.scrollWidth,
      })

      // Restore: unhide elements + restore dark mode
      hidden.forEach((el) => { el.style.display = '' })
      root.classList.remove('light')
      if (wasDark) root.classList.add('dark')

      const imgW = canvas.width
      const imgH = canvas.height
      const orientation = imgW > imgH ? 'landscape' : 'portrait'
      const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4' })
      const pageW = pdf.internal.pageSize.getWidth()
      const margin = 10
      const maxW = pageW - margin * 2
      const scale = maxW / imgW
      const finalW = maxW
      const finalH = imgH * scale

      // Title
      pdf.setFontSize(14)
      pdf.text(title || 'Cascada de Precedencias', margin, 12)
      pdf.setFontSize(8)
      pdf.setTextColor(120)
      pdf.text(new Date().toLocaleDateString('es-MX'), margin, 17)
      pdf.setTextColor(0)

      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, 20, finalW, finalH)

      // 5. Add unplaced operations section
      const unplacedOps = effectiveOps.filter((op) => !placed.has(op.fraccion))
      if (unplacedOps.length > 0) {
        let y = 20 + finalH + 8
        const pageH = pdf.internal.pageSize.getHeight()
        if (y + 20 > pageH) { pdf.addPage(); y = margin }

        pdf.setFontSize(10)
        pdf.setTextColor(80)
        pdf.text('Operaciones sin asignar', margin, y)
        y += 5

        pdf.setFontSize(8)
        pdf.setTextColor(60)
        for (const op of unplacedOps) {
          if (y + 5 > pageH) { pdf.addPage(); y = margin }
          const gi = groupInfo.get(op.fraccion)
          const label = gi
            ? `${gi.stage} (F${gi.fracs[0]}\u2013F${gi.fracs[gi.fracs.length - 1]}, ${gi.fracs.length} ops)`
            : `F${op.fraccion} \u2014 ${op.operacion} [${op.input_o_proceso}]`
          pdf.text(`\u2022  ${label}`, margin + 2, y)
          y += 4
        }
        pdf.setTextColor(0)
      }

      pdf.save(`${title || 'cascada'}.pdf`)
    } catch (err) {
      console.error('[CascadeEditor] PDF export failed:', err)
    } finally {
      setExporting(false)
    }
  }, [title, effectiveOps, placed, groupInfo])

  // DnD state
  const [dragFrac, setDragFrac] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  // Buffer edit modal
  const [editArrow, setEditArrow] = useState<{
    mode: 'edit' | 'create'; reglaId: string | null; fromFrac: number; toFrac: number; buffer: unknown
  } | null>(null)
  const [editType, setEditType] = useState<'todo' | 'numero' | 'rate' | 'dia'>('numero')
  const [editVal, setEditVal] = useState('0')

  // Visual connect mode: click card A → click card B → open buffer modal
  const [linkFrom, setLinkFrom] = useState<number | null>(null)

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
        // Find nearest operation to the left of col in a given row
        function findLeftNeighbor(row: number, col: number): number | null {
          for (let c = col - 1; c >= 0; c--) {
            const f = grid[row]?.[c]
            if (f != null) return f
          }
          return null
        }
        // Grow: create connections for newly covered rows (skip if it would create a cycle)
        for (let r = info.row + info.initialSpan; r < info.row + info.span; r++) {
          const parentFrac = findLeftNeighbor(r, info.col)
          if (parentFrac != null && !arrows.has(`${parentFrac}->${info.frac}`) && !wouldCreateCycle(parentFrac, info.frac)) {
            try { await onConnectRef.current([parentFrac], [info.frac], 0) } catch (err) { console.warn('[CascadeEditor] resize connect:', err) }
          }
        }
        // Shrink: remove connections for rows no longer covered
        for (let r = info.row + info.span; r < info.row + info.initialSpan; r++) {
          const parentFrac = findLeftNeighbor(r, info.col)
          if (parentFrac != null) {
            const arrow = arrows.get(`${parentFrac}->${info.frac}`)
            if (arrow) {
              try { await onDeleteEdgeRef.current(arrow.reglaId) } catch (err) { console.warn('[CascadeEditor] resize delete:', err) }
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

  // Check if adding edge from→to would create a cycle (BFS reachability: to→from)
  function wouldCreateCycle(from: number, to: number): boolean {
    if (from === to) return true
    const visited = new Set<number>()
    const q = [to]
    visited.add(to)
    while (q.length > 0) {
      const cur = q.shift()!
      for (const [key] of arrowMapRef.current) {
        const [src, dst] = key.split('->').map(Number)
        if (src === cur && !visited.has(dst)) {
          if (dst === from) return true
          visited.add(dst)
          q.push(dst)
        }
      }
    }
    return false
  }

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

  // ─── Non-adjacent connection badges (shown on cards) ─────────────
  function renderCrossColBadges(frac: number, colIdx: number) {
    const badges: { fromFrac: number; arrow: ArrowInfo; dir: 'in' | 'out' }[] = []
    for (const [key, arrow] of arrowMap) {
      const idx = key.indexOf('->')
      const src = parseInt(key.substring(0, idx))
      const dst = parseInt(key.substring(idx + 2))
      if (src === frac) {
        const dstCol = fracCol.get(dst)
        if (dstCol != null && dstCol !== colIdx + 1) badges.push({ fromFrac: dst, arrow, dir: 'out' })
      }
      if (dst === frac) {
        const srcCol = fracCol.get(src)
        if (srcCol != null && srcCol !== colIdx - 1) badges.push({ fromFrac: src, arrow, dir: 'in' })
      }
    }
    if (badges.length === 0) return null
    return (
      <div className="flex flex-wrap gap-0.5 mt-1">
        {badges.map((b) => (
          <button key={`${b.dir}-${b.fromFrac}`}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-violet-500/20 border border-violet-500/40 text-violet-300 hover:bg-violet-500/30 cursor-pointer transition-colors"
            onClick={(e) => { e.stopPropagation(); openBufferEdit(b.dir === 'in' ? b.fromFrac : frac, b.dir === 'in' ? frac : b.fromFrac) }}
            title={`${b.dir === 'in' ? `F${b.fromFrac} → F${frac}` : `F${frac} → F${b.fromFrac}`} (clic para editar buffer)`}
          >
            <span className="text-[8px] font-bold">{b.dir === 'in' ? `← F${b.fromFrac}` : `→ F${b.fromFrac}`}</span>
            <span className="text-[8px] font-bold">{b.arrow.buffer === 'todo' ? 'Todo' : b.arrow.buffer === 'rate' ? '1h rate' : b.arrow.buffer === 'dia' ? '1 día' : `${b.arrow.buffer || 0}p`}</span>
          </button>
        ))}
      </div>
    )
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

    // Remove cross-row duplicates of the direct connection (can happen with rowSpan)
    const filteredCross = directRule && curFrac != null && nxtFrac != null
      ? crossRowConns.filter((c) => !(c.fromFrac === curFrac && c.toFrac === nxtFrac))
      : crossRowConns

    const showFadedArrow = hasDirectPair && !directRule
    if (!directRule && !showFadedArrow && filteredCross.length === 0) return null

    return (
      <div className="flex flex-col items-center gap-0.5">
        {hasDirectPair && (
          directRule ? (
            <button
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors cursor-pointer text-emerald-400"
              onClick={() => openBufferEdit(curFrac!, nxtFrac!)}
            >
              <span className="text-[10px] font-bold whitespace-nowrap">
                {directRule.buffer === 'todo' ? 'Todo' : directRule.buffer === 'rate' ? '1h rate' : directRule.buffer === 'dia' ? '1 día' : `${directRule.buffer || 0}p`}
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

        {filteredCross.map((c, i) => {
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
                {c.arrow.buffer === 'todo' ? 'Todo' : c.arrow.buffer === 'rate' ? '1h rate' : c.arrow.buffer === 'dia' ? '1 día' : `${c.arrow.buffer || 0}p`}
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
      if (ownerFrac != null && ownerFrac !== frac && !wouldCreateCycle(ownerFrac, frac)) {
        try {
          // Use all group fracs for collapsed stages
          const ownerGroup = groupInfo.get(ownerFrac)
          const droppedGroup = groupInfo.get(frac)
          const origFracs = ownerGroup ? ownerGroup.fracs : [ownerFrac]
          const destFracs = droppedGroup ? droppedGroup.fracs : [frac]
          await onConnect(origFracs, destFracs, 0)
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
      const isRate = arrow.buffer === 'rate'
      const isDia = arrow.buffer === 'dia'
      setEditArrow({ mode: 'edit', reglaId: arrow.reglaId, fromFrac, toFrac, buffer: arrow.buffer })
      setEditType(isTodo ? 'todo' : isRate ? 'rate' : isDia ? 'dia' : 'numero')
      setEditVal(isTodo || isRate || isDia ? '0' : String(arrow.buffer || 0))
    } else {
      setEditArrow({ mode: 'create', reglaId: null, fromFrac, toFrac, buffer: 0 })
      setEditType('numero')
      setEditVal('0')
    }
  }

  // Helper: check if a rule is a group rule (multiple source or dest fracs)
  function getGroupPairs(reglaId: string): { origFracs: number[]; destFracs: number[]; oldBuffer: number | 'todo' | 'rate' } | null {
    const rule = reglas.find((r) => r.id === reglaId)
    if (!rule) return null
    const p = rule.parametros as Record<string, unknown>
    const origFracs = (p.fracciones_origen as number[]) || []
    const destFracs = (p.fracciones_destino as number[]) || []
    if (origFracs.length <= 1 && destFracs.length <= 1) return null // not a group rule
    const oldBuffer = p.buffer_pares === 'todo' ? ('todo' as const) : p.buffer_pares === 'rate' ? ('rate' as const) : p.buffer_pares === 'dia' ? ('dia' as const) : (typeof p.buffer_pares === 'number' ? p.buffer_pares : 0)
    return { origFracs, destFracs, oldBuffer }
  }

  async function saveBuffer() {
    if (!editArrow) return
    const buffer = editType === 'todo' ? ('todo' as const) : editType === 'rate' ? ('rate' as const) : editType === 'dia' ? ('dia' as const) : parseInt(editVal) || 0
    try {
      if (editArrow.mode === 'create') {
        await onConnect([editArrow.fromFrac], [editArrow.toFrac], buffer)
      } else if (editArrow.reglaId) {
        const group = getGroupPairs(editArrow.reglaId)
        if (group) {
          // Group rule — split into individual rules
          await onDeleteEdge(editArrow.reglaId)
          for (const o of group.origFracs) {
            for (const d of group.destFracs) {
              const pairBuffer = (o === editArrow.fromFrac && d === editArrow.toFrac) ? buffer : group.oldBuffer
              await onConnect([o], [d], pairBuffer)
            }
          }
        } else {
          await onUpdateBuffer(editArrow.reglaId, buffer)
        }
      }
      setEditArrow(null)
    } catch (err) {
      console.error('[CascadeEditor] saveBuffer failed:', err)
    }
  }

  async function deleteConnection() {
    if (!editArrow || !editArrow.reglaId) return
    const group = getGroupPairs(editArrow.reglaId)
    if (group) {
      // Group rule — delete old, re-create all EXCEPT this pair
      await onDeleteEdge(editArrow.reglaId)
      for (const o of group.origFracs) {
        for (const d of group.destFracs) {
          if (o === editArrow.fromFrac && d === editArrow.toFrac) continue
          await onConnect([o], [d], group.oldBuffer)
        }
      }
    } else {
      await onDeleteEdge(editArrow.reglaId)
    }
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

  function handleCardClick(frac: number) {
    if (linkFrom == null) return // not in connect mode
    if (linkFrom === -1) {
      // Waiting for source — select it
      setLinkFrom(frac)
    } else if (linkFrom === frac) {
      // Clicked same card — go back to waiting
      setLinkFrom(-1)
    } else {
      // Have source, this is destination — open buffer modal
      const from = linkFrom
      setLinkFrom(null)
      setEditArrow({ mode: 'create', reglaId: null, fromFrac: from, toFrac: frac, buffer: 0 })
      setEditType('numero')
      setEditVal('0')
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────

  if (operaciones.length === 0) {
    return <div className="text-sm text-muted-foreground py-8 text-center">Sin operaciones.</div>
  }

  return (
    <div className="space-y-3">
      {/* Operations palette */}
      <div className="border rounded-lg bg-muted/30 p-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Operaciones — arrastra a la tabla ({unplacedCount} sin asignar)
          </h4>
          <div className="flex items-center gap-1.5">
            {linkFrom != null ? (
              <Button size="sm" variant="destructive" className="h-7 text-[10px] animate-pulse" onClick={() => setLinkFrom(null)}>
                <X className="mr-1 h-3 w-3" />
                {linkFrom === -1 ? 'Selecciona origen...' : `F${linkFrom} → selecciona destino...`}
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => setLinkFrom(-1)}>
                <Link className="mr-1 h-3 w-3" /> Conectar
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={exportPdf} disabled={exporting}>
              <Download className="mr-1 h-3 w-3" /> {exporting ? 'Exportando...' : 'PDF'}
            </Button>
          </div>
        </div>
        {uniqueStages.length > 1 && (
          <div className="flex items-center gap-1.5 mb-2">
            <Layers className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground mr-1">Agrupar:</span>
            {uniqueStages.map((stage) => {
              const color = processColor(stage)
              const isCollapsed = collapsedStages.has(stage)
              const count = operaciones.filter((op) => op.input_o_proceso === stage).length
              return (
                <button
                  key={stage}
                  onClick={() => toggleCollapse(stage)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all ${
                    isCollapsed
                      ? 'border-current shadow-sm'
                      : 'border-muted-foreground/20 opacity-60 hover:opacity-100'
                  }`}
                  style={isCollapsed ? { backgroundColor: color + '20', color, borderColor: color + '50' } : { color }}
                  title={isCollapsed ? `${stage}: agrupado (${count} ops) — clic para expandir` : `Clic para agrupar ${stage} (${count} ops)`}
                >
                  {stage} ({count})
                </button>
              )
            })}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {effectiveOps.map((op) => {
            const isPlaced = placed.has(op.fraccion)
            const color = processColor(op.input_o_proceso)
            const gi = groupInfo.get(op.fraccion)
            return gi ? (
              <div
                key={`g-${op.fraccion}`}
                draggable={!isPlaced}
                onDragStart={!isPlaced ? (e) => handleDragStart(e, op.fraccion) : undefined}
                className={`rounded-md border-l-4 bg-card border shadow-sm px-2.5 py-1.5 w-48 select-none transition-opacity ${
                  isPlaced ? 'opacity-30 cursor-default' : 'cursor-grab active:cursor-grabbing hover:shadow-md'
                }`}
                style={{ borderLeftColor: color }}
              >
                <div className="flex items-center gap-1">
                  <Layers className="h-3 w-3" style={{ color }} />
                  <span className="text-[10px] font-bold" style={{ color }}>{gi.stage}</span>
                </div>
                <div className="text-[10px] text-muted-foreground font-mono">
                  F{gi.fracs[0]}&ndash;F{gi.fracs[gi.fracs.length - 1]} &middot; {gi.fracs.length} ops
                </div>
              </div>
            ) : (
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
      <div ref={gridRef} className="cascade-grid border rounded-lg overflow-x-auto">
      <div ref={svgWrapperRef} className="relative" style={{ width: 'fit-content', minWidth: '100%' }}>
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
                        {op && groupInfo.has(frac!) ? (() => {
                          const gi = groupInfo.get(frac!)!
                          const isLinkSource = linkFrom === frac
                          const isLinkTarget = linkFrom != null && linkFrom !== -1 && linkFrom !== frac
                          return (
                            <div
                              data-frac={frac}
                              className={`group relative rounded-md border-l-4 bg-card border shadow-sm px-3 py-2 select-none transition-all ${
                                isLinkSource ? 'ring-2 ring-emerald-500' : ''
                              } ${isLinkTarget ? 'ring-2 ring-indigo-500 cursor-pointer' : ''
                              } ${linkFrom === -1 ? 'cursor-pointer hover:ring-2 hover:ring-emerald-500/50' : ''}`}
                              style={{ borderLeftColor: color }}
                              onClick={linkFrom != null ? () => handleCardClick(frac!) : undefined}
                            >
                              <div className="flex items-center gap-1.5 mb-1">
                                <Layers className="h-3.5 w-3.5" style={{ color }} />
                                <span className="text-xs font-bold" style={{ color }}>{gi.stage}</span>
                              </div>
                              <div className="text-[10px] text-muted-foreground font-mono">
                                F{gi.fracs[0]}\u2013F{gi.fracs[gi.fracs.length - 1]} &middot; {gi.fracs.length} ops
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {gi.ops.slice(0, 4).map((o) => (
                                  <span key={o.fraccion} className="text-[7px] px-1 py-0.5 rounded bg-muted/50 text-muted-foreground truncate max-w-[80px]"
                                    title={o.operacion}>F{o.fraccion}</span>
                                ))}
                                {gi.ops.length > 4 && (
                                  <span className="text-[7px] px-1 py-0.5 rounded bg-muted/50 text-muted-foreground">+{gi.ops.length - 4}</span>
                                )}
                              </div>
                              {renderCrossColBadges(frac!, colIdx)}
                            </div>
                          )
                        })() : op ? (() => {
                          const isLinkSource = linkFrom === frac
                          const isLinkTarget = linkFrom != null && linkFrom !== -1 && linkFrom !== frac
                          return (
                          <div
                            data-frac={frac}
                            className={`group relative rounded-md border-l-4 bg-card border shadow-sm px-2 py-1.5 select-none transition-all ${
                              isLinkSource ? 'ring-2 ring-emerald-500' : ''
                            } ${isLinkTarget ? 'ring-2 ring-indigo-500 cursor-pointer' : ''
                            } ${linkFrom === -1 ? 'cursor-pointer hover:ring-2 hover:ring-emerald-500/50' : ''}`}
                            style={{ borderLeftColor: color }}
                            onClick={linkFrom != null ? () => handleCardClick(frac!) : undefined}
                          >
                            <button
                              className="absolute -top-1.5 -right-1.5 bg-destructive/80 hover:bg-destructive rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                              onClick={() => removeOperation(frac!)}>
                              <X className="h-2.5 w-2.5 text-white" />
                            </button>
                            <div className="text-[10px] text-muted-foreground font-mono font-bold">F{frac}</div>
                            <div className="text-xs font-medium truncate" title={op.operacion}>{op.operacion}</div>
                            <span className="text-[8px] font-semibold px-1 py-0.5 rounded-full mt-0.5 inline-block"
                              style={{ backgroundColor: color + '20', color }}>{op.input_o_proceso}</span>
                            {renderCrossColBadges(frac!, colIdx)}
                            {/* Resize handle — drag to stretch card across rows */}
                            <div
                              className="absolute -bottom-1 left-2 right-2 h-3 cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity flex justify-center items-center"
                              onMouseDown={(e) => startResize(e, rowIdx, colIdx, frac!, span || 1)}
                              title="Arrastra para estirar"
                            >
                              <div className="w-8 h-[3px] bg-indigo-400/50 rounded-full hover:bg-indigo-400" />
                            </div>
                          </div>
                          )
                        })() : isDropHere ? (
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

        {/* SVG overlay for cross-column arrows */}
        {crossArrowPositions.length > 0 && (
          <svg className="absolute top-0 left-0 w-full h-full pointer-events-none" style={{ zIndex: 10 }}>
            <defs>
              <marker id="cross-arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#8b5cf6" />
              </marker>
            </defs>
            {crossArrowPositions.map((a) => {
              const dx = a.x2 - a.x1
              const path = `M ${a.x1},${a.y1} C ${a.x1 + dx * 0.4},${a.y1} ${a.x2 - dx * 0.4},${a.y2} ${a.x2},${a.y2}`
              const midX = (a.x1 + a.x2) / 2
              const midY = (a.y1 + a.y2) / 2
              return (
                <g key={a.key}>
                  {/* Anchor dot at source card */}
                  <circle cx={a.x1} cy={a.y1} r="4" fill="#8b5cf6" opacity="0.9" />
                  {/* Curved dashed arrow */}
                  <path d={path} fill="none" stroke="#8b5cf6" strokeWidth="2.5" strokeDasharray="6 3" markerEnd="url(#cross-arrow)" opacity="0.85" />
                  {/* Clickable buffer label at midpoint */}
                  <g style={{ cursor: 'pointer', pointerEvents: 'auto' }} onClick={() => openBufferEdit(a.fromFrac, a.toFrac)}>
                    <rect x={midX - 22} y={midY - 10} width="44" height="18" rx="4" style={{ fill: 'hsl(var(--card))' }} stroke="#8b5cf6" strokeWidth="1" />
                    <text x={midX} y={midY} textAnchor="middle" dominantBaseline="central" fill="#8b5cf6" fontSize="10" fontWeight="bold">{a.label}</text>
                  </g>
                </g>
              )
            })}
          </svg>
        )}
      </div>
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
              <Select value={editType} onValueChange={(v) => setEditType(v as 'todo' | 'numero' | 'rate' | 'dia')}>
                <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todo">Todo</SelectItem>
                  <SelectItem value="numero">Específico</SelectItem>
                  <SelectItem value="rate">1h de rate</SelectItem>
                  <SelectItem value="dia">1 día laboral</SelectItem>
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
