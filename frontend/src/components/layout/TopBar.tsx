'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '@/lib/store/useAppStore'
import { runOptimization } from '@/lib/api/fastapi'
import { supabase } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Loader2, Play, History } from 'lucide-react'
import type { Resultado } from '@/types'

interface ResultVersion {
  id: string
  nombre: string
  fecha_optimizacion: string
  nota: string | null
}

export function TopBar() {
  const { appStep, currentPedidoNombre, currentSemana, setCurrentResult, currentResult } = useAppStore()
  const [optimizing, setOptimizing] = useState(false)
  const [nota, setNota] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [versions, setVersions] = useState<ResultVersion[]>([])

  const canOptimize = appStep >= 1 && currentPedidoNombre

  // Load available result versions for current semana
  useEffect(() => {
    if (!currentSemana) { setVersions([]); return }
    supabase
      .from('resultados')
      .select('id, nombre, fecha_optimizacion, nota')
      .eq('base_name', currentSemana)
      .order('fecha_optimizacion', { ascending: false })
      .limit(10)
      .then(({ data }) => setVersions((data as ResultVersion[]) || []))
  }, [currentSemana, currentResult])

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

  async function handleLoadVersion(id: string) {
    const { data } = await supabase
      .from('resultados')
      .select('*')
      .eq('id', id)
      .single()

    if (data) {
      setCurrentResult(data as Resultado)
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
        {/* Result version selector */}
        {versions.length > 0 && (
          <Select
            value={currentResult?.id || ''}
            onValueChange={handleLoadVersion}
          >
            <SelectTrigger className="h-8 w-56 text-xs">
              <History className="mr-1 h-3 w-3" />
              <SelectValue placeholder="Cargar resultado..." />
            </SelectTrigger>
            <SelectContent>
              {versions.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  <span className="text-xs">
                    {v.nombre} {v.nota ? `— ${v.nota}` : ''}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

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
