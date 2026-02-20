'use client'

import { useState } from 'react'
import { useAppStore } from '@/lib/store/useAppStore'
import { runOptimization } from '@/lib/api/fastapi'
import { supabase } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Play } from 'lucide-react'
import type { Resultado } from '@/types'

export function TopBar() {
  const { appStep, currentPedidoNombre, currentSemana, setCurrentResult } = useAppStore()
  const [optimizing, setOptimizing] = useState(false)
  const [nota, setNota] = useState('')
  const [error, setError] = useState<string | null>(null)

  const canOptimize = appStep >= 1 && currentPedidoNombre

  async function handleOptimize() {
    if (!currentPedidoNombre) return
    setOptimizing(true)
    setError(null)

    try {
      const res = await runOptimization({
        pedido_nombre: currentPedidoNombre,
        semana: currentSemana || '',
        nota,
      })

      // Cargar resultado completo desde Supabase
      const { data } = await supabase
        .from('resultados')
        .select('*')
        .eq('nombre', res.saved_as)
        .single()

      if (data) {
        setCurrentResult(data as Resultado)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al optimizar')
    } finally {
      setOptimizing(false)
    }
  }

  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-4">
      <div className="flex items-center gap-3">
        {currentSemana && (
          <span className="rounded-md bg-primary/10 px-2 py-1 text-sm font-medium text-primary">
            {currentSemana}
          </span>
        )}
        {currentPedidoNombre && (
          <span className="text-sm text-muted-foreground">
            Pedido: {currentPedidoNombre}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {canOptimize && (
          <>
            <Input
              placeholder="Nota (opcional)"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              className="h-8 w-48 text-sm"
            />
            <Button
              size="sm"
              onClick={handleOptimize}
              disabled={optimizing}
            >
              {optimizing ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Optimizando...
                </>
              ) : (
                <>
                  <Play className="mr-1 h-4 w-4" />
                  Optimizar
                </>
              )}
            </Button>
          </>
        )}
        {error && (
          <span className="text-sm text-destructive">{error}</span>
        )}
      </div>
    </header>
  )
}
