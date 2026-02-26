'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase/client'
import type {
  Robot, RobotAlias, MaquinaTipo, Fabrica, CapacidadRecurso,
  DiaLaboral, Horario, PesoPriorizacion, ParametroOptimizacion,
} from '@/types'
import {
  ROBOT_TIPOS_BASE, ROBOT_TIPOS_MODS, PRELIMINAR_TIPOS_BASE,
  MAQUINA_TIPOS_MODS,
} from '@/types'

// Sets for category classification
const ROBOT_BASE_SET = new Set(ROBOT_TIPOS_BASE.map((t) => t.value))
const PRELIM_BASE_SET = new Set(PRELIMINAR_TIPOS_BASE.map((t) => t.value))
const MODIFIER_SET = new Set([
  ...ROBOT_TIPOS_MODS.map((t) => t.value),
  ...MAQUINA_TIPOS_MODS.map((t) => t.value),
])
const AGGREGATED_SET = new Set([...ROBOT_BASE_SET, ...PRELIM_BASE_SET])

/** Compute resource capacities from registered machines + fabricas + operarios.
 *  Includes all unique machine tipos plus aggregate ROBOT/MESA/MAQUILA/GENERAL. */
function computeCapacidades(
  machines: Robot[],
  fabricas: Fabrica[],
  operariosCount: number,
): Record<string, number> {
  const pespunte = machines.filter((m) => m.estado === 'ACTIVO' && m.area === 'PESPUNTE')
  const allActive = machines.filter((m) => m.estado === 'ACTIVO')

  const result: Record<string, number> = {
    ROBOT: pespunte.filter((m) => m.tipos.some((t) => ROBOT_BASE_SET.has(t))).length,
    MESA: pespunte.filter((m) => m.tipos.some((t) => PRELIM_BASE_SET.has(t))).length,
    PLANA: pespunte.filter((m) => m.tipos.includes('PLANA')).length,
    POSTE: pespunte.filter((m) => m.tipos.includes('POSTE')).length,
    MAQUILA: fabricas.filter((f) => f.es_maquila).length,
    GENERAL: operariosCount,
  }

  // Add each unique tipo not already represented (skip modifiers and aggregated types)
  for (const m of allActive) {
    for (const t of m.tipos) {
      if (!MODIFIER_SET.has(t) && !AGGREGATED_SET.has(t) && !(t in result)) {
        result[t] = allActive.filter((x) => x.tipos.includes(t)).length
      }
    }
  }

  return result
}

