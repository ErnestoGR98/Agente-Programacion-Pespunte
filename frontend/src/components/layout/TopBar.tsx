'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '@/lib/store/useAppStore'
import { supabase } from '@/lib/supabase/client'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { History } from 'lucide-react'
import type { Resultado } from '@/types'
import { MenuButton } from '@/components/layout/Sidebar'

interface ResultVersion {
  id: string
  nombre: string
  fecha_optimizacion: string
  nota: string | null
}

export function TopBar() {
  const { currentPedidoNombre, currentSemana, setCurrentResult, currentResult } = useAppStore()
  const [versions, setVersions] = useState<ResultVersion[]>([])

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
      </div>
    </header>
  )
}
