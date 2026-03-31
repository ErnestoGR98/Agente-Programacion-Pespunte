'use client'

import { useMemo } from 'react'
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  Panel,
  type Node,
  type Edge,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ProcessFlowNode, type ProcessFlowNodeData } from './ProcessFlowNode'
import type { OperacionFull } from '@/lib/hooks/useCatalogo'
import type { Restriccion } from '@/types'
import { STAGE_COLORS } from '@/types'
import { Bot } from 'lucide-react'

const nodeTypes = { processFlow: ProcessFlowNode }

/* ---- Stage ordering for swimlanes (left → right) ---- */
const STAGE_ORDER = ['PRELIMINARES', 'N/A PRELIMINAR', 'ROBOT', 'POST', 'MAQUILA']

function stageIndex(proceso: string): number {
  const idx = STAGE_ORDER.indexOf(proceso)
  return idx >= 0 ? idx : STAGE_ORDER.length
}

function stageColor(proceso: string): string {
  if (!proceso) return '#94A3B8'
  if (proceso === 'N/A PRELIMINAR') return STAGE_COLORS['N/A PRELIMINAR']
  if (proceso === 'PRELIMINARES' || proceso.includes('PRELIMINAR')) return STAGE_COLORS.PRELIMINAR
  if (proceso === 'ROBOT') return STAGE_COLORS.ROBOT
  if (proceso === 'POST') return STAGE_COLORS.POST
  if (proceso === 'MAQUILA') return STAGE_COLORS.MAQUILA
  return '#94A3B8'
}

/* ---- Layout constants ---- */
const LANE_WIDTH = 280
const LANE_GAP = 40
const NODE_HEIGHT = 120
const LANE_HEADER = 50
const LANE_PADDING_X = 20
const LANE_PADDING_Y = 20

/* ---- Compute swimlane layout ---- */
function computeLayout(operaciones: OperacionFull[]) {
  // Group by input_o_proceso
  const groups = new Map<string, OperacionFull[]>()
  for (const op of operaciones) {
    const key = op.input_o_proceso || 'PRELIMINARES'
    const list = groups.get(key) || []
    list.push(op)
    groups.set(key, list)
  }

  const sortedStages = [...groups.keys()].sort((a, b) => stageIndex(a) - stageIndex(b))

  const nodes: Node[] = []
  const lanes: { id: string; label: string; color: string; x: number; y: number; width: number; height: number }[] = []

  for (let col = 0; col < sortedStages.length; col++) {
    const stage = sortedStages[col]
    const ops = groups.get(stage)!.sort((a, b) => a.fraccion - b.fraccion)
    const color = stageColor(stage)

    const laneX = col * (LANE_WIDTH + LANE_GAP)
    const laneHeight = LANE_HEADER + ops.length * NODE_HEIGHT + LANE_PADDING_Y * 2

    // Lane background (group node)
    const laneId = `lane-${stage}`
    nodes.push({
      id: laneId,
      type: 'group',
      position: { x: laneX, y: 0 },
      data: {},
      style: {
        width: LANE_WIDTH,
        height: laneHeight,
        backgroundColor: color + '08',
        border: `1.5px solid ${color}30`,
        borderRadius: 12,
        padding: 0,
      },
    })

    lanes.push({
      id: laneId,
      label: stage,
      color,
      x: laneX,
      y: 0,
      width: LANE_WIDTH,
      height: laneHeight,
    })

    // Operation nodes inside the lane
    for (let row = 0; row < ops.length; row++) {
      const op = ops[row]
      nodes.push({
        id: String(op.fraccion),
        type: 'processFlow',
        position: {
          x: LANE_PADDING_X,
          y: LANE_HEADER + row * NODE_HEIGHT + LANE_PADDING_Y,
        },
        parentId: laneId,
        extent: 'parent' as const,
        data: {
          fraccion: op.fraccion,
          operacion: op.operacion,
          input_o_proceso: op.input_o_proceso,
          etapa: op.etapa,
          recurso: op.recurso,
          rate: op.rate,
          robots: op.robots || [],
        } satisfies ProcessFlowNodeData,
      })
    }
  }

  return { nodes, lanes }
}

