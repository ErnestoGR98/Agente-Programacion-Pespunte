'use client'

import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { STAGE_COLORS } from '@/types'

function stageColor(proceso: string): string {
  if (!proceso) return '#94A3B8'
  if (proceso === 'N/A PRELIMINAR') return STAGE_COLORS['N/A PRELIMINAR']
  if (proceso === 'PRELIMINARES' || proceso.includes('PRELIMINAR')) return STAGE_COLORS.PRELIMINAR
  if (proceso === 'ROBOT') return STAGE_COLORS.ROBOT
  if (proceso === 'POST') return STAGE_COLORS.POST
  if (proceso === 'MAQUILA') return STAGE_COLORS.MAQUILA
  return '#94A3B8'
}

export interface OperationNodeData {
  fraccion: number
  operacion: string
  input_o_proceso: string
  etapa: string
  recurso: string
}

function OperationNodeComponent({ data }: { data: OperationNodeData }) {
  const color = stageColor(data.input_o_proceso)

  return (
    <>
      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !bg-muted-foreground/50 !border-2 !border-background" />
      <div
        className="rounded-lg border-l-4 bg-card border border-border shadow-md px-3 py-2 w-52 cursor-grab active:cursor-grabbing"
        style={{ borderLeftColor: color }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground font-mono font-bold">F{data.fraccion}</span>
          <span
            className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: color + '20', color }}
          >
            {data.input_o_proceso}
          </span>
        </div>
        <div className="text-xs font-medium truncate mt-0.5" title={data.operacion}>
          {data.operacion}
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">
          {data.recurso} {data.etapa ? `· ${data.etapa}` : ''}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !bg-muted-foreground/50 !border-2 !border-background" />
    </>
  )
}

export const OperationNode = memo(OperationNodeComponent)
