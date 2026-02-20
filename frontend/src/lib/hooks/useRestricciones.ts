'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { Restriccion } from '@/types'

export function useRestricciones(semana?: string) {
  const [restricciones, setRestricciones] = useState<Restriccion[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('restricciones').select('*').order('created_at')
    if (semana) query = query.eq('semana', semana)
    const { data } = await query
    setRestricciones(data || [])
    setLoading(false)
  }, [semana])

  useEffect(() => { load() }, [load])

  async function addRestriccion(data: Omit<Restriccion, 'id' | 'created_at'>) {
    await supabase.from('restricciones').insert(data)
    await load()
  }

  async function toggleActiva(id: string, activa: boolean) {
    await supabase.from('restricciones').update({ activa }).eq('id', id)
    await load()
  }

  async function deleteRestriccion(id: string) {
    await supabase.from('restricciones').delete().eq('id', id)
    await load()
  }

  const activas = restricciones.filter((r) => r.activa).length
  const inactivas = restricciones.filter((r) => !r.activa).length

  return {
    loading, restricciones, activas, inactivas,
    addRestriccion, toggleActiva, deleteRestriccion,
    reload: load,
  }
}