/* ---- Compute edges from precedence rules ---- */
function computeEdges(reglas: Restriccion[], operaciones: OperacionFull[]): Edge[] {
  const fracSet = new Set(operaciones.map((o) => o.fraccion))
  const edges: Edge[] = []

  for (const r of reglas) {
    if (r.tipo !== 'PRECEDENCIA_OPERACION') continue
    const p = r.parametros as Record<string, unknown>
    const fracsOrig = (p.fracciones_origen as number[]) || []
    const fracsDest = (p.fracciones_destino as number[]) || []
    const buffer = p.buffer_pares

    const validOrig = fracsOrig.filter((f) => fracSet.has(f))
    const validDest = fracsDest.filter((f) => fracSet.has(f))
    if (validOrig.length === 0 || validDest.length === 0) continue

    // Buffer label
    let label: string
    if (buffer === 'todo') label = 'Todo'
    else if (buffer === 'rate') label = '1h rate'
    else if (buffer === 'dia') label = '1 dia'
    else if (buffer) label = `${buffer}p`
    else label = '0p'

    for (let i = 0; i < validOrig.length; i++) {
      for (let j = 0; j < validDest.length; j++) {
        const isPrimary = i === 0 && j === 0
        edges.push({
          id: `${r.id}__${validOrig[i]}-${validDest[j]}`,
          source: String(validOrig[i]),
          target: String(validDest[j]),
          label: isPrimary ? label : undefined,
          style: {
            stroke: r.activa ? '#6366F1' : '#94A3B8',
            strokeWidth: isPrimary ? 2.5 : 1.5,
            strokeDasharray: r.activa ? undefined : '6 4',
            opacity: isPrimary ? 1 : 0.35,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: r.activa ? '#6366F1' : '#94A3B8',
          },
          type: 'smoothstep',
        })
      }
    }
  }

  return edges
}

/* ---- Legend ---- */
function Legend() {
  const stages = [
    { label: 'Preliminares', color: STAGE_COLORS.PRELIMINAR },
    { label: 'Robot', color: STAGE_COLORS.ROBOT },
    { label: 'Post', color: STAGE_COLORS.POST },
    { label: 'Maquila', color: STAGE_COLORS.MAQUILA },
    { label: 'N/A Preliminar', color: STAGE_COLORS['N/A PRELIMINAR'] },
  ]

  return (
    <div className="bg-card/90 backdrop-blur border rounded-lg shadow-md p-2.5 text-[10px] space-y-2 max-w-[180px]">
      <div className="font-semibold text-[11px] text-foreground">Simbologia</div>

      {/* Stage colors */}
      <div className="space-y-1">
        <div className="font-medium text-muted-foreground">Etapas</div>
        {stages.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm border" style={{ backgroundColor: s.color + '30', borderColor: s.color }} />
            <span>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Node shapes */}
      <div className="space-y-1">
        <div className="font-medium text-muted-foreground">Formas</div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-3 rounded border border-border bg-card" style={{ borderLeftWidth: 3, borderLeftColor: '#94A3B8' }} />
          <span>Normal (Mesa, Plana...)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-3 rounded border border-border bg-card" style={{ borderLeftWidth: 3, borderLeftColor: STAGE_COLORS.ROBOT, clipPath: 'polygon(10% 0%, 90% 0%, 100% 50%, 90% 100%, 10% 100%, 0% 50%)' }} />
          <span>Robot (hexagonal)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-3 rounded bg-card" style={{ border: `2px solid ${STAGE_COLORS.MAQUILA}`, outline: `2px solid ${STAGE_COLORS.MAQUILA}`, outlineOffset: 1 }} />
          <span>Maquila (doble borde)</span>
        </div>
      </div>

      {/* Arrows */}
      <div className="space-y-1">
        <div className="font-medium text-muted-foreground">Flechas</div>
        <div className="flex items-center gap-1.5">
          <svg width="20" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke="#6366F1" strokeWidth="2" /><polygon points="14,1 18,4 14,7" fill="#6366F1" /></svg>
          <span>Regla activa</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="20" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke="#94A3B8" strokeWidth="2" strokeDasharray="3 2" /><polygon points="14,1 18,4 14,7" fill="#94A3B8" /></svg>
          <span>Regla inactiva</span>
        </div>
      </div>

      {/* Icons */}
      <div className="space-y-1">
        <div className="font-medium text-muted-foreground">Iconos</div>
        <div className="flex items-center gap-1.5">
          <Bot className="h-3 w-3 text-emerald-500" />
          <span>Tiene robot asignado</span>
        </div>
      </div>
    </div>
  )
}

/* ---- Lane Headers (rendered as Panel overlay) ---- */
function LaneHeaders({ lanes }: { lanes: { label: string; color: string; x: number; width: number }[] }) {
  return (
    <>
      {lanes.map((lane) => (
        <div
          key={lane.label}
          className="absolute text-[11px] font-bold tracking-wide text-center"
          style={{
            left: lane.x,
            top: 12,
            width: lane.width,
            color: lane.color,
            pointerEvents: 'none',
          }}
        >
          {lane.label}
        </div>
      ))}
    </>
  )
}

/* ---- Main component ---- */
export interface ProcessFlowDiagramProps {
  operaciones: OperacionFull[]
  reglas: Restriccion[]
}

export function ProcessFlowDiagram({ operaciones, reglas }: ProcessFlowDiagramProps) {
  const { nodes, lanes } = useMemo(() => computeLayout(operaciones), [operaciones])
  const edges = useMemo(() => computeEdges(reglas, operaciones), [reglas, operaciones])

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
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
        defaultEdgeOptions={{ type: 'smoothstep' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls showInteractive={false} />
        <Panel position="bottom-left">
          <Legend />
        </Panel>
      </ReactFlow>
    </div>
  )
}
