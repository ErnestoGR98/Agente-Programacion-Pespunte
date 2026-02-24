'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'

export interface CatalogoImageMap {
  /** modelo_num -> imagen_url */
  main: Record<string, string>
  /** modelo_num -> { alternativa -> url } */
  alts: Record<string, Record<string, string>>
}

/**
 * Lightweight hook that loads only image data from catalogo_modelos.
 * Use this in pages that don't already have full catalog access.
 */
export function useCatalogoImages() {
  const [images, setImages] = useState<CatalogoImageMap>({ main: {}, alts: {} })

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('catalogo_modelos')
      .select('modelo_num, imagen_url, alternativas_imagenes')
    if (!data) return
    const main: Record<string, string> = {}
    const alts: Record<string, Record<string, string>> = {}
    for (const m of data) {
      if (m.imagen_url) main[m.modelo_num] = m.imagen_url
      if (m.alternativas_imagenes && typeof m.alternativas_imagenes === 'object') {
        alts[m.modelo_num] = m.alternativas_imagenes as Record<string, string>
      }
    }
    setImages({ main, alts })
  }, [])

  useEffect(() => { load() }, [load])

  return images
}

/**
 * Get the best image URL for a modelo + optional color.
 * Prefers alternativa-specific image, falls back to main model image.
 */
export function getModeloImageUrl(
  images: CatalogoImageMap,
  modeloNum: string,
  color?: string,
): string | null {
  if (color && images.alts[modeloNum]?.[color]) {
    return images.alts[modeloNum][color]
  }
  return images.main[modeloNum] || null
}
