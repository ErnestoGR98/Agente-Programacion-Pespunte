'use client'

import type { useConfiguracion } from '@/lib/hooks/useConfiguracion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TableExport } from '@/components/shared/TableExport'

const PESO_LABELS: Record<string, { label: string; desc: string }> = {
  tardiness: { label: 'Tardiness', desc: 'Penaliza pares no completados. Mayor valor = mas prioridad a cumplir el volumen total.' },
  balance: { label: 'Balance', desc: 'Penaliza desbalance de carga entre dias. Busca distribuir produccion uniformemente.' },
  span: { label: 'Span', desc: 'Penaliza que un modelo se extienda muchos dias. Preferir concentrar en pocos dias.' },
  changeover: { label: 'Changeover', desc: 'Penaliza cambios de modelo entre dias. Cada cambio implica tiempo de setup perdido.' },
  odd_lot: { label: 'Odd Lot', desc: 'Penaliza lotes que no son multiplos redondos. Preferir 100, 200 en vez de 137.' },
  saturday: { label: 'Saturday', desc: 'Penaliza programar trabajo en sabado. Evitar horas extra si es posible.' },
  uniformity: { label: 'Uniformity', desc: 'Penaliza variacion en pares/dia de un mismo modelo. Preferir cantidades constantes.' },
  early_start: { label: 'Early Start', desc: 'Bonus por empezar modelos lo antes posible en la semana.' },
  overtime: { label: 'Overtime', desc: 'Penaliza usar tiempo extra mas alla de la jornada regular.' },
}

// Parametros que pertenecen al optimizador semanal
const SEMANAL_PARAMS: Record<string, { label: string; desc: string }> = {
  lote_minimo: { label: 'Lote Minimo', desc: 'No programar menos de este numero de pares de un modelo en un dia.' },
  lote_preferido: { label: 'Lote Preferido', desc: 'Tamanio ideal de lote. El solver intenta usar multiplos de este valor.' },
  factor_eficiencia: { label: 'Factor Eficiencia', desc: 'Multiplica la capacidad teorica (ej: 0.9 = 90%). Representa perdidas reales de produccion.' },
  timeout_solver: { label: 'Timeout Solver (s)', desc: 'Segundos maximos que el solver semanal puede pensar.' },
  timeout: { label: 'Timeout (s)', desc: 'Segundos maximos que el solver semanal puede pensar.' },
}

// Parametros que pertenecen al optimizador diario
const DIARIO_PARAMS: Record<string, { label: string; desc: string }> = {
  factor_contiguidad: { label: 'Factor Contiguidad', desc: 'Que tan juntos deben estar los bloques de un modelo en el dia (0-1).' },
  lineas_post: { label: 'Lineas POST (Conveyor)', desc: 'Conveyors disponibles. Limita cuantos modelos pueden estar en POST simultaneamente. 0 = sin limite.' },
  w_diario_tardiness: { label: 'Peso: Tardiness', desc: 'Penaliza pares no completados en el dia. Peso mas alto = priorizar completar todo.' },
  w_diario_hc_overflow: { label: 'Peso: HC Overflow', desc: 'Penaliza exceder headcount o capacidad de recurso por bloque. Menor valor = permitir mas produccion.' },
  w_diario_idle: { label: 'Peso: Idle', desc: 'Penaliza operarios ociosos por bloque. Mayor valor = incentiva usar toda la plantilla.' },
}

// Combined for lookup
const ALL_PARAM_LABELS: Record<string, { label: string; desc: string }> = { ...SEMANAL_PARAMS, ...DIARIO_PARAMS }

