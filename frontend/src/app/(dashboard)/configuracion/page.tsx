'use client'

import { useState } from 'react'
import { useConfiguracion } from '@/lib/hooks/useConfiguracion'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { MaquinasTab } from './tabs/MaquinasTab'
import { CapacidadesTab } from './tabs/CapacidadesTab'
import { FabricasTab } from './tabs/FabricasTab'
import { DiasTab } from './tabs/DiasTab'
import { PesosTab } from './tabs/PesosTab'
import { ReglasTab } from './tabs/ReglasTab'

export default function ConfiguracionPage() {
  const config = useConfiguracion()
  const [activeTab, setActiveTab] = useState('recursos')

  if (config.loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Configuracion</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Parametros del sistema de optimizacion.
      </p>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="recursos">Recursos</TabsTrigger>
          <TabsTrigger value="capacidades">Capacidades</TabsTrigger>
          <TabsTrigger value="fabricas">Fabricas</TabsTrigger>
          <TabsTrigger value="dias">Dias / Plantilla</TabsTrigger>
          <TabsTrigger value="pesos">Pesos / Params</TabsTrigger>
          <TabsTrigger value="reglas">Reglas</TabsTrigger>
        </TabsList>

        <TabsContent value="recursos"><MaquinasTab config={config} /></TabsContent>
        <TabsContent value="capacidades"><CapacidadesTab config={config} /></TabsContent>
        <TabsContent value="fabricas"><FabricasTab config={config} /></TabsContent>
        <TabsContent value="dias"><DiasTab config={config} /></TabsContent>
        <TabsContent value="pesos"><PesosTab config={config} /></TabsContent>
        <TabsContent value="reglas"><ReglasTab /></TabsContent>
      </Tabs>
    </div>
  )
}
