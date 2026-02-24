'use client'

import { useRestricciones } from '@/lib/hooks/useRestricciones'
import { useAppStore } from '@/lib/store/useAppStore'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { RestriccionesTab } from './RestriccionesForm'
import { AvanceTab } from './AvanceTab'

export default function RestriccionesPage() {
  const semana = useAppStore((s) => s.currentSemana)
  const pedidoNombre = useAppStore((s) => s.currentPedidoNombre)
  const restricciones = useRestricciones(semana || undefined)

  if (restricciones.loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Restricciones</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Reglas de negocio y avance de produccion.
        {semana && <Badge variant="secondary" className="ml-2">{semana}</Badge>}
      </p>

      <Tabs defaultValue="restricciones">
        <TabsList>
          <TabsTrigger value="restricciones">Restricciones</TabsTrigger>
          <TabsTrigger value="avance">Avance de Produccion</TabsTrigger>
        </TabsList>

        <TabsContent value="restricciones">
          <RestriccionesTab data={restricciones} semana={semana} />
        </TabsContent>
        <TabsContent value="avance">
          <AvanceTab semana={semana} pedidoNombre={pedidoNombre} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
