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
import { Loader2, Play, History, RotateCcw } from 'lucide-react'
import type { Resultado } from '@/types'
import { DAY_ORDER } from '@/types'
import { MenuButton } from '@/components/layout/Sidebar'

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
  const [reoptFromDay, setReoptFromDay] = useState<string>('')
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
      const reoptDay = reoptFromDay && reoptFromDay !== 'all' ? reoptFromDay : null
      const res = await runOptimization({
        pedido_nombre: currentPedidoNombre,
        semana: currentSemana || '',
        nota,
        reopt_from_day: reoptDay,
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
    <header className="flex min-h-14 items-center justify-between border-b bg-card px-3 sm:px-4 gap-2 flex-wrap py-2">
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Hamburger menu - mobile only */}
        <MenuButton />
        {currentSemana && (
          <span className="rounded-md bg-primary/10 px-2 py-1 text-xs sm:text-sm font-medium text-primary">
            {currentSemana}
          </span>
        )}
        {currentPedidoNombre && (
          <span className="text-xs sm:text-sm text-muted-foreground hidden sm:inline">
            Pedido: {currentPedidoNombre}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {/* Result version selector */}
        {versions.length > 0 && (
          <Select
            value={currentResult?.id || ''}
            onValueChange={handleLoadVersion}
          >
            <SelectTrigger className="h-8 w-40 sm:w-56 text-xs">
              <History className="mr-1 h-3 w-3 shrink-0" />
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
            {/* Re-opt from day selector */}
            <Select value={reoptFromDay} onValueChange={setReoptFromDay}>
              <SelectTrigger className="h-8 w-32 sm:w-40 text-xs">
                <RotateCcw className="mr-1 h-3 w-3 shrink-0" />
                <SelectValue placeholder="Desde dia..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  <span className="text-xs">Semana completa</span>
                </SelectItem>
                {DAY_ORDER.map((d) => (
                  <SelectItem key={d} value={d}>
                    <span className="text-xs">Desde {d}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              placeholder="Nota"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              className="h-8 w-24 sm:w-40 text-sm"
            />
            <Button
              size="sm"
              onClick={handleOptimize}
              disabled={optimizing}
            >
              {optimizing ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  <span className="hidden sm:inline">Optimizando...</span>
                  <span className="sm:hidden">...</span>
                </>
              ) : (
                <>
                  <Play className="mr-1 h-4 w-4" />
                  <span className="hidden sm:inline">Optimizar</span>
                </>
              )}
            </Button>
          </>
        )}
        {error && (
          <span className="text-xs sm:text-sm text-destructive">{error}</span>
        )}
      </div>
    </header>
  )
}
