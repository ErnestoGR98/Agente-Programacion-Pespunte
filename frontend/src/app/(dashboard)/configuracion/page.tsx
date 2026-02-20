'use client'

import { useState } from 'react'
import { useConfiguracion } from '@/lib/hooks/useConfiguracion'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Trash2, Plus } from 'lucide-react'
import type { Robot, DiaLaboral } from '@/types'

export default function ConfiguracionPage() {
  const config = useConfiguracion()

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

      <Tabs defaultValue="robots">
        <TabsList>
          <TabsTrigger value="robots">Robots</TabsTrigger>
          <TabsTrigger value="capacidades">Capacidades</TabsTrigger>
          <TabsTrigger value="fabricas">Fabricas</TabsTrigger>
          <TabsTrigger value="dias">Dias / Plantilla</TabsTrigger>
          <TabsTrigger value="pesos">Pesos / Params</TabsTrigger>
        </TabsList>

        <TabsContent value="robots">
          <RobotsTab config={config} />
        </TabsContent>
        <TabsContent value="capacidades">
          <CapacidadesTab config={config} />
        </TabsContent>
        <TabsContent value="fabricas">
          <FabricasTab config={config} />
        </TabsContent>
        <TabsContent value="dias">
          <DiasTab config={config} />
        </TabsContent>
        <TabsContent value="pesos">
          <PesosTab config={config} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ============================================================
// Sub-tab: Robots
// ============================================================

function RobotsTab({ config }: { config: ReturnType<typeof useConfiguracion> }) {
  const [newName, setNewName] = useState('')
  const [newAlias, setNewAlias] = useState('')
  const [aliasRobot, setAliasRobot] = useState('')

  return (
    <div className="space-y-6 mt-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Robots Fisicos</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Area</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {config.robots.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-sm">{r.nombre}</TableCell>
                  <TableCell>
                    <Select
                      value={r.estado}
                      onValueChange={(v) => config.updateRobot(r.id, { estado: v as Robot['estado'] })}
                    >
                      <SelectTrigger className="h-8 w-44">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ACTIVO">ACTIVO</SelectItem>
                        <SelectItem value="FUERA DE SERVICIO">FUERA DE SERVICIO</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={r.area}
                      onValueChange={(v) => config.updateRobot(r.id, { area: v as Robot['area'] })}
                    >
                      <SelectTrigger className="h-8 w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PESPUNTE">PESPUNTE</SelectItem>
                        <SelectItem value="AVIOS">AVIOS</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost" size="icon"
                      onClick={() => config.deleteRobot(r.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-3 flex gap-2">
            <Input
              placeholder="Nuevo robot..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-8 w-48"
            />
            <Button
              size="sm"
              onClick={() => { if (newName.trim()) { config.addRobot(newName.trim()); setNewName('') } }}
            >
              <Plus className="mr-1 h-3 w-3" /> Agregar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Aliases de Robots</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Alias (nombre en Excel)</TableHead>
                <TableHead>Robot Real</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {config.aliases.map((a) => {
                const robot = config.robots.find((r) => r.id === a.robot_id)
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-sm">{a.alias}</TableCell>
                    <TableCell>{robot?.nombre || '?'}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => config.deleteAlias(a.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <div className="mt-3 flex gap-2">
            <Input
              placeholder="Alias..."
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              className="h-8 w-40"
            />
            <Select value={aliasRobot} onValueChange={setAliasRobot}>
              <SelectTrigger className="h-8 w-44">
                <SelectValue placeholder="Robot..." />
              </SelectTrigger>
              <SelectContent>
                {config.robots.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={() => {
                if (newAlias.trim() && aliasRobot) {
                  config.addAlias(newAlias.trim(), aliasRobot)
                  setNewAlias('')
                  setAliasRobot('')
                }
              }}
            >
              <Plus className="mr-1 h-3 w-3" /> Agregar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================
// Sub-tab: Capacidades
// ============================================================

function CapacidadesTab({ config }: { config: ReturnType<typeof useConfiguracion> }) {
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-base">Capacidad por Tipo de Recurso (pares/hora)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4">
          {config.capacidades.map((c) => (
            <div key={c.id} className="space-y-1">
              <Label className="text-xs">{c.tipo}</Label>
              <Input
                type="number"
                value={c.pares_hora}
                onChange={(e) => config.updateCapacidad(c.id, parseInt(e.target.value) || 0)}
                className="h-8"
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================
// Sub-tab: Fabricas
// ============================================================

function FabricasTab({ config }: { config: ReturnType<typeof useConfiguracion> }) {
  const [newName, setNewName] = useState('')

  return (
    <Card className="mt-4">
      <CardHeader><CardTitle className="text-base">Fabricas</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {config.fabricas.map((f) => (
              <TableRow key={f.id}>
                <TableCell>
                  <Input
                    value={f.nombre}
                    onChange={(e) => config.updateFabrica(f.id, e.target.value)}
                    className="h-8 w-48"
                  />
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => config.deleteFabrica(f.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="mt-3 flex gap-2">
          <Input
            placeholder="Nueva fabrica..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="h-8 w-48"
          />
          <Button
            size="sm"
            onClick={() => { if (newName.trim()) { config.addFabrica(newName.trim()); setNewName('') } }}
          >
            <Plus className="mr-1 h-3 w-3" /> Agregar
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================
// Sub-tab: Dias / Plantilla
// ============================================================

function DiasTab({ config }: { config: ReturnType<typeof useConfiguracion> }) {
  function handleChange(id: string, field: keyof DiaLaboral, value: number | boolean) {
    config.updateDia(id, { [field]: value })
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-base">Dias Laborales y Plantilla</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dia</TableHead>
              <TableHead>Minutos</TableHead>
              <TableHead>Plantilla</TableHead>
              <TableHead>Min OT</TableHead>
              <TableHead>Plant. OT</TableHead>
              <TableHead>Sabado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {config.dias.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.nombre}</TableCell>
                <TableCell>
                  <Input
                    type="number" value={d.minutos}
                    onChange={(e) => handleChange(d.id, 'minutos', parseInt(e.target.value) || 0)}
                    className="h-8 w-20"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number" value={d.plantilla}
                    onChange={(e) => handleChange(d.id, 'plantilla', parseInt(e.target.value) || 0)}
                    className="h-8 w-20"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number" value={d.minutos_ot}
                    onChange={(e) => handleChange(d.id, 'minutos_ot', parseInt(e.target.value) || 0)}
                    className="h-8 w-20"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number" value={d.plantilla_ot}
                    onChange={(e) => handleChange(d.id, 'plantilla_ot', parseInt(e.target.value) || 0)}
                    className="h-8 w-20"
                  />
                </TableCell>
                <TableCell>
                  <Checkbox
                    checked={d.es_sabado}
                    onCheckedChange={(v) => handleChange(d.id, 'es_sabado', v === true)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// ============================================================
// Sub-tab: Pesos y Parametros
// ============================================================

function PesosTab({ config }: { config: ReturnType<typeof useConfiguracion> }) {
  return (
    <div className="space-y-6 mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pesos de Priorizacion</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            {config.pesos.map((p) => (
              <div key={p.id} className="space-y-1">
                <Label className="text-xs">{p.nombre}</Label>
                <Input
                  type="number" value={p.valor}
                  onChange={(e) => config.updatePeso(p.id, parseInt(e.target.value) || 0)}
                  className="h-8"
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parametros de Optimizacion</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            {config.parametros.map((p) => (
              <div key={p.id} className="space-y-1">
                <Label className="text-xs">{p.nombre}</Label>
                <Input
                  type="number" value={p.valor}
                  onChange={(e) => config.updateParametro(p.id, parseFloat(e.target.value) || 0)}
                  className="h-8"
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