export function PesosTab({ config }: { config: ReturnType<typeof useConfiguracion> }) {
  const semanalParams = config.parametros.filter((p) => p.nombre in SEMANAL_PARAMS)
  const diarioParams = config.parametros.filter((p) => p.nombre in DIARIO_PARAMS)
  // Params not in either category (future-proof)
  const otherParams = config.parametros.filter((p) => !(p.nombre in SEMANAL_PARAMS) && !(p.nombre in DIARIO_PARAMS))

  return (
    <div className="space-y-6 mt-4">
      {/* Pesos Semanales */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Pesos Semanales</CardTitle>
            <p className="text-[11px] text-muted-foreground mt-1">Controlan como se reparten los pares entre dias de la semana</p>
          </div>
          <TableExport
            title="Pesos Semanales"
            headers={['Nombre', 'Descripcion', 'Valor']}
            rows={config.pesos.map((p) => [PESO_LABELS[p.nombre]?.label || p.nombre, PESO_LABELS[p.nombre]?.desc || '', p.valor])}
          />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {config.pesos.map((p) => {
              const meta = PESO_LABELS[p.nombre]
              return (
                <div key={p.id} className="space-y-1">
                  <Label className="text-xs font-semibold">{meta?.label || p.nombre}</Label>
                  {meta?.desc && <p className="text-[11px] text-muted-foreground leading-tight">{meta.desc}</p>}
                  <Input
                    type="number" value={p.valor}
                    onChange={(e) => config.updatePeso(p.id, parseInt(e.target.value) || 0)}
                    className="h-8"
                  />
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Parametros Semanales */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Parametros Semanales</CardTitle>
            <p className="text-[11px] text-muted-foreground mt-1">Configuracion del optimizador que reparte pares por modelo por dia</p>
          </div>
          <TableExport
            title="Parametros Semanales"
            headers={['Nombre', 'Descripcion', 'Valor']}
            rows={semanalParams.map((p) => [SEMANAL_PARAMS[p.nombre]?.label || p.nombre, SEMANAL_PARAMS[p.nombre]?.desc || '', p.valor])}
          />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {semanalParams.map((p) => {
              const meta = SEMANAL_PARAMS[p.nombre]
              return (
                <div key={p.id} className="space-y-1">
                  <Label className="text-xs font-semibold">{meta?.label || p.nombre}</Label>
                  {meta?.desc && <p className="text-[11px] text-muted-foreground leading-tight">{meta.desc}</p>}
                  <Input
                    type="number" value={p.valor}
                    onChange={(e) => config.updateParametro(p.id, parseFloat(e.target.value) || 0)}
                    className="h-8"
                  />
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Parametros Diarios */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Parametros Diarios</CardTitle>
            <p className="text-[11px] text-muted-foreground mt-1">Configuracion del optimizador que asigna operaciones a bloques horarios</p>
          </div>
          <TableExport
            title="Parametros Diarios"
            headers={['Nombre', 'Descripcion', 'Valor']}
            rows={diarioParams.map((p) => [DIARIO_PARAMS[p.nombre]?.label || p.nombre, DIARIO_PARAMS[p.nombre]?.desc || '', p.valor])}
          />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {diarioParams.map((p) => {
              const meta = DIARIO_PARAMS[p.nombre]
              return (
                <div key={p.id} className="space-y-1">
                  <Label className="text-xs font-semibold">{meta?.label || p.nombre}</Label>
                  {meta?.desc && <p className="text-[11px] text-muted-foreground leading-tight">{meta.desc}</p>}
                  <Input
                    type="number" value={p.valor}
                    onChange={(e) => config.updateParametro(p.id, parseFloat(e.target.value) || 0)}
                    className="h-8"
                  />
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Otros parametros (si los hay) */}
      {otherParams.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Otros Parametros</CardTitle>
            <TableExport
              title="Otros Parametros"
              headers={['Nombre', 'Descripcion', 'Valor']}
              rows={otherParams.map((p) => [ALL_PARAM_LABELS[p.nombre]?.label || p.nombre, ALL_PARAM_LABELS[p.nombre]?.desc || '', p.valor])}
            />
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {otherParams.map((p) => {
                const meta = ALL_PARAM_LABELS[p.nombre]
                return (
                  <div key={p.id} className="space-y-1">
                    <Label className="text-xs font-semibold">{meta?.label || p.nombre}</Label>
                    {meta?.desc && <p className="text-[11px] text-muted-foreground leading-tight">{meta.desc}</p>}
                    <Input
                      type="number" value={p.valor}
                      onChange={(e) => config.updateParametro(p.id, parseFloat(e.target.value) || 0)}
                      className="h-8"
                    />
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
