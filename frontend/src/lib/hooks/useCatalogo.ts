'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { ProcessType, ResourceType, Robot, MaquinaTipo } from '@/types'

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
  imagen_url: string | null
  alternativas_imagenes: Record<string, string>
  operaciones: OperacionFull[]
}

export function useCatalogo() {
  const [modelos, setModelos] = useState<ModeloFull[]>([])
  const [robots, setRobots] = useState<Robot[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)

    const [modRes, opsRes, robRes, tiposRes] = await Promise.all([
      supabase.from('catalogo_modelos').select('*').order('modelo_num'),
      supabase.from('catalogo_operaciones').select('*').order('fraccion'),
      supabase.from('robots').select('*').eq('estado', 'ACTIVO').order('orden'),
      supabase.from('robot_tipos').select('*'),
    ])

    const mods = modRes.data || []
    const ops = opsRes.data || []
    const rawRobs = robRes.data || []
    const tiposData = tiposRes.data || []

    // Attach tipos to each robot
    const robs: Robot[] = rawRobs.map((rob) => ({
      ...rob,
      tipos: tiposData
        .filter((t: { robot_id: string }) => t.robot_id === rob.id)
        .map((t: { tipo: string }) => t.tipo) as MaquinaTipo[],
    })) as Robot[]
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
      imagen_url: (m.imagen_url as string) || null,
      alternativas_imagenes: (m.alternativas_imagenes as Record<string, string>) || {},
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

  // --- CRUD Modelo ---

  async function addModelo(modeloNum: string, codigoFull?: string, claveMaterial?: string, alternativas?: string[]) {
    await supabase.from('catalogo_modelos').insert({
      modelo_num: modeloNum,
      codigo_full: codigoFull || modeloNum,
      clave_material: claveMaterial || '',
      alternativas: alternativas || [],
      total_sec_per_pair: 0,
      num_ops: 0,
    })
    await load()
  }

  async function updateModelo(id: string, data: { modelo_num?: string; codigo_full?: string; clave_material?: string; alternativas?: string[]; imagen_url?: string | null }) {
    await supabase.from('catalogo_modelos').update(data).eq('id', id)
    await load()
  }

  async function uploadModeloImagen(modeloId: string, modeloNum: string, file: File): Promise<string | null> {
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${modeloNum}.${ext}`
    // Overwrite if exists
    await supabase.storage.from('modelos').upload(path, file, { upsert: true })
    const { data } = supabase.storage.from('modelos').getPublicUrl(path)
    if (data?.publicUrl) {
      await supabase.from('catalogo_modelos').update({ imagen_url: data.publicUrl }).eq('id', modeloId)
      await load()
      return data.publicUrl
    }
    return null
  }

  async function uploadAlternativaImagen(modeloId: string, modeloNum: string, alternativa: string, file: File): Promise<string | null> {
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${modeloNum}_${alternativa}.${ext}`
    await supabase.storage.from('modelos').upload(path, file, { upsert: true })
    const { data: urlData } = supabase.storage.from('modelos').getPublicUrl(path)
    if (urlData?.publicUrl) {
      // Read current alternativas_imagenes, merge, save
      const { data: current } = await supabase
        .from('catalogo_modelos')
        .select('alternativas_imagenes')
        .eq('id', modeloId)
        .single()
      const existing = (current?.alternativas_imagenes as Record<string, string>) || {}
      existing[alternativa] = urlData.publicUrl
      await supabase.from('catalogo_modelos').update({ alternativas_imagenes: existing }).eq('id', modeloId)
      await load()
      return urlData.publicUrl
    }
    return null
  }

  async function deleteModelo(id: string) {
    await supabase.from('catalogo_modelos').delete().eq('id', id)
    await load()
  }

  // --- CRUD Operacion ---

  async function refreshModeloTotals(modeloId: string) {
    const { data } = await supabase
      .from('catalogo_operaciones')
      .select('sec_per_pair')
      .eq('modelo_id', modeloId)
    const ops = data || []
    const total = ops.reduce((sum: number, o: { sec_per_pair: number }) => sum + o.sec_per_pair, 0)
    await supabase.from('catalogo_modelos').update({
      total_sec_per_pair: total,
      num_ops: ops.length,
    }).eq('id', modeloId)
  }

  async function addOperacion(modeloId: string, data: {
    fraccion: number; operacion: string; input_o_proceso: ProcessType
    etapa: string; recurso: ResourceType; rate: number; sec_per_pair: number
    robotIds?: string[]
  }) {
    const { robotIds, ...opData } = data
    const { data: inserted } = await supabase
      .from('catalogo_operaciones')
      .insert({ ...opData, modelo_id: modeloId, recurso_raw: opData.recurso })
      .select('id')
      .single()
    if (inserted && robotIds && robotIds.length > 0) {
      await supabase.from('catalogo_operacion_robots').insert(
        robotIds.map((rid) => ({ operacion_id: inserted.id, robot_id: rid }))
      )
    }
    await refreshModeloTotals(modeloId)
    await load()
  }

  async function updateOperacion(id: string, modeloId: string, data: {
    fraccion?: number; operacion?: string; input_o_proceso?: ProcessType
    etapa?: string; recurso?: ResourceType; rate?: number; sec_per_pair?: number
    robotIds?: string[]
  }) {
    const { robotIds, ...opData } = data
    if (Object.keys(opData).length > 0) {
      await supabase.from('catalogo_operaciones').update(opData).eq('id', id)
    }
    if (robotIds !== undefined) {
      await supabase.from('catalogo_operacion_robots').delete().eq('operacion_id', id)
      if (robotIds.length > 0) {
        await supabase.from('catalogo_operacion_robots').insert(
          robotIds.map((rid) => ({ operacion_id: id, robot_id: rid }))
        )
      }
    }
    await refreshModeloTotals(modeloId)
    await load()
  }

  async function deleteOperacion(id: string, modeloId: string) {
    await supabase.from('catalogo_operaciones').delete().eq('id', id)
    await refreshModeloTotals(modeloId)
    await load()
  }

  return {
    loading, modelos, robots, reload: load,
    addModelo, updateModelo, deleteModelo, uploadModeloImagen, uploadAlternativaImagen,
    addOperacion, updateOperacion, deleteOperacion,
  }
}
