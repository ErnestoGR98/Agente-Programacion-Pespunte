'use client'

import type { CatalogoImageMap } from '@/lib/hooks/useCatalogoImages'
import { getModeloImageUrl } from '@/lib/hooks/useCatalogoImages'

interface Props {
  images: CatalogoImageMap
  modeloNum: string
  color?: string
  className?: string
}

export function ModeloImg({ images, modeloNum, color, className }: Props) {
  const url = getModeloImageUrl(images, modeloNum, color)
  if (!url) return null
  return (
    <img
      src={url}
      alt={color ? `${modeloNum} ${color}` : modeloNum}
      className={className || 'h-8 w-auto rounded border object-contain bg-white'}
    />
  )
}
