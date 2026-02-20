'use client'

import { usePedido } from '@/lib/hooks/usePedido'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { PedidoTab } from './PedidoTab'
import { CatalogoTab } from './CatalogoTab'

export default function DatosPage() {
  const pedido = usePedido()

  if (pedido.loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Datos</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Pedido semanal y catalogo de operaciones.
      </p>

      <Tabs defaultValue="pedido">
        <TabsList>
          <TabsTrigger value="pedido">Pedido Semanal</TabsTrigger>
          <TabsTrigger value="catalogo">Catalogo de Operaciones</TabsTrigger>
        </TabsList>

        <TabsContent value="pedido">
          <PedidoTab pedido={pedido} />
        </TabsContent>
        <TabsContent value="catalogo">
          <CatalogoTab pedido={pedido} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