export function useConfiguracion() {
  const [robots, setRobots] = useState<Robot[]>([])
  const [aliases, setAliases] = useState<RobotAlias[]>([])
  const [fabricas, setFabricas] = useState<Fabrica[]>([])
  const [capacidades, setCapacidades] = useState<CapacidadRecurso[]>([])
  const [dias, setDias] = useState<DiaLaboral[]>([])
  const [horarios, setHorarios] = useState<Horario[]>([])
  const [pesos, setPesos] = useState<PesoPriorizacion[]>([])
  const [parametros, setParametros] = useState<ParametroOptimizacion[]>([])
  const [operariosCount, setOperariosCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true)
    const [r, a, f, c, d, h, p, pm, rt, opCount] = await Promise.all([
      supabase.from('robots').select('*').order('orden'),
      supabase.from('robot_aliases').select('*'),
      supabase.from('fabricas').select('*').order('orden'),
      supabase.from('capacidades_recurso').select('*'),
      supabase.from('dias_laborales').select('*').order('orden'),
      supabase.from('horarios').select('*'),
      supabase.from('pesos_priorizacion').select('*'),
      supabase.from('parametros_optimizacion').select('*'),
      supabase.from('robot_tipos').select('*'),
      supabase.from('operarios').select('id', { count: 'exact', head: true }).eq('activo', true),
    ])
    const tiposData = rt.data || []
    const parsedRobots = r.data ? r.data.map((rob) => ({
      ...rob,
      tipos: tiposData
        .filter((t: { robot_id: string }) => t.robot_id === rob.id)
        .map((t: { tipo: string }) => t.tipo) as MaquinaTipo[],
    })) as Robot[] : []
    setRobots(parsedRobots)
    if (a.data) setAliases(a.data)
    const parsedFabricas = f.data || []
    setFabricas(parsedFabricas)
    if (c.data) setCapacidades(c.data)
    if (d.data) setDias(d.data)
    if (h.data) setHorarios(h.data)
    if (p.data) setPesos(p.data)
    if (pm.data) setParametros(pm.data)
    setOperariosCount(opCount.count || 0)
    setLoading(false)
  }, [])

  useEffect(() => { load(true) }, [load])

  // --- Robots / Maquinas ---
  async function updateRobot(id: string, data: Partial<Robot>) {
    await supabase.from('robots').update(data).eq('id', id)
    await load()
  }

  async function addRobot(nombre: string, tipos?: MaquinaTipo[]) {
    const maxOrden = robots.length > 0 ? Math.max(...robots.map(r => r.orden)) + 1 : 0
    const { data } = await supabase.from('robots').insert({ nombre, orden: maxOrden }).select('id').single()
    if (data && tipos && tipos.length > 0) {
      await supabase.from('robot_tipos').insert(
        tipos.map((t) => ({ robot_id: data.id, tipo: t }))
      )
    }
    await load()
  }

  async function toggleTipo(robotId: string, tipo: MaquinaTipo, active: boolean) {
    if (active) {
      await supabase.from('robot_tipos').insert({ robot_id: robotId, tipo })
    } else {
      await supabase.from('robot_tipos').delete().eq('robot_id', robotId).eq('tipo', tipo)
    }
    await load()
  }

  async function setBaseTipo(robotId: string, newBase: MaquinaTipo | null, baseGroup: MaquinaTipo[]) {
    // Remove all existing base tipos from this group
    for (const bv of baseGroup) {
      await supabase.from('robot_tipos').delete().eq('robot_id', robotId).eq('tipo', bv)
    }
    // Add new base if provided
    if (newBase) {
      await supabase.from('robot_tipos').insert({ robot_id: robotId, tipo: newBase })
    }
    await load()
  }

  async function renameTipo(oldTipo: MaquinaTipo, newTipo: MaquinaTipo) {
    await supabase.from('robot_tipos').update({ tipo: newTipo }).eq('tipo', oldTipo)
    await load()
  }

  async function deleteRobot(id: string) {
    await supabase.from('robots').delete().eq('id', id)
    await load()
  }

  // --- Aliases ---
  async function addAlias(alias: string, robot_id: string) {
    await supabase.from('robot_aliases').insert({ alias, robot_id })
    await load()
  }

  async function deleteAlias(id: string) {
    await supabase.from('robot_aliases').delete().eq('id', id)
    await load()
  }

  // --- Fabricas ---
  async function updateFabrica(id: string, data: Partial<Fabrica>) {
    await supabase.from('fabricas').update(data).eq('id', id)
    await load()
  }

  async function addFabrica(nombre: string, es_maquila = false) {
    const maxOrden = fabricas.length > 0 ? Math.max(...fabricas.map(f => f.orden)) + 1 : 0
    await supabase.from('fabricas').insert({ nombre, orden: maxOrden, es_maquila })
    await load()
  }

  async function deleteFabrica(id: string) {
    await supabase.from('fabricas').delete().eq('id', id)
    await load()
  }

  // --- Capacidades derivadas ---
  const derivedCapacidades = useMemo(
    () => computeCapacidades(robots, fabricas, operariosCount),
    [robots, fabricas, operariosCount],
  )

  // --- Dias ---
  async function updateDia(id: string, data: Partial<DiaLaboral>) {
    await supabase.from('dias_laborales').update(data).eq('id', id)
    await load()
  }

  // --- Horarios ---
  async function updateHorario(id: string, data: Partial<Horario>) {
    await supabase.from('horarios').update(data).eq('id', id)
    await load()
  }

  // --- Pesos ---
  async function updatePeso(id: string, valor: number) {
    await supabase.from('pesos_priorizacion').update({ valor }).eq('id', id)
    await load()
  }

  // --- Parametros ---
  async function updateParametro(id: string, valor: number) {
    await supabase.from('parametros_optimizacion').update({ valor }).eq('id', id)
    await load()
  }

  return {
    loading,
    robots, aliases, fabricas, capacidades, derivedCapacidades, dias, horarios, pesos, parametros,
    updateRobot, addRobot, deleteRobot, toggleTipo, setBaseTipo, renameTipo,
    addAlias, deleteAlias,
    updateFabrica, addFabrica, deleteFabrica,
    updateDia,
    updateHorario,
    updatePeso,
    updateParametro,
    reload: load,
  }
}
