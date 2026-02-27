'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { DAY_NAMES, STAGE_COLORS, type ConstraintType, type Robot } from '@/types'

interface ModeloOption {
  modelo_num: string
  color: string
}

interface FraccionOption {
  fraccion: number
  operacion: string
  input_o_proceso: string
}

export function ConstraintParams({
  tipo,
  params,
  setParams,
  modeloItems = [],
  selectedModelo,
}: {
  tipo: ConstraintType
  params: Record<string, unknown>
  setParams: (p: Record<string, unknown>) => void
  modeloItems?: ModeloOption[]
  selectedModelo?: string
}) {
  const [robots, setRobots] = useState<Robot[]>([])
  const [fracciones, setFracciones] = useState<FraccionOption[]>([])

  const loadRobots = useCallback(async () => {
    const { data } = await supabase.from('robots').select('*').eq('estado', 'ACTIVO').order('orden')
    if (data) setRobots(data)
  }, [])

  const loadFracciones = useCallback(async () => {
    if (!selectedModelo || selectedModelo === '*') {
      setFracciones([])
      return
    }
    const { data: modelo } = await supabase
      .from('catalogo_modelos')
      .select('id')
      .eq('modelo_num', selectedModelo)
      .single()
    if (!modelo) { setFracciones([]); return }
    const { data: ops } = await supabase
      .from('catalogo_operaciones')
      .select('fraccion, operacion, input_o_proceso')
      .eq('modelo_id', modelo.id)
      .order('fraccion')
    setFracciones(ops || [])
  }, [selectedModelo])

  useEffect(() => {
    if (tipo === 'ROBOT_NO_DISPONIBLE') loadRobots()
  }, [tipo, loadRobots])

  useEffect(() => {
    if (tipo === 'PRECEDENCIA_OPERACION') loadFracciones()
  }, [tipo, loadFracciones])

  function set(key: string, value: unknown) {
    setParams({ ...params, [key]: value })
  }

  function stageColor(stage: string): string {
    if (stage === 'PRELIMINARES' || stage.includes('PRELIMINAR')) return STAGE_COLORS.PRELIMINAR
    return STAGE_COLORS[stage] || '#94A3B8'
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
    case 'PRECEDENCIA_OPERACION': {
      const fracsOrigen = (params.fracciones_origen as number[]) || []
      const fracsDest = (params.fracciones_destino as number[]) || []

      function toggleFrac(frac: number, group: 'origen' | 'destino') {
        const keyThis = group === 'origen' ? 'fracciones_origen' : 'fracciones_destino'
        const keyOther = group === 'origen' ? 'fracciones_destino' : 'fracciones_origen'
        const current = (params[keyThis] as number[]) || []
        const other = (params[keyOther] as number[]) || []

        if (current.includes(frac)) {
          // Uncheck
          setParams({ ...params, [keyThis]: current.filter((f) => f !== frac) })
        } else {
          // Check this, remove from other group
          setParams({
            ...params,
            [keyThis]: [...current, frac].sort((a, b) => a - b),
            [keyOther]: other.filter((f) => f !== frac),
          })
        }
      }

      if (fracciones.length === 0) {
        return (
          <p className="text-xs text-muted-foreground">
            Selecciona un modelo para ver sus operaciones.
          </p>
        )
      }

      return (
        <div className="space-y-3">
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-2 py-1.5 text-left w-14">Fracc</th>
                  <th className="px-2 py-1.5 text-left">Operacion</th>
                  <th className="px-2 py-1.5 text-left w-28">Proceso</th>
                  <th className="px-2 py-1.5 text-center w-16">Origen</th>
                  <th className="px-2 py-1.5 text-center w-16">Destino</th>
                </tr>
              </thead>
              <tbody>
                {fracciones.map((f) => (
                  <tr key={f.fraccion} className="border-b last:border-0 hover:bg-accent/30">
                    <td className="px-2 py-1 font-mono">F{f.fraccion}</td>
                    <td className="px-2 py-1">{f.operacion}</td>
                    <td className="px-2 py-1">
                      <Badge
                        variant="outline"
                        className="text-[10px] font-medium"
                        style={{ borderColor: stageColor(f.input_o_proceso), color: stageColor(f.input_o_proceso) }}
                      >
                        {f.input_o_proceso}
                      </Badge>
                    </td>
                    <td className="px-2 py-1 text-center">
                      <Checkbox
                        checked={fracsOrigen.includes(f.fraccion)}
                        onCheckedChange={() => toggleFrac(f.fraccion, 'origen')}
                      />
                    </td>
                    <td className="px-2 py-1 text-center">
                      <Checkbox
                        checked={fracsDest.includes(f.fraccion)}
                        onCheckedChange={() => toggleFrac(f.fraccion, 'destino')}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Buffer (pares)</Label>
            <div className="flex items-center gap-2">
              <Select
                value={params.buffer_pares === 'todo' ? 'todo' : 'numero'}
                onValueChange={(v) => {
                  if (v === 'todo') set('buffer_pares', 'todo')
                  else set('buffer_pares', 0)
                }}
              >
                <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todo">Todo</SelectItem>
                  <SelectItem value="numero">Especifico</SelectItem>
                </SelectContent>
              </Select>
              {params.buffer_pares !== 'todo' && (
                <Input type="number" min={0} step={50}
                  value={String(params.buffer_pares || '')}
                  onChange={(e) => set('buffer_pares', parseInt(e.target.value) || 0)}
                  className="h-8 w-28" placeholder="0" />
              )}
              <span className="text-[10px] text-muted-foreground">
                {params.buffer_pares === 'todo'
                  ? 'Origen debe completar todos los pares antes de iniciar destino'
                  : 'Pares de ventaja del origen sobre destino'}
              </span>
            </div>
          </div>
          {fracsOrigen.length === 0 && fracsDest.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Marca las operaciones del bloque que debe completarse primero (Origen) y las que esperan (Destino).
            </p>
          )}
        </div>
      )
    }
    default:
      return null
  }
}
