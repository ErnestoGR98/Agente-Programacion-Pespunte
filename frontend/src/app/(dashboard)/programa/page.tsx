'use client'

import { useAppStore } from '@/lib/store/useAppStore'

export default function ProgramaPage() {
  const result = useAppStore((s) => s.currentResult)

  if (!result) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Ejecuta una optimizacion para ver el programa diario.
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Programa Diario</h1>
      <p className="mt-2 text-muted-foreground">Resultado: {result.nombre}</p>
    </div>
  )
}
