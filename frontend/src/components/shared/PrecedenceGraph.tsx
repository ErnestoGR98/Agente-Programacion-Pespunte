'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { OperationNode, type OperationNodeData } from './OperationNode'
import type { OperacionFull } from '@/lib/hooks/useCatalogo'
import type { Restriccion } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Trash2, X } from 'lucide-react'

const nodeTypes = { operation: OperationNode }

// Etapa column ordering for swimlane layout
const ETAPA_ORDER = [
  'MESA', 'PRE-ROBOT', 'ROBOT', 'POST-LINEA', 'POST-PLANA-LINEA', 'MAQUILA', 'N/A',
]

function etapaIndex(etapa: string): number {
  const idx = ETAPA_ORDER.indexOf(etapa)
  return idx >= 0 ? idx : ETAPA_ORDER.length
}

/** Compute swimlane node positions grouped by etapa columns */
function computeNodes(operaciones: OperacionFull[]): Node[] {
  const groups = new Map<string, OperacionFull[]>()
  for (const op of operaciones) {
    const etapa = op.etapa || 'N/A'
    const list = groups.get(etapa) || []
    list.push(op)
    groups.set(etapa, list)
  }

  const sortedEtapas = [...groups.keys()].sort((a, b) => etapaIndex(a) - etapaIndex(b))

  const COL_WIDTH = 280
  const ROW_HEIGHT = 110
  const nodes: Node[] = []

  for (let col = 0; col < sortedEtapas.length; col++) {
    const etapa = sortedEtapas[col]
    const ops = groups.get(etapa)!.sort((a, b) => a.fraccion - b.fraccion)

    for (let row = 0; row < ops.length; row++) {
      const op = ops[row]
      nodes.push({
        id: String(op.fraccion),
        type: 'operation',
        position: { x: col * COL_WIDTH + 20, y: row * ROW_HEIGHT },
        data: {
          fraccion: op.fraccion,
          operacion: op.operacion,
          input_o_proceso: op.input_o_proceso,
          etapa: op.etapa,
          recurso: op.recurso,
        } satisfies OperationNodeData,
      })
    }
  }

  return nodes
}

/** Convert precedence rules to React Flow edges */
function computeEdges(reglas: Restriccion[], operaciones: OperacionFull[]): Edge[] {
  const fracSet = new Set(operaciones.map((o) => o.fraccion))
  const edges: Edge[] = []

  for (const r of reglas) {
    const p = r.parametros as Record<string, unknown>
    const fracsOrig = (p.fracciones_origen as number[]) || []
    const fracsDest = (p.fracciones_destino as number[]) || []
    const buffer = p.buffer_pares
    const label = buffer === 'todo' ? 'Todo' : buffer ? `${buffer}p` : '0p'

    const validOrig = fracsOrig.filter((f) => fracSet.has(f))
    const validDest = fracsDest.filter((f) => fracSet.has(f))
    if (validOrig.length === 0 || validDest.length === 0) continue

    // Draw edges from each origin to each destination
    for (let i = 0; i < validOrig.length; i++) {
      for (let j = 0; j < validDest.length; j++) {
        const isPrimary = i === 0 && j === 0
        edges.push({
          id: `${r.id}__${validOrig[i]}-${validDest[j]}`,
          source: String(validOrig[i]),
          target: String(validDest[j]),
          label: isPrimary ? label : undefined,
          animated: r.activa,
          style: {
            stroke: r.activa ? '#6366F1' : '#94A3B8',
            strokeWidth: isPrimary ? 2 : 1.5,
            opacity: isPrimary ? 1 : 0.35,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: r.activa ? '#6366F1' : '#94A3B8',
          },
          type: 'smoothstep',
          data: { reglaId: r.id, fracsOrig: validOrig, fracsDest: validDest, buffer },
        })
      }
    }
  }

  return edges
}

export interface PrecedenceGraphProps {
  operaciones: OperacionFull[]
  reglas: Restriccion[]
  onConnect: (origen: number[], destino: number[], buffer: number | 'todo') => Promise<void>
  onDeleteEdge: (reglaId: string) => Promise<void>
  onUpdateBuffer: (reglaId: string, buffer: number | 'todo') => Promise<void>
}

