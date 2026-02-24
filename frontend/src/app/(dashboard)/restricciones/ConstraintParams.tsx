'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { DAY_NAMES, type ConstraintType, type Robot } from '@/types'

interface ModeloOption {
  modelo_num: string
  color: string
}

export function ConstraintParams({
  tipo,
  params,
  setParams,
  modeloItems = [],
}: {
  tipo: ConstraintType
  params: Record<string, unknown>
  setParams: (p: Record<string, unknown>) => void
  modeloItems?: ModeloOption[]
}) {
  const [robots, setRobots] = useState<Robot[]>([])

  const loadRobots = useCallback(async () => {
    const { data } = await supabase.from('robots').select('*').eq('estado', 'ACTIVO').order('orden')
    if (data) setRobots(data)
  }, [])

  useEffect(() => {
    if (tipo === 'ROBOT_NO_DISPONIBLE') loadRobots()
  }, [tipo, loadRobots])

  function set(key: string, value: unknown) {
    setParams({ ...params, [key]: value })
  }

  switch (tipo) {
    case 'PRIORIDAD':
      return (
        <div className="space-y-1">
          <Label className="text-xs">Peso (1=Normal, 2=Alta, 3=Urgente)</Label>
          <Select value={String(params.peso || 1)} onValueChange={(v) => set('peso', parseInt(v))}>
            <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 - Normal</SelectItem>
              <SelectItem value="2">2 - Alta</SelectItem>
              <SelectItem value="3">3 - Urgente</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )
    case 'MAQUILA':
      return (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Pares a maquilar</Label>
            <Input type="number" min={50} step={50} value={String(params.pares_maquila || '')}
              onChange={(e) => set('pares_maquila', parseInt(e.target.value) || 0)} className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Proveedor</Label>
            <Input value={String(params.proveedor || '')}
              onChange={(e) => set('proveedor', e.target.value)} className="h-8" />
          </div>
        </div>
      )
    case 'RETRASO_MATERIAL':
      return (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Disponible desde (dia)</Label>
            <Select value={String(params.disponible_desde || '')} onValueChange={(v) => set('disponible_desde', v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Dia..." /></SelectTrigger>
              <SelectContent>
                {DAY_NAMES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Hora disponible (opcional)</Label>
            <Select value={String(params.hora_disponible || '')} onValueChange={(v) => set('hora_disponible', v === 'none' ? '' : v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Inicio del dia" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Inicio del dia</SelectItem>
                <SelectItem value="8:00">8:00</SelectItem>
                <SelectItem value="9:00">9:00</SelectItem>
                <SelectItem value="10:00">10:00</SelectItem>
                <SelectItem value="11:00">11:00</SelectItem>
                <SelectItem value="12:00">12:00</SelectItem>
                <SelectItem value="14:00">14:00 (despues de comida)</SelectItem>
                <SelectItem value="15:00">15:00</SelectItem>
                <SelectItem value="16:00">16:00</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )
    case 'FIJAR_DIA':
      return (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Modo</Label>
            <Select value={String(params.modo || 'PERMITIR')} onValueChange={(v) => set('modo', v)}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="PERMITIR">PERMITIR</SelectItem>
                <SelectItem value="EXCLUIR">EXCLUIR</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Dias</Label>
            <div className="flex gap-2 flex-wrap">
              {DAY_NAMES.map((d) => (
                <label key={d} className="flex items-center gap-1 text-xs">
                  <Checkbox
                    checked={((params.dias as string[]) || []).includes(d)}
                    onCheckedChange={(checked) => {
                      const current = (params.dias as string[]) || []
                      set('dias', checked ? [...current, d] : current.filter((x) => x !== d))
                    }}
                  />
                  {d}
                </label>
              ))}
            </div>
          </div>
        </div>
      )
    case 'FECHA_LIMITE':
      return (
        <div className="space-y-1">
          <Label className="text-xs">Dia limite</Label>
          <Select value={String(params.dia_limite || '')} onValueChange={(v) => set('dia_limite', v)}>
            <SelectTrigger className="h-8 w-32"><SelectValue placeholder="Dia..." /></SelectTrigger>
            <SelectContent>
              {DAY_NAMES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )
    case 'SECUENCIA':
      return (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Modelo antes</Label>
            <Select value={String(params.modelo_antes || '')} onValueChange={(v) => set('modelo_antes', v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Modelo..." /></SelectTrigger>
              <SelectContent>
                {modeloItems.map((item, i) => (
                  <SelectItem key={`antes-${item.modelo_num}-${i}`} value={item.modelo_num}>
                    {item.modelo_num} — {item.color}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Modelo despues</Label>
            <Select value={String(params.modelo_despues || '')} onValueChange={(v) => set('modelo_despues', v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Modelo..." /></SelectTrigger>
              <SelectContent>
                {modeloItems.map((item, i) => (
                  <SelectItem key={`despues-${item.modelo_num}-${i}`} value={item.modelo_num}>
                    {item.modelo_num} — {item.color}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )
    case 'AGRUPAR_MODELOS':
      return (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Modelo A</Label>
            <Select value={String(params.modelo_a || '')} onValueChange={(v) => set('modelo_a', v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Modelo..." /></SelectTrigger>
              <SelectContent>
                {modeloItems.map((item, i) => (
                  <SelectItem key={`a-${item.modelo_num}-${i}`} value={item.modelo_num}>
                    {item.modelo_num} — {item.color}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Modelo B</Label>
            <Select value={String(params.modelo_b || '')} onValueChange={(v) => set('modelo_b', v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Modelo..." /></SelectTrigger>
              <SelectContent>
                {modeloItems.map((item, i) => (
                  <SelectItem key={`b-${item.modelo_num}-${i}`} value={item.modelo_num}>
                    {item.modelo_num} — {item.color}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )
    case 'AJUSTE_VOLUMEN':
      return (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Nuevo volumen</Label>
            <Input type="number" min={0} step={50} value={String(params.nuevo_volumen || '')}
              onChange={(e) => set('nuevo_volumen', parseInt(e.target.value) || 0)} className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Motivo</Label>
            <Input value={String(params.motivo || '')}
              onChange={(e) => set('motivo', e.target.value)} className="h-8" />
          </div>
        </div>
      )
    case 'LOTE_MINIMO_CUSTOM':
      return (
        <div className="space-y-1">
          <Label className="text-xs">Lote minimo (pares)</Label>
          <Input type="number" min={10} max={500} step={10} value={String(params.lote_minimo || '')}
            onChange={(e) => set('lote_minimo', parseInt(e.target.value) || 0)} className="h-8 w-32" />
        </div>
      )
    case 'ROBOT_NO_DISPONIBLE': {
      const diasSelected = (params.dias as string[]) || []
      return (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Robot</Label>
            <Select value={String(params.robot || '')} onValueChange={(v) => set('robot', v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Robot..." /></SelectTrigger>
              <SelectContent>
                {robots.map((r) => (
                  <SelectItem key={r.id} value={r.nombre}>{r.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Dias no disponible</Label>
            <div className="flex gap-2 flex-wrap">
              {DAY_NAMES.map((d) => (
                <label key={d} className="flex items-center gap-1 text-xs">
                  <Checkbox
                    checked={diasSelected.includes(d)}
                    onCheckedChange={(checked) => {
                      set('dias', checked ? [...diasSelected, d] : diasSelected.filter((x) => x !== d))
                    }}
                  />
                  {d}
                </label>
              ))}
            </div>
            {diasSelected.length === 0 && (
              <p className="text-xs text-destructive">Sin dias seleccionados = bloqueado toda la semana</p>
            )}
          </div>
        </div>
      )
    }
    case 'AUSENCIA_OPERARIO':
      return (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Dia</Label>
            <Select value={String(params.dia || '')} onValueChange={(v) => set('dia', v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Dia..." /></SelectTrigger>
              <SelectContent>
                {DAY_NAMES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Cantidad ausentes</Label>
            <Input type="number" min={1} value={String(params.cantidad || '')}
              onChange={(e) => set('cantidad', parseInt(e.target.value) || 1)} className="h-8 w-24" />
          </div>
        </div>
      )
    case 'CAPACIDAD_DIA':
      return (
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Dia</Label>
            <Select value={String(params.dia || '')} onValueChange={(v) => set('dia', v)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Dia..." /></SelectTrigger>
              <SelectContent>
                {DAY_NAMES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Nueva plantilla</Label>
            <Input type="number" min={1} value={String(params.nueva_plantilla || '')}
              onChange={(e) => set('nueva_plantilla', parseInt(e.target.value) || 0)} className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Motivo</Label>
            <Input value={String(params.motivo || '')}
              onChange={(e) => set('motivo', e.target.value)} className="h-8" />
          </div>
        </div>
      )
    case 'PRECEDENCIA_OPERACION':
      return (
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Fraccion origen</Label>
            <Input type="number" min={1} value={String(params.fraccion_origen || '')}
              onChange={(e) => set('fraccion_origen', parseInt(e.target.value) || 0)} className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Fraccion destino</Label>
            <Input type="number" min={1} value={String(params.fraccion_destino || '')}
              onChange={(e) => set('fraccion_destino', parseInt(e.target.value) || 0)} className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Buffer (pares)</Label>
            <Input type="number" min={0} step={50} value={String(params.buffer_pares || '')}
              onChange={(e) => set('buffer_pares', parseInt(e.target.value) || 0)} className="h-8" />
          </div>
        </div>
      )
    default:
      return null
  }
}
