'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { DayName } from '@/types'

export interface AvanceEntry {
  modelo_num: string
  dia: DayName
  pares: number
}

export function useAvance(semana: string | null) {
  const [detalles, setDetalles] = useState<AvanceEntry[]>([])
  const [avanceId, setAvanceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!semana) {
      setDetalles([])
      setAvanceId(null)
      return
    }
    setLoading(true)

    // Find avance header for this semana
    const { data: avRows } = await supabase
      .from('avance')
      .select('id')
      .eq('semana', semana)
      .limit(1)

    const av = avRows?.[0]
    if (!av) {
      setAvanceId(null)
      setDetalles([])
      setLoading(false)
      return
    }

    setAvanceId(av.id)

    // Load detalles
    const { data: detRows } = await supabase
      .from('avance_detalle')
      .select('modelo_num, dia, pares')
      .eq('avance_id', av.id)

    setDetalles(
      (detRows || []).map((d: Record<string, unknown>) => ({
        modelo_num: d.modelo_num as string,
        dia: d.dia as DayName,
        pares: Number(d.pares),
      }))
    )
    setLoading(false)
  }, [semana])

  useEffect(() => { load() }, [load])

  async function save(entries: AvanceEntry[]) {
    if (!semana) return

    let id = avanceId

    // Upsert avance header
    if (!id) {
      const { data } = await supabase
        .from('avance')
        .insert({ semana })
        .select('id')
        .single()
      if (!data) return
      id = data.id
      setAvanceId(id)
    } else {
      // Update timestamp
      await supabase
        .from('avance')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', id)
    }

    // Replace all detalles
    await supabase.from('avance_detalle').delete().eq('avance_id', id)

    const toInsert = entries.filter((e) => e.pares > 0)
    if (toInsert.length > 0) {
      await supabase.from('avance_detalle').insert(
        toInsert.map((e) => ({
          avance_id: id,
          modelo_num: e.modelo_num,
          dia: e.dia,
          pares: e.pares,
        }))
      )
    }

    await load()
  }

  // Helper: get pares for a modelo+dia
  function getPares(modelo_num: string, dia: DayName): number {
    return detalles.find((d) => d.modelo_num === modelo_num && d.dia === dia)?.pares || 0
  }

  const totalPares = detalles.reduce((sum, d) => sum + d.pares, 0)

  return { loading, detalles, totalPares, avanceId, getPares, save, reload: load }
}