export function PrecedenceGraph({
  operaciones, reglas, onConnect: onConnectCb, onDeleteEdge, onUpdateBuffer,
}: PrecedenceGraphProps) {
  // Compute layout from data
  const layoutNodes = useMemo(() => computeNodes(operaciones), [operaciones])
  const layoutEdges = useMemo(() => computeEdges(reglas, operaciones), [reglas, operaciones])

  const [nodes, , onNodesChange] = useNodesState(layoutNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges)

  // Sync edges when reglas change (after CRUD operations)
  useEffect(() => { setEdges(layoutEdges) }, [layoutEdges, setEdges])

  // --- New connection dialog ---
  const [pending, setPending] = useState<Connection | null>(null)
  const [bufferType, setBufferType] = useState<'todo' | 'numero'>('numero')
  const [bufferValue, setBufferValue] = useState('0')

  // --- Edge edit popover ---
  const [selectedEdge, setSelectedEdge] = useState<{
    reglaId: string; x: number; y: number; fracsOrig: number[]; fracsDest: number[]; buffer: unknown
  } | null>(null)
  const [editBufferType, setEditBufferType] = useState<'todo' | 'numero'>('numero')
  const [editBufferValue, setEditBufferValue] = useState('0')

  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return
    // Prevent self-loops
    if (connection.source === connection.target) return
    setPending(connection)
    setBufferType('numero')
    setBufferValue('0')
  }, [])

  async function confirmConnection() {
    if (!pending?.source || !pending?.target) return
    const source = parseInt(pending.source)
    const target = parseInt(pending.target)
    const buffer = bufferType === 'todo' ? ('todo' as const) : parseInt(bufferValue) || 0
    await onConnectCb([source], [target], buffer)
    setPending(null)
  }

  const handleEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    const data = edge.data as { reglaId: string; fracsOrig: number[]; fracsDest: number[]; buffer: unknown } | undefined
    if (!data?.reglaId) return
    const isTodo = data.buffer === 'todo'
    setSelectedEdge({
      reglaId: data.reglaId,
      x: _event.clientX,
      y: _event.clientY,
      fracsOrig: data.fracsOrig,
      fracsDest: data.fracsDest,
      buffer: data.buffer,
    })
    setEditBufferType(isTodo ? 'todo' : 'numero')
    setEditBufferValue(isTodo ? '0' : String(data.buffer || 0))
  }, [])

  const handlePaneClick = useCallback(() => {
    setSelectedEdge(null)
  }, [])

  async function saveEdgeBuffer() {
    if (!selectedEdge) return
    const buffer = editBufferType === 'todo' ? ('todo' as const) : parseInt(editBufferValue) || 0
    await onUpdateBuffer(selectedEdge.reglaId, buffer)
    setSelectedEdge(null)
  }

  async function handleDeleteEdge() {
    if (!selectedEdge) return
    await onDeleteEdge(selectedEdge.reglaId)
    setSelectedEdge(null)
  }

  function fracLabel(frac: number) {
    const op = operaciones.find((o) => o.fraccion === frac)
    return op ? `F${frac}` : `F${frac}`
  }

  if (operaciones.length === 0) {
    return (
      <div className="h-[500px] flex items-center justify-center text-sm text-muted-foreground">
        Sin operaciones registradas para este modelo.
      </div>
    )
  }

  return (
    <div className="h-[500px] w-full relative border rounded-lg overflow-hidden bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'smoothstep' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>

      {/* New connection dialog — appears at bottom center */}
      {pending && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-card border rounded-lg shadow-lg p-3 flex items-center gap-2 z-50">
          <span className="text-xs font-medium whitespace-nowrap">
            F{pending.source} → F{pending.target}
          </span>
          <span className="text-[10px] text-muted-foreground">Buffer:</span>
          <Select value={bufferType} onValueChange={(v) => setBufferType(v as 'todo' | 'numero')}>
            <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todo">Todo</SelectItem>
              <SelectItem value="numero">Num</SelectItem>
            </SelectContent>
          </Select>
          {bufferType === 'numero' && (
            <Input
              type="number"
              min={0}
              className="h-7 w-20 text-xs"
              value={bufferValue}
              onChange={(e) => setBufferValue(e.target.value)}
              placeholder="0"
            />
          )}
          <Button size="sm" className="h-7 text-xs" onClick={confirmConnection}>Crear</Button>
          <Button size="sm" variant="ghost" className="h-7 px-1" onClick={() => setPending(null)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Edge edit popover — fixed position at click point */}
      {selectedEdge && (
        <div
          className="fixed bg-card border rounded-lg shadow-lg p-3 z-[100] space-y-2"
          style={{ left: selectedEdge.x - 140, top: selectedEdge.y - 90 }}
        >
          {/* Show which fractions are involved */}
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-muted-foreground">Origen:</span>
            {selectedEdge.fracsOrig.map((f) => (
              <Badge key={f} variant="outline" className="text-[9px] font-mono px-1 py-0">
                {fracLabel(f)}
              </Badge>
            ))}
            <span className="text-muted-foreground mx-1">→</span>
            <span className="text-muted-foreground">Destino:</span>
            {selectedEdge.fracsDest.map((f) => (
              <Badge key={f} variant="outline" className="text-[9px] font-mono px-1 py-0">
                {fracLabel(f)}
              </Badge>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Buffer:</span>
            <Select value={editBufferType} onValueChange={(v) => setEditBufferType(v as 'todo' | 'numero')}>
              <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todo">Todo</SelectItem>
                <SelectItem value="numero">Num</SelectItem>
              </SelectContent>
            </Select>
            {editBufferType === 'numero' && (
              <Input
                type="number"
                min={0}
                className="h-7 w-20 text-xs"
                value={editBufferValue}
                onChange={(e) => setEditBufferValue(e.target.value)}
              />
            )}
            <Button size="sm" className="h-7 text-xs" onClick={saveEdgeBuffer}>OK</Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 text-destructive p-0" onClick={handleDeleteEdge}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setSelectedEdge(null)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
