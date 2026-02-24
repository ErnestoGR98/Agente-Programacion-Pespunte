'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { ProcessType, ResourceType, Robot } from '@/types'

export interface OperacionFull {
  id: string
  fraccion: number
  operacion: string
  input_o_proceso: ProcessType
  etapa: string
  recurso: ResourceType
  rate: number
  sec_per_pair: number
  robots: string[]
}

export interface ModeloFull {
  id: string
  modelo_num: string
  alternativas: string[]
  total_sec_per_pair: number
  num_ops: number
  operaciones: OperacionFull[]
}

export function useCatalogo() {
  const [modelos, setModelos] = useState<ModeloFull[]>([])
  const [robots, setRobots] = useState<Robot[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)

    const [modRes, opsRes, robRes] = await Promise.all([
      supabase.from('catalogo_modelos').select('*').order('modelo_num'),
      supabase.from('catalogo_operaciones').select('*').order('fraccion'),
      supabase.from('robots').select('*').eq('estado', 'ACTIVO').order('orden'),
    ])

    const mods = modRes.data || []
    const ops = opsRes.data || []
    const robs = robRes.data || []
    setRobots(robs)

    // Fetch robot assignments for all operations
    const opIds = ops.map((o: { id: string }) => o.id)
    let robotRels: Record<string, unknown>[] = []
    if (opIds.length > 0) {
      const { data } = await supabase
        .from('catalogo_operacion_robots')
        .select('operacion_id, robots(nombre)')
        .in('operacion_id', opIds)
      robotRels = (data || []) as Record<string, unknown>[]
    }

    // Group robot names by operacion_id
    const robotsByOp = new Map<string, string[]>()
    for (const rel of robotRels) {
      const opId = rel.operacion_id as string
      const robotData = rel.robots as { nombre: string } | null
      if (!robotData) continue
      const list = robotsByOp.get(opId) || []
      list.push(robotData.nombre)
      robotsByOp.set(opId, list)
    }

    // Build full models with operations
    const full: ModeloFull[] = mods.map((m: Record<string, unknown>) => ({
      id: m.id as string,
      modelo_num: m.modelo_num as string,
      alternativas: (m.alternativas as string[]) || [],
      total_sec_per_pair: Number(m.total_sec_per_pair),
      num_ops: Number(m.num_ops),
      operaciones: ops
        .filter((o: { modelo_id: string }) => o.modelo_id === m.id)
        .map((o: Record<string, unknown>) => ({
          id: o.id as string,
          fraccion: Number(o.fraccion),
          operacion: o.operacion as string,
          input_o_proceso: o.input_o_proceso as ProcessType,
          etapa: o.etapa as string,
          recurso: o.recurso as ResourceType,
          rate: Number(o.rate),
          sec_per_pair: Number(o.sec_per_pair),
          robots: robotsByOp.get(o.id as string) || [],
        })),
    }))

    setModelos(full)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return { loading, modelos, robots, reload: load }
}
