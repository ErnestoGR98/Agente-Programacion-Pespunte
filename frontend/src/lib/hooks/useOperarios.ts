'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { Fabrica, Robot, DiaLaboral, ResourceType, DayName, SkillType, NivelHabilidad, HabilidadConNivel } from '@/types'
import { deriveRecursos } from '@/types'

export interface OperarioFull {
  id: string
  nombre: string
  fabrica_id: string | null
  fabrica_nombre: string
  eficiencia: number
  activo: boolean
  habilidades: SkillType[]
  habilidades_nivel: HabilidadConNivel[]  // skills con nivel de competencia
  recursos: ResourceType[]  // derived from habilidades
  robots: string[]           // robot nombres (legacy, derived)
  robot_ids: string[]        // robot ids (legacy, derived)
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
    const [habRes, diasRelRes] = await Promise.all([
      supabase.from('operario_habilidades').select('*').in('operario_id', opIds),
      supabase.from('operario_dias').select('*').in('operario_id', opIds),
    ])

    const habilidades = habRes.data || []
    const diasRels = diasRelRes.data || []

    const full: OperarioFull[] = ops.map((o: Record<string, unknown>) => {
      const opHabRows = habilidades
        .filter((h: { operario_id: string }) => h.operario_id === o.id)
      const opHabs = opHabRows.map((h: { habilidad: SkillType }) => h.habilidad)
      const opHabsNivel: HabilidadConNivel[] = opHabRows.map(
        (h: { habilidad: SkillType; nivel?: number }) => ({
          habilidad: h.habilidad,
          nivel: (h.nivel ?? 2) as NivelHabilidad,
        })
      )
      return {
        id: o.id as string,
        nombre: o.nombre as string,
        fabrica_id: o.fabrica_id as string | null,
        fabrica_nombre: ((o.fabricas as { nombre: string } | null)?.nombre) || '',
        eficiencia: Number(o.eficiencia),
        activo: o.activo as boolean,
        habilidades: opHabs,
        habilidades_nivel: opHabsNivel,
        recursos: deriveRecursos(opHabs),
        robots: [],
        robot_ids: [],
        dias: diasRels
          .filter((d: { operario_id: string }) => d.operario_id === o.id)
          .map((d: { dia: DayName }) => d.dia),
      }
    })

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
    habilidades: SkillType[]
    habilidades_nivel?: HabilidadConNivel[]
    dias: DayName[]
  }) {
    let opId = data.id

    if (opId) {
      await supabase.from('operarios').update({
        nombre: data.nombre,
        fabrica_id: data.fabrica_id,
        eficiencia: data.eficiencia,
        activo: data.activo,
      }).eq('id', opId)
    } else {
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
    await supabase.from('operario_habilidades').delete().eq('operario_id', opId)
    await supabase.from('operario_dias').delete().eq('operario_id', opId)

    if (data.habilidades.length > 0) {
      // Use habilidades_nivel if provided, otherwise default nivel=2
      const nivelMap = new Map(
        (data.habilidades_nivel || []).map((hn) => [hn.habilidad, hn.nivel])
      )
      await supabase.from('operario_habilidades').insert(
        data.habilidades.map((h) => ({
          operario_id: opId,
          habilidad: h,
          nivel: nivelMap.get(h) ?? 2,
        }))
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
