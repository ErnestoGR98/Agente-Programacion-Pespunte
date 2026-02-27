'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
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
  const didInitialLoad = useRef(false)

  const load = useCallback(async () => {
    // Only show loading spinner on initial fetch, not on reloads after mutations
    if (!didInitialLoad.current) setLoading(true)
    const { data, error } = await supabase
      .from('restricciones')
      .select('*')
      .is('semana', null)
      .order('created_at')
    if (error) {
      console.error('[useReglas] load failed:', error)
      setLoading(false)
      didInitialLoad.current = true
      return
    }
    setReglas(data || [])
    setLoading(false)
    didInitialLoad.current = true
  }, [])

  useEffect(() => { load() }, [load])

  async function addRegla(data: Omit<Restriccion, 'id' | 'created_at' | 'semana'>) {
    const { error } = await supabase.from('restricciones').insert({ ...data, semana: null })
    if (error) {
      console.error('[useReglas] addRegla failed:', error.message)
      throw new Error(error.message)
    }
    await load()
  }

  async function toggleActiva(id: string, activa: boolean) {
    const { error } = await supabase.from('restricciones').update({ activa }).eq('id', id)
    if (error) console.error('[useReglas] toggleActiva failed:', error)
    await load()
  }

  async function deleteRegla(id: string) {
    const { error } = await supabase.from('restricciones').delete().eq('id', id)
    if (error) {
      console.error('[useReglas] deleteRegla failed:', error.message)
      throw new Error(error.message)
    }
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
