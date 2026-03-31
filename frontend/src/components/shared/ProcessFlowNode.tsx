'use client'

import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { STAGE_COLORS } from '@/types'
import { Bot } from 'lucide-react'

function stageColor(proceso: string): string {
  if (!proceso) return '#94A3B8'
  if (proceso === 'N/A PRELIMINAR') return STAGE_COLORS['N/A PRELIMINAR']
  if (proceso === 'PRELIMINARES' || proceso.includes('PRELIMINAR')) return STAGE_COLORS.PRELIMINAR
  if (proceso === 'ROBOT') return STAGE_COLORS.ROBOT
  if (proceso === 'POST') return STAGE_COLORS.POST
  if (proceso === 'MAQUILA') return STAGE_COLORS.MAQUILA
  return '#94A3B8'
}

export interface ProcessFlowNodeData {
  fraccion: number
  operacion: string
  input_o_proceso: string
  etapa: string
  recurso: string
  rate: number
  robots: string[]
}

/** Hexagonal clip-path for ROBOT operations */
const HEXAGON_CLIP = 'polygon(5% 0%, 95% 0%, 100% 50%, 95% 100%, 5% 100%, 0% 50%)'

function ProcessFlowNodeComponent({ data }: { data: ProcessFlowNodeData }) {
  const color = stageColor(data.input_o_proceso)
  const isRobot = data.input_o_proceso === 'ROBOT'
  const isMaquila = data.input_o_proceso === 'MAQUILA'
  const hasRobots = data.robots && data.robots.length > 0

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-muted-foreground/50 !border-2 !border-background"
      />

      {/* Outer wrapper — consistent size for handles */}
      <div className="relative w-56">
        {/* Shape decorator for ROBOT (hexagon accent) */}
        {isRobot && (
          <div
            className="absolute inset-0 rounded-lg"
            style={{
              clipPath: HEXAGON_CLIP,
              backgroundColor: color + '18',
              border: `2px solid ${color}40`,
            }}
          />
        )}

        {/* Main card */}
        <div
          className={`relative rounded-lg bg-card shadow-md px-3 py-2 ${isMaquila ? '' : 'border'}`}
          style={{
            borderLeftWidth: 4,
            borderLeftColor: color,
            border: isMaquila ? `2px solid ${color}` : undefined,
            outline: isMaquila ? `2px solid ${color}` : undefined,
            outlineOffset: isMaquila ? 2 : undefined,
          }}
        >
          {/* Header: fraccion + stage badge */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground font-mono font-bold">
              F{data.fraccion}
            </span>
            <div className="flex items-center gap-1">
              {hasRobots && (
                <Bot className="h-3 w-3" style={{ color }} />
              )}
              <span
                className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: color + '20', color }}
              >
                {data.input_o_proceso}
              </span>
            </div>
          </div>

          {/* Operation name */}
          <div className="text-xs font-medium truncate mt-0.5" title={data.operacion}>
            {data.operacion}
          </div>

          {/* Recurso + Rate */}
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-muted-foreground">
              {data.recurso}
              {data.etapa && data.etapa !== data.recurso ? ` · ${data.etapa}` : ''}
            </span>
            <span className="text-[10px] font-mono font-semibold" style={{ color }}>
              {data.rate} p/h
            </span>
          </div>

          {/* Robot names (if any) */}
          {hasRobots && (
            <div className="text-[9px] text-muted-foreground mt-0.5 truncate" title={data.robots.join(', ')}>
              {data.robots.join(', ')}
            </div>
          )}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-muted-foreground/50 !border-2 !border-background"
      />
    </>
  )
}

export const ProcessFlowNode = memo(ProcessFlowNodeComponent)
