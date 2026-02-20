'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import type {
  Robot, RobotAlias, Fabrica, CapacidadRecurso,
  DiaLaboral, Horario, PesoPriorizacion, ParametroOptimizacion,
} from '@/types'

export function useConfiguracion() {
  const [robots, setRobots] = useState<Robot[]>([])
  const [aliases, setAliases] = useState<RobotAlias[]>([])
  const [fabricas, setFabricas] = useState<Fabrica[]>([])
  const [capacidades, setCapacidades] = useState<CapacidadRecurso[]>([])
  const [dias, setDias] = useState<DiaLaboral[]>([])
  const [horarios, setHorarios] = useState<Horario[]>([])
  const [pesos, setPesos] = useState<PesoPriorizacion[]>([])
  const [parametros, setParametros] = useState<ParametroOptimizacion[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [r, a, f, c, d, h, p, pm] = await Promise.all([
      supabase.from('robots').select('*').order('orden'),
      supabase.from('robot_aliases').select('*'),
      supabase.from('fabricas').select('*').order('orden'),
      supabase.from('capacidades_recurso').select('*'),
      supabase.from('dias_laborales').select('*').order('orden'),
      supabase.from('horarios').select('*'),
      supabase.from('pesos_priorizacion').select('*'),
      supabase.from('parametros_optimizacion').select('*'),
    ])
    if (r.data) setRobots(r.data)
    if (a.data) setAliases(a.data)
    if (f.data) setFabricas(f.data)
    if (c.data) setCapacidades(c.data)
    if (d.data) setDias(d.data)
    if (h.data) setHorarios(h.data)
    if (p.data) setPesos(p.data)
    if (pm.data) setParametros(pm.data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // --- Robots ---
  async function updateRobot(id: string, data: Partial<Robot>) {
    await supabase.from('robots').update(data).eq('id', id)
    await load()
  }

  async function addRobot(nombre: string) {
    const maxOrden = robots.length > 0 ? Math.max(...robots.map(r => r.orden)) + 1 : 0
    await supabase.from('robots').insert({ nombre, orden: maxOrden })
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
  async function updateFabrica(id: string, nombre: string) {
    await supabase.from('fabricas').update({ nombre }).eq('id', id)
    await load()
  }

  async function addFabrica(nombre: string) {
    const maxOrden = fabricas.length > 0 ? Math.max(...fabricas.map(f => f.orden)) + 1 : 0
    await supabase.from('fabricas').insert({ nombre, orden: maxOrden })
    await load()
  }

  async function deleteFabrica(id: string) {
    await supabase.from('fabricas').delete().eq('id', id)
    await load()
  }

  // --- Capacidades ---
  async function updateCapacidad(id: string, pares_hora: number) {
    await supabase.from('capacidades_recurso').update({ pares_hora }).eq('id', id)
    await load()
  }

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
    robots, aliases, fabricas, capacidades, dias, horarios, pesos, parametros,
    updateRobot, addRobot, deleteRobot,
    addAlias, deleteAlias,
    updateFabrica, addFabrica, deleteFabrica,
    updateCapacidad,
    updateDia,
    updateHorario,
    updatePeso,
    updateParametro,
    reload: load,
  }
}
