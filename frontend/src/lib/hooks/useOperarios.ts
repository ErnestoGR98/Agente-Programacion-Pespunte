'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { Operario, Fabrica, Robot, DiaLaboral, ResourceType, DayName } from '@/types'

export interface OperarioFull {
  id: string
  nombre: string
  fabrica_id: string | null
  fabrica_nombre: string
  eficiencia: number
  activo: boolean
  recursos: ResourceType[]
  robots: string[]         // robot nombres
  robot_ids: string[]      // robot ids
  dias: DayName[]
}

export function useOperarios() {
  const [operarios, setOperarios] = useState<OperarioFull[]>([])
  const [fabricas, setFabricas] = useState<Fabrica[]>([])
  const [robotsList, setRobotsList] = useState<Robot[]>([])
  const [dias, setDias] = useState<DiaLaboral[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)

    const [fabRes, robRes, diasRes, opRes] = await Promise.all([
      supabase.from('fabricas').select('*').order('orden'),
      supabase.from('robots').select('*').eq('estado', 'ACTIVO').order('orden'),
      supabase.from('dias_laborales').select('*').order('orden'),
      supabase.from('operarios').select('*, fabricas(nombre)').order('nombre'),
    ])

    const fabs = fabRes.data || []
    const robs = robRes.data || []
    const diasData = diasRes.data || []
    const ops = opRes.data || []

    setFabricas(fabs)
    setRobotsList(robs)
    setDias(diasData)

    // Load junction tables for all operarios
    const opIds = ops.map((o: { id: string }) => o.id)
    const [recRes, robRelRes, diasRelRes] = await Promise.all([
      supabase.from('operario_recursos').select('*').in('operario_id', opIds),
      supabase.from('operario_robots').select('*, robots(nombre)').in('operario_id', opIds),
      supabase.from('operario_dias').select('*').in('operario_id', opIds),
    ])

    const recursos = recRes.data || []
    const robotRels = robRelRes.data || []
    const diasRels = diasRelRes.data || []

    const full: OperarioFull[] = ops.map((o: Record<string, unknown>) => ({
      id: o.id as string,
      nombre: o.nombre as string,
      fabrica_id: o.fabrica_id as string | null,
      fabrica_nombre: ((o.fabricas as { nombre: string } | null)?.nombre) || '',
      eficiencia: Number(o.eficiencia),
      activo: o.activo as boolean,
      recursos: recursos
        .filter((r: { operario_id: string }) => r.operario_id === o.id)
        .map((r: { recurso: ResourceType }) => r.recurso),
      robots: robotRels
        .filter((r: { operario_id: string }) => r.operario_id === o.id)
        .map((r: { robots: { nombre: string } }) => r.robots.nombre),
      robot_ids: robotRels
        .filter((r: { operario_id: string }) => r.operario_id === o.id)
        .map((r: { robot_id: string }) => r.robot_id),
      dias: diasRels
        .filter((d: { operario_id: string }) => d.operario_id === o.id)
        .map((d: { dia: DayName }) => d.dia),
    }))

    setOperarios(full)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function toggleActivo(id: string, activo: boolean) {
    await supabase.from('operarios').update({ activo }).eq('id', id)
    await load()
  }

  async function deleteOperario(id: string) {
    await supabase.from('operarios').delete().eq('id', id)
    await load()
  }

  async function saveOperario(data: {
    id?: string
    nombre: string
    fabrica_id: string | null
    eficiencia: number
    activo: boolean
    recursos: ResourceType[]
    robot_ids: string[]
    dias: DayName[]
  }) {
    let opId = data.id

    if (opId) {
      // Update existing
      await supabase.from('operarios').update({
        nombre: data.nombre,
        fabrica_id: data.fabrica_id,
        eficiencia: data.eficiencia,
        activo: data.activo,
      }).eq('id', opId)
    } else {
      // Insert new
      const { data: inserted } = await supabase.from('operarios').insert({
        nombre: data.nombre,
        fabrica_id: data.fabrica_id,
        eficiencia: data.eficiencia,
        activo: data.activo,
      }).select('id').single()
      if (!inserted) return
      opId = inserted.id
    }

    // Replace junction tables
    await supabase.from('operario_recursos').delete().eq('operario_id', opId)
    await supabase.from('operario_robots').delete().eq('operario_id', opId)
    await supabase.from('operario_dias').delete().eq('operario_id', opId)

    if (data.recursos.length > 0) {
      await supabase.from('operario_recursos').insert(
        data.recursos.map((r) => ({ operario_id: opId, recurso: r }))
      )
    }
    if (data.robot_ids.length > 0) {
      await supabase.from('operario_robots').insert(
        data.robot_ids.map((r) => ({ operario_id: opId, robot_id: r }))
      )
    }
    if (data.dias.length > 0) {
      await supabase.from('operario_dias').insert(
        data.dias.map((d) => ({ operario_id: opId, dia: d }))
      )
    }

    await load()
  }

  return {
    loading, operarios, fabricas, robotsList, dias,
    toggleActivo, deleteOperario, saveOperario, reload: load,
  }
}
