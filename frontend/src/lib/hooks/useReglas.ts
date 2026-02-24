'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { Restriccion } from '@/types'

/**
 * Hook para reglas permanentes (restricciones con semana IS NULL).
 * Se gestionan en Configuracion > Reglas y aplican automaticamente
 * en toda optimizacion.
 */
export function useReglas() {
  const [reglas, setReglas] = useState<Restriccion[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('restricciones')
      .select('*')
      .is('semana', null)
      .order('created_at')
    setReglas(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function addRegla(data: Omit<Restriccion, 'id' | 'created_at' | 'semana'>) {
    await supabase.from('restricciones').insert({ ...data, semana: null })
    await load()
  }

  async function toggleActiva(id: string, activa: boolean) {
    await supabase.from('restricciones').update({ activa }).eq('id', id)
    await load()
  }

  async function deleteRegla(id: string) {
    await supabase.from('restricciones').delete().eq('id', id)
    await load()
  }

  const activas = reglas.filter((r) => r.activa).length
  const inactivas = reglas.filter((r) => !r.activa).length

  return {
    loading, reglas, activas, inactivas,
    addRegla, toggleActiva, deleteRegla,
    reload: load,
  }
}
