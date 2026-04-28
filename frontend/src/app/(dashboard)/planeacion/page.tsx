'use client'

import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { generateFromPlan } from '@/lib/api/fastapi'
import { useAppStore } from '@/lib/store/useAppStore'
import type { Resultado } from '@/types'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { KpiCard } from '@/components/shared/KpiCard'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { ModeloImg } from '@/components/shared/ModeloImg'
import { useCatalogoImages } from '@/lib/hooks/useCatalogoImages'
import { cn } from '@/lib/utils'
import {
  Plus, Trash2, Download, Clock, Calculator, ChevronDown, ChevronRight,
  Save, FolderOpen, Upload, FileSpreadsheet, GripVertical, Workflow, Bot, X,
} from 'lucide-react'
import type { DayName, ProcessType } from '@/types'
import { DAY_ORDER, STAGE_COLORS } from '@/types'
import { ComparativoTab } from './ComparativoTab'
import { ReferenciaTab } from './ReferenciaTab'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CatOp {
  id: string
  fraccion: number
  operacion: string
  input_o_proceso: ProcessType
  etapa: string
  recurso: string
  rate: number
  /** IDs de robots compatibles del catalogo (relacion catalogo_operacion_robots) */
  compatibleRobots: string[]
}

interface CatModelo {
  id: string
  modelo_num: string
  alternativas: string[]
  operaciones: CatOp[]
}

interface RobotLite {
  id: string
  nombre: string
  estado: string // 'ACTIVO' | 'FUERA DE SERVICIO'
}

/** Estado del programa para (modelo, fraccion, robot) en la matriz global */
type ProgramaEstado = 'TIENE' | 'FALTA'

/** Map modelo_num -> fraccion -> robot_id -> estado */
type ProgramaMatriz = Record<string, Record<number, Record<string, ProgramaEstado>>>

/** Asignacion robot -> porcentaje para una operacion ROBOT especifica */
interface RobotAssign {
  robot_id: string
  porcentaje: number
}

/** modelo_num -> fraccion -> dia -> lista de asignaciones (por dia) */
type AsignacionesMap = Record<string, Record<number, Partial<Record<DayName, RobotAssign[]>>>>

interface PlanRow {
  key: string
  modelo_num: string
  color: string
  pares: Record<DayName, number>
}

interface PlanHeader {
  id: string
  nombre: string
  semana: string | null
  nota: string
  created_at: string
}

// Generador de id estable para React keys (no depende de modelo/color)
function genRowId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// Etapa label mapping
const ETAPA_LABEL: Record<string, string> = {
  PRELIMINARES: 'PREL',
  ROBOT: 'ROBOT',
  POST: 'POST',
  MAQUILA: 'MAQ',
  'N/A PRELIMINAR': 'N/A',
}

const ETAPA_ORDER = ['ROBOT', 'PREL', 'POST', 'N/A', 'MAQ'] as const

function etapaShort(input_o_proceso: string): string {
  return ETAPA_LABEL[input_o_proceso] ?? input_o_proceso
}

// Meses abreviados en espanol para nombrar planes (criterio: "SEM17 · Abr 20-24")
const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

/** Semana ISO (1-53) y anio ISO para una fecha */
function getISOWeekInfo(date: Date): { year: number; week: number } {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return { year: target.getUTCFullYear(), week }
}

/** Lunes y viernes (dia 4) de la semana ISO dada */
function getISOWeekMonFri(year: number, week: number): { monday: Date; friday: Date } {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Day = jan4.getUTCDay() || 7
  const mondayWeek1 = new Date(jan4)
  mondayWeek1.setUTCDate(jan4.getUTCDate() - (jan4Day - 1))
  const monday = new Date(mondayWeek1)
  monday.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7)
  const friday = new Date(monday)
  friday.setUTCDate(monday.getUTCDate() + 4)
  return { monday, friday }
}

/**
 * Formatea nombre de plan con criterio "SEM{N} · {Mes} {dd}-{dd}" si la semana
 * cae en el mismo mes, o "SEM{N} · {Mes} {dd}-{dd} {Mes2}" si cruza meses.
 */
function formatPlanName(year: number, week: number): string {
  const { monday, friday } = getISOWeekMonFri(year, week)
  const mMonth = MONTHS_ES[monday.getUTCMonth()]
  const fMonth = MONTHS_ES[friday.getUTCMonth()]
  const mDay = String(monday.getUTCDate()).padStart(2, '0')
  const fDay = String(friday.getUTCDate()).padStart(2, '0')
  if (mMonth === fMonth) return `SEM${week} · ${mMonth} ${mDay}-${fDay}`
  return `SEM${week} · ${mMonth} ${mDay}-${fDay} ${fMonth}`
}

/** Decide cual es el proximo nombre a sugerir basado en los SEM# ya usados. */
function computeNextPlanName(existingNames: string[]): string {
  const usedWeeks = new Set<number>()
  for (const name of existingNames) {
    const m = /SEM(\d+)/i.exec(name)
    if (m) usedWeeks.add(Number(m[1]))
  }
  const now = new Date()
  const { year: currentYear, week: currentWeek } = getISOWeekInfo(now)
  // Empezar desde la semana actual y avanzar hasta encontrar una no usada
  let year = currentYear
  let week = currentWeek
  while (usedWeeks.has(week)) {
    week += 1
    if (week > 52) { week = 1; year += 1 }
  }
  return formatPlanName(year, week)
}

function etapaColor(short: string): string {
  const map: Record<string, string> = {
    PREL: STAGE_COLORS.PRELIMINAR,
    ROBOT: STAGE_COLORS.ROBOT,
    POST: STAGE_COLORS.POST,
    MAQ: STAGE_COLORS.MAQUILA,
    'N/A': STAGE_COLORS['N/A PRELIMINAR'],
  }
  return map[short] ?? '#6B7280'
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function PlaneacionPage() {
  // --- Catalog data ---
  const [catalogo, setCatalogo] = useState<CatModelo[]>([])
  const [robots, setRobots] = useState<RobotLite[]>([])
  const [loadingCat, setLoadingCat] = useState(true)
  const images = useCatalogoImages()

  // --- Asignaciones de robots por plan ---
  const [asignaciones, setAsignaciones] = useState<AsignacionesMap>({})

  // --- Matriz global robot × (modelo, fraccion) ---
  const [programaMatriz, setProgramaMatriz] = useState<ProgramaMatriz>({})

  // --- Plan state ---
  const router = useRouter()
  const [planId, setPlanId] = useState<string | null>(null)
  const [planName, setPlanName] = useState('')
  const [rows, setRows] = useState<PlanRow[]>([])
  const [activeDays, setActiveDays] = useState<DayName[]>(['Lun', 'Mar', 'Mie', 'Jue', 'Vie'])
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [generating, setGenerating] = useState(false)

  // --- Saved plans list ---
  const [savedPlans, setSavedPlans] = useState<PlanHeader[]>([])

  // --- Delete plan flow (doble confirmacion) ---
  const [deleteStep1, setDeleteStep1] = useState(false)
  const [deleteStep2, setDeleteStep2] = useState(false)

  // --- Drag-n-drop de filas (reorder) ---
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)

  // --- Tab state ---
  const [tab, setTab] = useState<'editor' | 'comparativo' | 'referencia'>('editor')

  // --- Load catalog + saved plans ---
  useEffect(() => {
    ;(async () => {
      setLoadingCat(true)
      const [modRes, opsRes, opRobotsRes, robotsRes, plansRes, programaRes] = await Promise.all([
        supabase.from('catalogo_modelos').select('id, modelo_num, alternativas').order('modelo_num'),
        supabase.from('catalogo_operaciones').select('id, modelo_id, fraccion, operacion, input_o_proceso, etapa, recurso, rate').order('fraccion'),
        supabase.from('catalogo_operacion_robots').select('operacion_id, robot_id'),
        supabase.from('robots').select('id, nombre, estado').order('nombre'),
        supabase.from('planes_semanales').select('id, nombre, semana, nota, created_at').order('created_at', { ascending: false }),
        supabase.from('robot_programa').select('robot_id, modelo_num, fraccion, estado'),
      ])
      const mods = (modRes.data || []) as { id: string; modelo_num: string; alternativas: string[] }[]
      const ops = (opsRes.data || []) as { id: string; modelo_id: string; fraccion: number; operacion: string; input_o_proceso: ProcessType; etapa: string; recurso: string; rate: number | string }[]
      const opRobots = (opRobotsRes.data || []) as { operacion_id: string; robot_id: string }[]
      const robotsData = (robotsRes.data || []) as RobotLite[]
      const programaData = (programaRes.data || []) as { robot_id: string; modelo_num: string; fraccion: number; estado: ProgramaEstado }[]

      const matriz: ProgramaMatriz = {}
      const robotIdsEnMatriz = new Set<string>()
      for (const p of programaData) {
        if (!matriz[p.modelo_num]) matriz[p.modelo_num] = {}
        if (!matriz[p.modelo_num][p.fraccion]) matriz[p.modelo_num][p.fraccion] = {}
        matriz[p.modelo_num][p.fraccion][p.robot_id] = p.estado
        robotIdsEnMatriz.add(p.robot_id)
      }
      setProgramaMatriz(matriz)

      // operacion_id -> [robot_id, ...]
      const opRobotsMap = new Map<string, string[]>()
      for (const r of opRobots) {
        if (!opRobotsMap.has(r.operacion_id)) opRobotsMap.set(r.operacion_id, [])
        opRobotsMap.get(r.operacion_id)!.push(r.robot_id)
      }

      const opsByModel = new Map<string, CatOp[]>()
      for (const op of ops) {
        if (!opsByModel.has(op.modelo_id)) opsByModel.set(op.modelo_id, [])
        opsByModel.get(op.modelo_id)!.push({
          id: op.id,
          fraccion: op.fraccion,
          operacion: op.operacion,
          input_o_proceso: op.input_o_proceso,
          etapa: op.etapa,
          recurso: op.recurso,
          rate: Number(op.rate),
          compatibleRobots: opRobotsMap.get(op.id) ?? [],
        })
      }

      // Solo consideramos 'robots' los que aparecen en la matriz de programas.
      // La tabla 'robots' de la DB incluye otras maquinas (plana, zigzag, pintura)
      // que no son robots de costura.
      const robotsFiltered = robotsData.filter((r) => robotIdsEnMatriz.has(r.id))
      setRobots(robotsFiltered)
      setCatalogo(mods.map((m) => ({
        id: m.id,
        modelo_num: m.modelo_num,
        alternativas: m.alternativas ?? [],
        operaciones: opsByModel.get(m.id) ?? [],
      })))
      const planHeaders = (plansRes.data || []) as PlanHeader[]
      setSavedPlans(planHeaders)
      // Auto-fill nombre sugerido si no hay plan cargado ni nombre tecleado
      setPlanName((prev) => (prev.trim() === '' ? computeNextPlanName(planHeaders.map((p) => p.nombre)) : prev))
      setLoadingCat(false)
    })()
  }, [])

  // --- Load dias_laborales ---
  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('dias_laborales')
        .select('nombre')
        .gt('plantilla', 0)
        .order('orden')
      if (data) {
        const ordered = DAY_ORDER.filter((d) =>
          data.some((row: { nombre: string }) => row.nombre === d),
        )
        setActiveDays(ordered as DayName[])
      }
    })()
  }, [])

  // --- Helpers ---
  const catalogoMap = useMemo(() => {
    const m = new Map<string, CatModelo>()
    for (const c of catalogo) m.set(c.modelo_num, c)
    return m
  }, [catalogo])

  // Map: modelo_num -> colores ya usados por filas existentes
  const usedColorsByModel = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const r of rows) {
      if (!m.has(r.modelo_num)) m.set(r.modelo_num, new Set())
      m.get(r.modelo_num)!.add(r.color)
    }
    return m
  }, [rows])

  // Disponibilidad de un modelo para el dropdown
  function modelAvailability(cat: CatModelo): { canAdd: boolean; nextColor: string } {
    const used = usedColorsByModel.get(cat.modelo_num) ?? new Set()
    if (cat.alternativas && cat.alternativas.length > 0) {
      const next = cat.alternativas.find((a) => !used.has(a))
      return { canAdd: next !== undefined, nextColor: next ?? '' }
    }
    return { canAdd: !used.has(''), nextColor: '' }
  }

  const addModel = useCallback((modeloNum: string) => {
    const cat = catalogoMap.get(modeloNum)
    if (!cat) return
    const { canAdd, nextColor } = modelAvailability(cat)
    if (!canAdd) return
    setRows((prev) => [
      ...prev,
      {
        key: genRowId(),
        modelo_num: modeloNum,
        color: nextColor,
        pares: Object.fromEntries(activeDays.map((d) => [d, 0])) as Record<DayName, number>,
      },
    ])
    setDirty(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDays, catalogoMap, usedColorsByModel])

  const updateColor = useCallback((rowKey: string, color: string) => {
    setRows((prev) =>
      prev.map((r) => (r.key === rowKey ? { ...r, color } : r)),
    )
    setDirty(true)
  }, [])

  // --- Asignaciones helpers (por dia) -------------------------------------
  const setAssignList = useCallback((modeloNum: string, fraccion: number, dia: DayName, next: RobotAssign[]) => {
    setAsignaciones((prev) => {
      const byFrac = { ...(prev[modeloNum]?.[fraccion] ?? {}) } as Partial<Record<DayName, RobotAssign[]>>
      if (next.length === 0) delete byFrac[dia]
      else byFrac[dia] = next

      const byModel = { ...(prev[modeloNum] ?? {}) }
      if (Object.keys(byFrac).length === 0) delete byModel[fraccion]
      else byModel[fraccion] = byFrac

      const out = { ...prev }
      if (Object.keys(byModel).length === 0) delete out[modeloNum]
      else out[modeloNum] = byModel
      return out
    })
    setDirty(true)
  }, [])

  const toggleRobotAssign = useCallback((modeloNum: string, fraccion: number, dia: DayName, robotId: string) => {
    setAsignaciones((prev) => {
      const cur = prev[modeloNum]?.[fraccion]?.[dia] ?? []
      const exists = cur.some((a) => a.robot_id === robotId)
      const nextList = exists
        ? cur.filter((a) => a.robot_id !== robotId)
        : [...cur, { robot_id: robotId, porcentaje: 0 }]
      // Redistribuir equitativamente
      const n = nextList.length
      const even = n > 0 ? Math.round((100 / n) * 100) / 100 : 0
      const distributed = nextList.map((a, i) => ({
        robot_id: a.robot_id,
        porcentaje: i === n - 1 ? Math.round((100 - even * (n - 1)) * 100) / 100 : even,
      }))
      const byFrac = { ...(prev[modeloNum]?.[fraccion] ?? {}) } as Partial<Record<DayName, RobotAssign[]>>
      if (distributed.length === 0) delete byFrac[dia]
      else byFrac[dia] = distributed

      const byModel = { ...(prev[modeloNum] ?? {}) }
      if (Object.keys(byFrac).length === 0) delete byModel[fraccion]
      else byModel[fraccion] = byFrac

      const out = { ...prev }
      if (Object.keys(byModel).length === 0) delete out[modeloNum]
      else out[modeloNum] = byModel
      return out
    })
    setDirty(true)
  }, [])

  const setAssignPercent = useCallback((modeloNum: string, fraccion: number, dia: DayName, robotId: string, pct: number) => {
    setAsignaciones((prev) => {
      const cur = prev[modeloNum]?.[fraccion]?.[dia] ?? []
      const clamped = Math.max(0, Math.min(100, pct))
      const others = cur.filter((a) => a.robot_id !== robotId)
      const remaining = Math.max(0, 100 - clamped)
      const n = others.length
      const evenShare = n > 0 ? Math.round((remaining / n) * 100) / 100 : 0
      const redistOthers = others.map((a, i) => ({
        robot_id: a.robot_id,
        porcentaje: i === n - 1 ? Math.round((remaining - evenShare * (n - 1)) * 100) / 100 : evenShare,
      }))
      const next = cur.map((a) =>
        a.robot_id === robotId
          ? { robot_id: robotId, porcentaje: clamped }
          : redistOthers.find((o) => o.robot_id === a.robot_id) ?? a,
      )
      const byFrac = { ...(prev[modeloNum]?.[fraccion] ?? {}) } as Partial<Record<DayName, RobotAssign[]>>
      byFrac[dia] = next
      const byModel = { ...(prev[modeloNum] ?? {}) }
      byModel[fraccion] = byFrac
      return { ...prev, [modeloNum]: byModel }
    })
    setDirty(true)
  }, [])

  const removeRow = useCallback((key: string) => {
    setRows((prev) => prev.filter((r) => r.key !== key))
    setExpandedModels((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    setDirty(true)
  }, [])

  const updatePares = useCallback((key: string, day: DayName, value: number) => {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, pares: { ...r.pares, [day]: value } } : r)),
    )
    setDirty(true)
  }, [])

  const moveRow = useCallback((fromKey: string, toKey: string) => {
    if (fromKey === toKey) return
    setRows((prev) => {
      const fromIdx = prev.findIndex((r) => r.key === fromKey)
      const toIdx = prev.findIndex((r) => r.key === toKey)
      if (fromIdx < 0 || toIdx < 0) return prev
      const next = [...prev]
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return next
    })
    setDirty(true)
  }, [])

  const sortCascade = useCallback(() => {
    setRows((prev) => {
      const scored = prev.map((r) => {
        let firstDay = activeDays.length
        let lastDay = -1
        for (let i = 0; i < activeDays.length; i++) {
          if ((r.pares[activeDays[i]] || 0) > 0) {
            if (firstDay === activeDays.length) firstDay = i
            lastDay = i
          }
        }
        return { row: r, firstDay, lastDay }
      })
      scored.sort((a, b) => {
        if (a.firstDay !== b.firstDay) return a.firstDay - b.firstDay
        if (a.lastDay !== b.lastDay) return a.lastDay - b.lastDay
        return a.row.key.localeCompare(b.row.key)
      })
      return scored.map((s) => s.row)
    })
    setDirty(true)
  }, [activeDays])

  const toggleExpand = useCallback((key: string) => {
    setExpandedModels((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // --- Load plan from DB ---
  const loadPlan = useCallback(async (id: string) => {
    const plan = savedPlans.find((p) => p.id === id)
    if (!plan) return

    const [itemsRes, asignRes] = await Promise.all([
      supabase
        .from('plan_semanal_items')
        .select('modelo_num, color, dia, pares, orden')
        .eq('plan_id', id)
        .order('orden', { ascending: true }),
      supabase
        .from('plan_robot_asignacion')
        .select('modelo_num, fraccion, dia, robot_id, porcentaje')
        .eq('plan_id', id),
    ])
    const items = itemsRes.data
    const asignData = (asignRes.data || []) as { modelo_num: string; fraccion: number; dia: string; robot_id: string; porcentaje: number }[]

    if (!items) return

    // Group items into rows (preservando orden guardado)
    // groupKey interno combina modelo_num+color para detectar filas distintas en DB,
    // pero la key React de cada fila se genera fresca (UUID) para que no cambie
    // al editar el color despues.
    const rowMap = new Map<string, PlanRow & { orden: number }>()
    for (const item of items) {
      const groupKey = `${item.modelo_num}|${item.color || ''}`
      if (!rowMap.has(groupKey)) {
        rowMap.set(groupKey, {
          key: genRowId(),
          modelo_num: item.modelo_num,
          color: item.color || '',
          orden: item.orden ?? 0,
          pares: Object.fromEntries(activeDays.map((d) => [d, 0])) as Record<DayName, number>,
        })
      }
      const row = rowMap.get(groupKey)!
      if (item.dia in row.pares || activeDays.includes(item.dia as DayName)) {
        row.pares[item.dia as DayName] = item.pares
      }
    }

    const ordered = Array.from(rowMap.values())
      .sort((a, b) => a.orden - b.orden)
      .map(({ orden: _orden, ...rest }) => rest)

    // Reconstruir AsignacionesMap (modelo -> fraccion -> dia -> robots[])
    const asignMap: AsignacionesMap = {}
    for (const a of asignData) {
      if (!asignMap[a.modelo_num]) asignMap[a.modelo_num] = {}
      if (!asignMap[a.modelo_num][a.fraccion]) asignMap[a.modelo_num][a.fraccion] = {}
      const byFrac = asignMap[a.modelo_num][a.fraccion]
      const dia = (a.dia ?? 'Lun') as DayName
      if (!byFrac[dia]) byFrac[dia] = []
      byFrac[dia]!.push({ robot_id: a.robot_id, porcentaje: Number(a.porcentaje) })
    }

    setPlanId(id)
    setPlanName(plan.nombre)
    setRows(ordered)
    setAsignaciones(asignMap)
    setExpandedModels(new Set())
    setDirty(false)
  }, [savedPlans, activeDays])

  // --- Save plan to DB ---
  const savePlan = useCallback(async () => {
    if (!planName.trim()) return
    setSaving(true)

    try {
      let id = planId

      if (id) {
        // Update existing
        await supabase
          .from('planes_semanales')
          .update({ nombre: planName, updated_at: new Date().toISOString() })
          .eq('id', id)
        // Delete old items
        await supabase.from('plan_semanal_items').delete().eq('plan_id', id)
      } else {
        // Create new
        const { data } = await supabase
          .from('planes_semanales')
          .insert({ nombre: planName })
          .select('id')
          .single()
        if (!data) throw new Error('Failed to create plan')
        id = data.id
        setPlanId(id)
      }

      // Insert items (only days with pares > 0)
      const items: { plan_id: string; modelo_num: string; color: string; dia: string; pares: number; orden: number }[] = []
      for (const [idx, row] of rows.entries()) {
        for (const d of activeDays) {
          if ((row.pares[d] || 0) > 0) {
            items.push({
              plan_id: id!,
              modelo_num: row.modelo_num,
              color: row.color,
              dia: d,
              pares: row.pares[d],
              orden: idx,
            })
          }
        }
      }

      if (items.length > 0) {
        await supabase.from('plan_semanal_items').insert(items)
      }

      // Guardar asignaciones de robots por dia (replace: borra y reinserta)
      await supabase.from('plan_robot_asignacion').delete().eq('plan_id', id!)
      const asignRows: { plan_id: string; modelo_num: string; fraccion: number; dia: string; robot_id: string; porcentaje: number }[] = []
      for (const [modeloNum, byFraccion] of Object.entries(asignaciones)) {
        for (const [fraccionStr, byDia] of Object.entries(byFraccion)) {
          const fraccion = Number(fraccionStr)
          for (const [dia, list] of Object.entries(byDia ?? {})) {
            for (const a of (list as RobotAssign[])) {
              if (a.porcentaje > 0) {
                asignRows.push({
                  plan_id: id!,
                  modelo_num: modeloNum,
                  fraccion,
                  dia,
                  robot_id: a.robot_id,
                  porcentaje: a.porcentaje,
                })
              }
            }
          }
        }
      }
      if (asignRows.length > 0) {
        await supabase.from('plan_robot_asignacion').insert(asignRows)
      }

      // Refresh plans list
      const { data: plansData } = await supabase
        .from('planes_semanales')
        .select('id, nombre, semana, nota, created_at')
        .order('created_at', { ascending: false })
      if (plansData) setSavedPlans(plansData as PlanHeader[])

      setDirty(false)
    } finally {
      setSaving(false)
    }
  }, [planId, planName, rows, activeDays, asignaciones])

  // --- New plan ---
  const newPlan = useCallback(() => {
    setPlanId(null)
    setPlanName(computeNextPlanName(savedPlans.map((p) => p.nombre)))
    setRows([])
    setAsignaciones({})
    setExpandedModels(new Set())
    setDirty(false)
  }, [savedPlans])

  // --- Delete plan (cascade borra plan_semanal_items) ---
  const deletePlan = useCallback(async () => {
    if (!planId) return
    await supabase.from('planes_semanales').delete().eq('id', planId)
    const { data: plansData } = await supabase
      .from('planes_semanales')
      .select('id, nombre, semana, nota, created_at')
      .order('created_at', { ascending: false })
    const remaining = (plansData || []) as PlanHeader[]
    setSavedPlans(remaining)
    setPlanId(null)
    setPlanName(computeNextPlanName(remaining.map((p) => p.nombre)))
    setRows([])
    setAsignaciones({})
    setExpandedModels(new Set())
    setDirty(false)
  }, [planId])

  // --- Download template ---
  const downloadTemplate = useCallback(async () => {
    const XLSX = await import('xlsx-js-style')

    const HEADER_FILL = { fgColor: { rgb: '1F4E79' } }
    const HEADER_FONT = { color: { rgb: 'FFFFFF' }, bold: true, sz: 11 }
    const HEADER_STYLE = { fill: HEADER_FILL, font: HEADER_FONT, alignment: { horizontal: 'center' as const } }

    const EXAMPLE_FILL = { fgColor: { rgb: 'D9E2F3' } }
    const EXAMPLE_FONT = { color: { rgb: '808080' }, italic: true, sz: 10 }
    const EXAMPLE_STYLE = { fill: EXAMPLE_FILL, font: EXAMPLE_FONT }

    const days = activeDays
    const planData: (string | number | null)[][] = [
      ['Modelo', 'Color', ...days],
      ['62100', 'BL', 600, 0, 0, 0, 0, ...(days.length > 5 ? [0] : [])],
      ['77525', 'NE TEX', 0, 500, 0, 0, 0, ...(days.length > 5 ? [0] : [])],
    ]

    const ws = XLSX.utils.aoa_to_sheet(planData)

    // Style headers (row 1)
    const cols = 2 + days.length
    for (let c = 0; c < cols; c++) {
      const ref = `${String.fromCharCode(65 + c)}1`
      if (ws[ref]) ws[ref].s = HEADER_STYLE
    }

    // Style example rows (rows 2-3)
    for (let r = 2; r <= 3; r++) {
      for (let c = 0; c < cols; c++) {
        const ref = `${String.fromCharCode(65 + c)}${r}`
        if (ws[ref]) ws[ref].s = EXAMPLE_STYLE
      }
    }

    ws['!cols'] = [
      { wch: 14 }, { wch: 12 },
      ...days.map(() => ({ wch: 10 })),
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'PLAN')
    XLSX.writeFile(wb, 'plantilla_plan_semanal.xlsx')
  }, [activeDays])

  // --- Upload template ---
  const uploadTemplate = useCallback(async (file: File) => {
    const XLSX = await import('xlsx')
    const buffer = await file.arrayBuffer()
    const wb = XLSX.read(buffer, { type: 'array' })

    // Find PLAN sheet (or first sheet)
    const sheetName = wb.SheetNames.includes('PLAN') ? 'PLAN' : wb.SheetNames[0]
    const ws = wb.Sheets[sheetName]
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown as unknown[][]

    // Find header row (row with "Modelo" in first cell)
    let headerIdx = -1
    for (let i = 0; i < Math.min(raw.length, 10); i++) {
      const firstCell = String(raw[i]?.[0] || '').trim().toUpperCase()
      if (firstCell === 'MODELO') {
        headerIdx = i
        break
      }
    }
    if (headerIdx < 0) {
      alert('No se encontro la fila de encabezados (columna "Modelo"). Revisa el formato.')
      return
    }

    // Parse header to find day columns
    const headerRow = raw[headerIdx] as string[]
    const dayColMap: { day: DayName; col: number }[] = []
    for (let c = 2; c < headerRow.length; c++) {
      const val = String(headerRow[c] || '').trim()
      const matched = DAY_ORDER.find((d) => d.toLowerCase() === val.toLowerCase())
      if (matched) dayColMap.push({ day: matched, col: c })
    }

    if (dayColMap.length === 0) {
      alert('No se encontraron columnas de dias (Lun, Mar, Mie, etc.) en los encabezados.')
      return
    }

    // Parse data rows
    const newRows: PlanRow[] = []
    const seen = new Set<string>()
    for (let i = headerIdx + 1; i < raw.length; i++) {
      const row = raw[i] as (string | number | null)[]
      if (!row || !row[0]) continue

      const modeloNum = String(row[0]).trim()
      if (!modeloNum || !catalogoMap.has(modeloNum)) continue

      const color = String(row[1] || '').trim()
      const dedupeKey = `${modeloNum}|${color}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)

      const pares = Object.fromEntries(activeDays.map((d) => [d, 0])) as Record<DayName, number>
      for (const { day, col } of dayColMap) {
        const val = Number(row[col] || 0)
        if (val > 0) pares[day] = Math.round(val)
      }

      newRows.push({ key: genRowId(), modelo_num: modeloNum, color, pares })
    }

    if (newRows.length === 0) {
      alert('No se encontraron modelos validos en el archivo. Verifica que los modelos existan en el catalogo.')
      return
    }

    // Extract plan name from filename
    const fname = file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ')
    setPlanId(null)
    setPlanName(fname)
    setRows(newRows)
    setExpandedModels(new Set())
    setDirty(true)
  }, [catalogoMap, activeDays])

  // --- Computed: hours per fraction ---
  const hoursData = useMemo(() => {
    const result: {
      key: string
      modelo_num: string
      color: string
      totalPares: number
      ops: {
        fraccion: number
        operacion: string
        etapa: string
        rate: number
        hours: Record<DayName, number>
        totalHrs: number
      }[]
      totalHrs: number
      hrsByEtapa: Record<string, number>
    }[] = []

    for (const row of rows) {
      const cat = catalogoMap.get(row.modelo_num)
      if (!cat) continue

      const totalPares = activeDays.reduce((s, d) => s + (row.pares[d] || 0), 0)
      if (totalPares === 0) continue

      const ops = cat.operaciones.map((op) => {
        const hours: Record<DayName, number> = {} as Record<DayName, number>
        let totalHrs = 0
        for (const d of activeDays) {
          const p = row.pares[d] || 0
          const h = op.rate > 0 ? p / op.rate : 0
          hours[d] = h
          totalHrs += h
        }
        return {
          fraccion: op.fraccion,
          operacion: op.operacion,
          etapa: etapaShort(op.input_o_proceso),
          rate: op.rate,
          hours,
          totalHrs,
        }
      })

      const hrsByEtapa: Record<string, number> = {}
      for (const op of ops) {
        hrsByEtapa[op.etapa] = (hrsByEtapa[op.etapa] || 0) + op.totalHrs
      }

      result.push({
        key: row.key,
        modelo_num: row.modelo_num,
        color: row.color,
        totalPares,
        ops,
        totalHrs: ops.reduce((s, o) => s + o.totalHrs, 0),
        hrsByEtapa,
      })
    }
    return result
  }, [rows, catalogoMap, activeDays])

  // --- Global summaries ---
  const globalSummary = useMemo(() => {
    let totalHrs = 0
    let totalPares = 0
    const hrsByEtapa: Record<string, number> = {}
    const hrsByDay: Record<DayName, number> = {} as Record<DayName, number>
    const opsByEtapa: Record<string, number> = {}
    for (const d of activeDays) hrsByDay[d] = 0

    const hrsByEtapaByDay: Record<string, Record<DayName, number>> = {}

    for (const m of hoursData) {
      totalHrs += m.totalHrs
      totalPares += m.totalPares
      for (const op of m.ops) {
        hrsByEtapa[op.etapa] = (hrsByEtapa[op.etapa] || 0) + op.totalHrs
        opsByEtapa[op.etapa] = (opsByEtapa[op.etapa] || 0) + 1
        if (!hrsByEtapaByDay[op.etapa]) {
          hrsByEtapaByDay[op.etapa] = Object.fromEntries(activeDays.map((d) => [d, 0])) as Record<DayName, number>
        }
        for (const d of activeDays) {
          hrsByDay[d] += op.hours[d] || 0
          hrsByEtapaByDay[op.etapa][d] += op.hours[d] || 0
        }
      }
    }
    return { totalHrs, totalPares, hrsByEtapa, hrsByDay, opsByEtapa, hrsByEtapaByDay }
  }, [hoursData, activeDays])

  // --- Robot load: lista de ops ROBOT por modelo en el plan + horas (total + por dia) ---
  const robotOpsByRow = useMemo(() => {
    const result: { rowKey: string; modelo_num: string; color: string; daysWithProd: DayName[]; ops: { fraccion: number; operacion: string; rate: number; totalHrs: number; hoursByDay: Partial<Record<DayName, number>> }[] }[] = []
    for (const row of rows) {
      const cat = catalogoMap.get(row.modelo_num)
      if (!cat) continue
      const daysWithProd = activeDays.filter((d) => (row.pares[d] || 0) > 0)
      const totalPares = daysWithProd.reduce((s, d) => s + (row.pares[d] || 0), 0)
      if (totalPares === 0) continue
      const robotOps: { fraccion: number; operacion: string; rate: number; totalHrs: number; hoursByDay: Partial<Record<DayName, number>> }[] = []
      for (const op of cat.operaciones) {
        const recs = op.recurso.split(',').map((s) => s.trim())
        if (!recs.includes('ROBOT')) continue
        const hoursByDay: Partial<Record<DayName, number>> = {}
        let totalHrs = 0
        for (const d of daysWithProd) {
          const h = op.rate > 0 ? (row.pares[d] || 0) / op.rate : 0
          hoursByDay[d] = h
          totalHrs += h
        }
        robotOps.push({ fraccion: op.fraccion, operacion: op.operacion, rate: op.rate, totalHrs, hoursByDay })
      }
      if (robotOps.length > 0) {
        result.push({ rowKey: row.key, modelo_num: row.modelo_num, color: row.color, daysWithProd, ops: robotOps })
      }
    }
    return result
  }, [rows, catalogoMap, activeDays])

  // --- Vista day-first para asignacion: por dia -> lista de modelos con fracciones robot ---
  const robotOpsByDay = useMemo(() => {
    type DayModelOp = { fraccion: number; operacion: string; rate: number; hoursDia: number }
    type DayModel = { rowKey: string; modelo_num: string; color: string; paresDia: number; ops: DayModelOp[] }
    const result: { dia: DayName; models: DayModel[] }[] = []
    for (const d of activeDays) {
      const models: DayModel[] = []
      for (const row of rows) {
        const paresDia = row.pares[d] || 0
        if (paresDia <= 0) continue
        const cat = catalogoMap.get(row.modelo_num)
        if (!cat) continue
        const ops: DayModelOp[] = []
        for (const op of cat.operaciones) {
          const recs = op.recurso.split(',').map((s) => s.trim())
          if (!recs.includes('ROBOT')) continue
          const hoursDia = op.rate > 0 ? paresDia / op.rate : 0
          ops.push({ fraccion: op.fraccion, operacion: op.operacion, rate: op.rate, hoursDia })
        }
        if (ops.length > 0) {
          models.push({ rowKey: row.key, modelo_num: row.modelo_num, color: row.color, paresDia, ops })
        }
      }
      if (models.length > 0) result.push({ dia: d, models })
    }
    return result
  }, [rows, catalogoMap, activeDays])

  // --- Carga total por robot (suma horas-por-dia ponderadas por porcentaje del robot ese dia) ---
  const loadByRobot = useMemo(() => {
    const byRobot = new Map<string, { totalHrs: number; byModel: Map<string, number> }>()
    for (const group of robotOpsByRow) {
      const modelKey = group.color ? `${group.modelo_num} ${group.color}` : group.modelo_num
      for (const op of group.ops) {
        const byDia = asignaciones[group.modelo_num]?.[op.fraccion] ?? {}
        for (const dia of group.daysWithProd) {
          const assignsDia = byDia[dia] ?? []
          const hrsDia = op.hoursByDay[dia] ?? 0
          for (const a of assignsDia) {
            const hrs = hrsDia * (a.porcentaje / 100)
            if (!byRobot.has(a.robot_id)) byRobot.set(a.robot_id, { totalHrs: 0, byModel: new Map() })
            const bucket = byRobot.get(a.robot_id)!
            bucket.totalHrs += hrs
            bucket.byModel.set(modelKey, (bucket.byModel.get(modelKey) ?? 0) + hrs)
          }
        }
      }
    }
    return byRobot
  }, [robotOpsByRow, asignaciones])

  const ROBOT_WEEKLY_CAPACITY = 50 // horas por robot por semana (L-V 540min + Sab 300min)

  // --- Model selector state ---
  const [selectorOpen, setSelectorOpen] = useState(false)
  const [selectorSearch, setSelectorSearch] = useState('')

  const filteredCatalog = useMemo(() => {
    const q = selectorSearch.toLowerCase()
    return catalogo.filter((c) => c.modelo_num.toLowerCase().includes(q))
  }, [catalogo, selectorSearch])

  // --- Export to Excel ---
  const exportExcel = useCallback(async () => {
    const XLSX = await import('xlsx-js-style')
    const wsData: (string | number | null)[][] = []

    wsData.push([
      `HORAS POR FRACCION${planName ? ' — ' + planName : ''}`,
      null, null, null, ...activeDays.map(() => null), null,
    ])
    wsData.push([
      'Calculo: horas = pares_dia / rate(par/hr)',
      null, null, null, ...activeDays.map(() => null), null,
    ])
    wsData.push([
      'TOTAL HRS', ...ETAPA_ORDER.map((e) => globalSummary.hrsByEtapa[e] ? e : null).filter(Boolean) as string[], 'PARES',
      null, null, null, null, null,
    ])
    wsData.push([
      Math.round(globalSummary.totalHrs * 100) / 100,
      ...ETAPA_ORDER.filter((e) => globalSummary.hrsByEtapa[e]).map((e) => Math.round((globalSummary.hrsByEtapa[e] || 0) * 100) / 100),
      globalSummary.totalPares,
      null, null, null, null, null,
    ])
    wsData.push(['Modelo', 'Operacion / Fraccion', 'Etapa', 'Rate\npar/hr', ...activeDays, 'Total hrs'])

    for (const m of hoursData) {
      const label = m.color ? `${m.modelo_num} ${m.color}` : m.modelo_num
      wsData.push([
        label, null, `${m.totalPares} par`, null,
        ...activeDays.map((d) => {
          const dayHrs = m.ops.reduce((s, op) => s + (op.hours[d] || 0), 0)
          return Math.round(dayHrs * 100) / 100
        }),
        Math.round(m.totalHrs * 100) / 100,
      ])
      for (const op of m.ops) {
        wsData.push([
          String(op.fraccion), op.operacion, op.etapa, op.rate,
          ...activeDays.map((d) => Math.round((op.hours[d] || 0) * 100) / 100),
          Math.round(op.totalHrs * 100) / 100,
        ])
      }
    }

    wsData.push([
      'TOTAL SEMANA', null, null, null,
      ...activeDays.map((d) => Math.round((globalSummary.hrsByDay[d] || 0) * 100) / 100),
      Math.round(globalSummary.totalHrs * 100) / 100,
    ])
    wsData.push(['RESUMEN POR ETAPA'])
    for (const e of ETAPA_ORDER) {
      if (!globalSummary.hrsByEtapa[e]) continue
      wsData.push([
        e, `${globalSummary.opsByEtapa[e] || 0} operaciones`, null, null,
        ...activeDays.map(() => null), Math.round((globalSummary.hrsByEtapa[e] || 0) * 100) / 100,
      ])
    }

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(wsData)
    ws['!cols'] = [
      { wch: 18 }, { wch: 35 }, { wch: 8 }, { wch: 8 },
      ...activeDays.map(() => ({ wch: 10 })),
      { wch: 10 },
    ]
    XLSX.utils.book_append_sheet(wb, ws, planName || 'Planeacion')
    XLSX.writeFile(wb, `horas_fracciones_${(planName || 'plan').replace(/\s+/g, '_')}.xlsx`)
  }, [hoursData, globalSummary, activeDays, planName])

  // --- Generar escenario: corre daily scheduling + operarios desde el plan ---
  const handleGenerarEscenario = useCallback(async () => {
    const baseName = planName.trim()
    if (!baseName) {
      alert('Ponle nombre al plan antes de generar el escenario.')
      return
    }
    const plan = rows
      .map((r) => ({
        modelo: r.modelo_num,
        color: r.color || '',
        fabrica: '',
        dias: Object.fromEntries(
          activeDays.map((d) => [d, r.pares[d] || 0]),
        ) as Record<string, number>,
      }))
      .filter((p) => Object.values(p.dias).some((v) => v > 0))

    if (plan.length === 0) {
      alert('El plan no tiene celdas con pares > 0.')
      return
    }

    const baseSlug = baseName.replace(/\s+/g, '_')
    setGenerating(true)
    try {
      const res = await generateFromPlan({
        base_name: baseSlug,
        plan,
        nota: `Escenario desde Planeacion: ${baseName}`,
      })
      // Cargar el resultado guardado al store para que /resumen y /programa lo vean
      const { data, error } = await supabase
        .from('resultados')
        .select('*')
        .eq('nombre', res.saved_as)
        .single()
      if (error || !data) {
        throw new Error(error?.message || 'No se pudo cargar el resultado guardado')
      }
      useAppStore.getState().setCurrentResult(data as Resultado)
      router.push('/resumen')
    } catch (e) {
      console.error('[generateFromPlan] error', e)
      alert(`No se pudo generar el escenario: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setGenerating(false)
    }
  }, [planName, rows, activeDays, router])

  // --- Render ---
  if (loadingCat) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Title */}
      <div>
        <h1 className="text-xl font-bold">Planeador de tiempos por proceso</h1>
        <p className="text-sm text-muted-foreground">
          Asigna pares por modelo y dia para ver las horas requeridas por fraccion
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'editor' | 'comparativo' | 'referencia')}>
        <TabsList>
          <TabsTrigger value="editor">Editor</TabsTrigger>
          <TabsTrigger value="comparativo">Comparativo</TabsTrigger>
          <TabsTrigger value="referencia">Referencia</TabsTrigger>
        </TabsList>

        <TabsContent value="editor" className="space-y-6 mt-4">
      {/* Editor controls */}
      <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Plan selector */}
          {savedPlans.length > 0 && (
            <Select
              value={planId ?? ''}
              onValueChange={(v) => {
                if (v === '__new__') newPlan()
                else loadPlan(v)
              }}
            >
              <SelectTrigger className="w-52">
                <FolderOpen className="h-4 w-4 mr-1 shrink-0" />
                <SelectValue placeholder="Cargar plan..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__new__">+ Nuevo plan</SelectItem>
                {savedPlans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Input
            placeholder="Nombre del plan (ej. SEM17)"
            value={planName}
            onChange={(e) => { setPlanName(e.target.value); setDirty(true) }}
            className="w-56"
          />
          {planId && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setDeleteStep1(true)}
              title="Eliminar plan cargado"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant={dirty ? 'default' : 'outline'}
            size="sm"
            onClick={savePlan}
            disabled={saving || !planName.trim() || rows.length === 0}
          >
            <Save className="h-4 w-4 mr-1" />
            {saving ? 'Guardando...' : 'Guardar'}
          </Button>
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <FileSpreadsheet className="h-4 w-4 mr-1" />
            Plantilla
          </Button>
          <label className="inline-flex items-center gap-1 cursor-pointer text-sm font-medium rounded-md border border-input bg-background px-3 h-8 hover:bg-accent hover:text-accent-foreground transition-colors">
            <Upload className="h-4 w-4" />
            Importar
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) uploadTemplate(f)
                e.target.value = ''
              }}
            />
          </label>
          <Button
            variant="outline"
            size="sm"
            onClick={exportExcel}
            disabled={hoursData.length === 0}
          >
            <Download className="h-4 w-4 mr-1" />
            Excel
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleGenerarEscenario}
            disabled={generating || rows.length === 0 || !planName.trim()}
            title="Genera programa diario y resumen semanal a partir de este plan"
          >
            <Workflow className="h-4 w-4 mr-1" />
            {generating ? 'Generando...' : 'Generar escenario'}
          </Button>
      </div>

      {/* KPI cards */}
      {hoursData.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <KpiCard label="Total Horas" value={globalSummary.totalHrs.toFixed(1)} />
          <KpiCard label="Total Pares" value={globalSummary.totalPares.toLocaleString()} />
          {ETAPA_ORDER.map((e) =>
            globalSummary.hrsByEtapa[e] ? (
              <KpiCard
                key={e}
                label={e}
                value={globalSummary.hrsByEtapa[e].toFixed(1) + ' hrs'}
              />
            ) : null,
          )}
        </div>
      )}

      {/* --- PLANNING TABLE --- */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              Plan Semanal
            </h2>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={sortCascade}
                disabled={rows.length < 2}
                title="Ordenar filas en cascada (por primer dia con pares)"
              >
                <Workflow className="h-4 w-4 mr-1" />
                Ordenar en cascada
              </Button>
              <div className="relative">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectorOpen(!selectorOpen)}
              >
                <Plus className="h-4 w-4 mr-1" />
                Agregar Modelo
              </Button>
              {selectorOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-popover border rounded-lg shadow-lg p-3 space-y-2">
                  <Input
                    placeholder="Buscar modelo..."
                    value={selectorSearch}
                    onChange={(e) => setSelectorSearch(e.target.value)}
                    autoFocus
                  />
                  <div className="max-h-60 overflow-y-auto space-y-1">
                    {filteredCatalog.map((c) => {
                      const { canAdd, nextColor } = modelAvailability(c)
                      const hasAlts = (c.alternativas?.length ?? 0) > 0
                      const used = usedColorsByModel.get(c.modelo_num)?.size ?? 0
                      return (
                        <button
                          key={c.modelo_num}
                          disabled={!canAdd}
                          onClick={() => {
                            addModel(c.modelo_num)
                            setSelectorOpen(false)
                            setSelectorSearch('')
                          }}
                          className={cn(
                            'w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2',
                            !canAdd
                              ? 'text-muted-foreground/40 cursor-not-allowed'
                              : 'hover:bg-accent',
                          )}
                        >
                          <ModeloImg
                            images={images}
                            modeloNum={c.modelo_num}
                            color={nextColor || undefined}
                            className="h-7 w-7 rounded border object-cover bg-white shrink-0"
                          />
                          <span className="flex-1">{c.modelo_num}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {hasAlts
                              ? `${used}/${c.alternativas.length} alt${canAdd ? '' : ' (todas usadas)'}`
                              : used > 0
                                ? '(ya agregado)'
                                : ''}
                          </span>
                        </button>
                      )
                    })}
                    {filteredCatalog.length === 0 && (
                      <p className="text-xs text-muted-foreground px-2 py-3">Sin resultados</p>
                    )}
                  </div>
                </div>
              )}
              </div>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p>Agrega modelos del catalogo para comenzar a planear</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2 min-w-[160px]">Modelo</th>
                    {activeDays.map((d) => (
                      <th key={d} className="text-center py-2 px-2 min-w-[80px]">{d}</th>
                    ))}
                    <th className="text-center py-2 px-2 min-w-[80px]">Total</th>
                    <th className="text-center py-2 px-2 min-w-[90px]">Hrs</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const hd = hoursData.find((h) => h.key === row.key)
                    const rowTotal = activeDays.reduce((s, d) => s + (row.pares[d] || 0), 0)
                    const isDragging = dragKey === row.key
                    const isDragOver = dragOverKey === row.key && dragKey !== row.key
                    const cat = catalogoMap.get(row.modelo_num)
                    const hasAlts = (cat?.alternativas?.length ?? 0) > 0
                    return (
                      <tr
                        key={row.key}
                        onDragOver={(e) => {
                          if (dragKey && dragKey !== row.key) {
                            e.preventDefault()
                            setDragOverKey(row.key)
                          }
                        }}
                        onDragLeave={() => {
                          if (dragOverKey === row.key) setDragOverKey(null)
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          if (dragKey && dragKey !== row.key) moveRow(dragKey, row.key)
                          setDragKey(null)
                          setDragOverKey(null)
                        }}
                        className={cn(
                          'border-b transition-colors',
                          isDragging ? 'opacity-40' : 'hover:bg-muted/30',
                          isDragOver && 'bg-primary/10 ring-1 ring-inset ring-primary/50',
                        )}
                      >
                        <td className="py-1.5 px-2 font-medium">
                          <div className="flex items-center gap-1.5">
                            <span
                              draggable
                              onDragStart={(e) => {
                                setDragKey(row.key)
                                e.dataTransfer.effectAllowed = 'move'
                              }}
                              onDragEnd={() => { setDragKey(null); setDragOverKey(null) }}
                              className="cursor-grab active:cursor-grabbing text-muted-foreground/60 hover:text-foreground"
                              title="Arrastra para reordenar"
                            >
                              <GripVertical className="h-3.5 w-3.5" />
                            </span>
                            <ModeloImg
                              images={images}
                              modeloNum={row.modelo_num}
                              color={row.color || undefined}
                              className="h-8 w-8 rounded border object-cover bg-white shrink-0"
                            />
                            <span>{row.modelo_num}</span>
                            {hasAlts ? (
                              <Select value={row.color || '__none__'} onValueChange={(v) => updateColor(row.key, v === '__none__' ? '' : v)}>
                                <SelectTrigger className="h-6 w-20 text-xs px-2">
                                  <SelectValue placeholder="color" />
                                </SelectTrigger>
                                <SelectContent>
                                  {cat!.alternativas.map((a) => {
                                    const usedByOther = rows.some(
                                      (r) => r.key !== row.key && r.modelo_num === row.modelo_num && r.color === a,
                                    )
                                    return (
                                      <SelectItem key={a} value={a} disabled={usedByOther}>
                                        {a}{usedByOther ? ' (ocupado)' : ''}
                                      </SelectItem>
                                    )
                                  })}
                                </SelectContent>
                              </Select>
                            ) : row.color ? (
                              <span className="text-xs text-muted-foreground">{row.color}</span>
                            ) : null}
                          </div>
                        </td>
                        {activeDays.map((d) => (
                          <td key={d} className="py-1.5 px-1 text-center">
                            <Input
                              type="number"
                              min={0}
                              step={50}
                              value={row.pares[d] || ''}
                              onChange={(e) =>
                                updatePares(row.key, d, Math.max(0, Number(e.target.value) || 0))
                              }
                              className="h-7 w-20 text-center text-sm mx-auto [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                          </td>
                        ))}
                        <td className="py-1.5 px-2 text-center font-semibold">
                          {rowTotal > 0 ? rowTotal.toLocaleString() : '-'}
                        </td>
                        <td className="py-1.5 px-2 text-center text-muted-foreground">
                          {hd ? hd.totalHrs.toFixed(1) : '-'}
                        </td>
                        <td className="py-1.5 px-1">
                          <button
                            onClick={() => removeRow(row.key)}
                            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  <tr className="bg-muted/50 font-semibold">
                    <td className="py-2 px-2">TOTAL</td>
                    {activeDays.map((d) => {
                      const dayTotal = rows.reduce((s, r) => s + (r.pares[d] || 0), 0)
                      return (
                        <td key={d} className="py-2 px-2 text-center">
                          {dayTotal > 0 ? dayTotal.toLocaleString() : '-'}
                        </td>
                      )
                    })}
                    <td className="py-2 px-2 text-center">
                      {globalSummary.totalPares > 0 ? globalSummary.totalPares.toLocaleString() : '-'}
                    </td>
                    <td className="py-2 px-2 text-center">
                      {globalSummary.totalHrs > 0 ? globalSummary.totalHrs.toFixed(1) : '-'}
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* --- HOURS DETAIL TABLE --- */}
      {hoursData.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Horas por Fraccion
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  // Expand/collapse all
                  if (expandedModels.size === hoursData.length) {
                    setExpandedModels(new Set())
                  } else {
                    setExpandedModels(new Set(hoursData.map((h) => h.key)))
                  }
                }}
              >
                {expandedModels.size === hoursData.length ? 'Colapsar todo' : 'Expandir todo'}
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2 min-w-[160px]">Modelo</th>
                    <th className="text-left py-2 px-2 min-w-[220px]">Operacion / Fraccion</th>
                    <th className="text-center py-2 px-2 w-16">Etapa</th>
                    <th className="text-center py-2 px-2 w-16">Rate</th>
                    {activeDays.map((d) => (
                      <th key={d} className="text-center py-2 px-2 min-w-[70px]">{d}</th>
                    ))}
                    <th className="text-center py-2 px-2 min-w-[80px]">Total hrs</th>
                  </tr>
                </thead>
                <tbody>
                  {hoursData.map((m) => {
                    const isExpanded = expandedModels.has(m.key)
                    const label = m.color ? `${m.modelo_num} ${m.color}` : m.modelo_num
                    return (
                      <Fragment key={m.key}>
                        <tr
                          className="bg-muted/40 cursor-pointer hover:bg-muted/60 border-b"
                          onClick={() => toggleExpand(m.key)}
                        >
                          <td className="py-2 px-2 font-semibold flex items-center gap-1">
                            {isExpanded
                              ? <ChevronDown className="h-3.5 w-3.5" />
                              : <ChevronRight className="h-3.5 w-3.5" />}
                            {label}
                          </td>
                          <td className="py-2 px-2 text-muted-foreground text-xs">
                            {m.ops.length} ops
                          </td>
                          <td className="py-2 px-2 text-center text-xs text-muted-foreground">
                            {m.totalPares.toLocaleString()} par
                          </td>
                          <td />
                          {activeDays.map((d) => {
                            const dayHrs = m.ops.reduce((s, op) => s + (op.hours[d] || 0), 0)
                            return (
                              <td key={d} className="py-2 px-2 text-center font-medium">
                                {dayHrs > 0 ? dayHrs.toFixed(1) : '-'}
                              </td>
                            )
                          })}
                          <td className="py-2 px-2 text-center font-bold">
                            {m.totalHrs.toFixed(1)}
                          </td>
                        </tr>
                        {isExpanded &&
                          m.ops.map((op) => (
                            <tr key={`${m.key}-${op.fraccion}`} className="border-b border-border/50 hover:bg-muted/20">
                              <td className="py-1 px-2 pl-8 text-muted-foreground text-xs">
                                {op.fraccion}
                              </td>
                              <td className="py-1 px-2 text-xs">{op.operacion}</td>
                              <td className="py-1 px-2 text-center">
                                <Badge
                                  variant="outline"
                                  className="text-[10px] px-1.5 py-0"
                                  style={{
                                    borderColor: etapaColor(op.etapa),
                                    color: etapaColor(op.etapa),
                                  }}
                                >
                                  {op.etapa}
                                </Badge>
                              </td>
                              <td className="py-1 px-2 text-center text-xs text-muted-foreground">
                                {op.rate}
                              </td>
                              {activeDays.map((d) => (
                                <td
                                  key={d}
                                  className="py-1 px-2 text-center text-xs"
                                  style={op.hours[d] > 0 ? {
                                    backgroundColor: etapaColor(op.etapa) + '18',
                                    color: etapaColor(op.etapa),
                                    fontWeight: 500,
                                  } : undefined}
                                >
                                  {op.hours[d] > 0 ? op.hours[d].toFixed(2) : '-'}
                                </td>
                              ))}
                              <td
                                className="py-1 px-2 text-center text-xs font-medium"
                                style={{
                                  backgroundColor: etapaColor(op.etapa) + '18',
                                  color: etapaColor(op.etapa),
                                }}
                              >
                                {op.totalHrs.toFixed(2)}
                              </td>
                            </tr>
                          ))}
                      </Fragment>
                    )
                  })}

                  <tr className="bg-muted/50 font-semibold border-t-2">
                    <td className="py-2 px-2">TOTAL SEMANA</td>
                    <td />
                    <td />
                    <td />
                    {activeDays.map((d) => (
                      <td key={d} className="py-2 px-2 text-center">
                        {globalSummary.hrsByDay[d]?.toFixed(1) || '-'}
                      </td>
                    ))}
                    <td className="py-2 px-2 text-center font-bold">
                      {globalSummary.totalHrs.toFixed(1)}
                    </td>
                  </tr>

                  {/* Etapa breakdown by day */}
                  {ETAPA_ORDER.map((e) => {
                    const dayData = globalSummary.hrsByEtapaByDay[e]
                    if (!dayData) return null
                    const totalEtapa = globalSummary.hrsByEtapa[e] || 0
                    const opsCount = globalSummary.opsByEtapa[e] || 0
                    const color = etapaColor(e)
                    return (
                      <tr key={`etapa-${e}`} className="border-b border-border/30">
                        <td
                          className="py-1.5 px-2 text-xs font-bold"
                          style={{ color }}
                        >
                          {e}
                        </td>
                        <td className="py-1.5 px-2 text-xs text-muted-foreground">
                          {opsCount} ops
                        </td>
                        <td />
                        <td />
                        {activeDays.map((d) => (
                          <td
                            key={d}
                            className="py-1.5 px-2 text-center text-xs font-medium"
                            style={dayData[d] > 0 ? {
                              backgroundColor: color + '18',
                              color,
                            } : undefined}
                          >
                            {dayData[d] > 0 ? dayData[d].toFixed(1) : '-'}
                          </td>
                        ))}
                        <td
                          className="py-1.5 px-2 text-center text-xs font-bold"
                          style={{ backgroundColor: color + '18', color }}
                        >
                          {totalEtapa.toFixed(1)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Etapa summary */}
            <div className="mt-4 pt-4 border-t">
              <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
                Resumen por Etapa
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                {ETAPA_ORDER.map((e) => {
                  const hrs = globalSummary.hrsByEtapa[e]
                  if (!hrs) return null
                  const ops = globalSummary.opsByEtapa[e] || 0
                  return (
                    <div
                      key={e}
                      className="rounded-lg border p-3 text-center"
                      style={{ borderColor: etapaColor(e) }}
                    >
                      <div
                        className="text-xs font-bold uppercase"
                        style={{ color: etapaColor(e) }}
                      >
                        {e}
                      </div>
                      <div className="text-lg font-bold mt-1">{hrs.toFixed(1)} hrs</div>
                      <div className="text-xs text-muted-foreground">{ops} operaciones</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* --- ASIGNACION DE ROBOTS (day-first) --- */}
      {robotOpsByDay.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <Bot className="h-4 w-4" />
                Asignacion de Robots
              </h2>
              <span className="text-xs text-muted-foreground">
                Una tarjeta por dia. Asigna los robots reales por modelo y, si se divide, ajusta %.
              </span>
            </div>
            <div className="space-y-4">
              {robotOpsByDay.map((dayGroup) => {
                const totalParesDia = dayGroup.models.reduce((s, m) => s + m.paresDia, 0)
                const totalHrsDia = dayGroup.models.reduce(
                  (s, m) => s + m.ops.reduce((s2, op) => s2 + op.hoursDia, 0),
                  0,
                )
                return (
                  <div key={dayGroup.dia} className="rounded-md border overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border-b">
                      <Badge variant="default" className="text-xs">{dayGroup.dia}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {dayGroup.models.length} modelo{dayGroup.models.length !== 1 ? 's' : ''} · {totalParesDia.toLocaleString()} pares · {totalHrsDia.toFixed(1)} hrs robot
                      </span>
                    </div>
                    <div className="divide-y">
                      {dayGroup.models.map((m) => {
                        const modelLabel = m.color ? `${m.modelo_num} ${m.color}` : m.modelo_num
                        return (
                          <div key={`${dayGroup.dia}_${m.rowKey}`}>
                            <div className="flex items-center gap-2 px-3 py-2 bg-muted/20">
                              <ModeloImg
                                images={images}
                                modeloNum={m.modelo_num}
                                color={m.color || undefined}
                                className="h-7 w-7 rounded border object-cover bg-white shrink-0"
                              />
                              <span className="font-medium text-sm">{modelLabel}</span>
                              <Badge variant="secondary" className="text-xs ml-1">
                                {m.paresDia.toLocaleString()} pares
                              </Badge>
                              <span className="text-xs text-muted-foreground ml-2">
                                {m.ops.length} op{m.ops.length !== 1 ? 's' : ''} robot
                              </span>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead className="bg-muted/10">
                                  <tr className="border-b text-muted-foreground">
                                    <th className="text-left px-3 py-1.5 w-12">Frac</th>
                                    <th className="text-left px-3 py-1.5">Operacion</th>
                                    <th className="text-right px-3 py-1.5 w-20">Rate</th>
                                    <th className="text-right px-3 py-1.5 w-20">Horas</th>
                                    <th className="text-left px-3 py-1.5">Robots asignados</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {m.ops.map((op) => (
                                    <RobotAssignRow
                                      key={op.fraccion}
                                      modeloNum={m.modelo_num}
                                      fraccion={op.fraccion}
                                      operacion={op.operacion}
                                      rate={op.rate}
                                      totalHrs={op.hoursDia}
                                      assigns={asignaciones[m.modelo_num]?.[op.fraccion]?.[dayGroup.dia] ?? []}
                                      robots={robots}
                                      programaForOp={programaMatriz[m.modelo_num]?.[op.fraccion]}
                                      onToggle={(robotId) => toggleRobotAssign(m.modelo_num, op.fraccion, dayGroup.dia, robotId)}
                                      onSetPercent={(robotId, pct) => setAssignPercent(m.modelo_num, op.fraccion, dayGroup.dia, robotId, pct)}
                                    />
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* --- CARGA POR ROBOT --- */}
      {loadByRobot.size > 0 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Bot className="h-4 w-4" />
              Carga por Robot
              <span className="text-xs text-muted-foreground font-normal ml-2">
                Capacidad semanal ~{ROBOT_WEEKLY_CAPACITY}h
              </span>
            </h2>
            <RobotLoadChart
              loadByRobot={loadByRobot}
              robots={robots}
              capacity={ROBOT_WEEKLY_CAPACITY}
            />
          </CardContent>
        </Card>
      )}
        </TabsContent>

        <TabsContent value="comparativo" className="mt-4">
          <ComparativoTab />
        </TabsContent>

        <TabsContent value="referencia" className="mt-4">
          <ReferenciaTab />
        </TabsContent>
      </Tabs>

      {/* Eliminar plan — doble confirmacion */}
      <ConfirmDialog
        open={deleteStep1}
        onOpenChange={setDeleteStep1}
        title={`Eliminar plan "${planName}"`}
        description="Se eliminara el plan y todos sus items. Esta accion no se puede deshacer."
        simple
        onConfirm={() => { setDeleteStep2(true) }}
      />
      <ConfirmDialog
        open={deleteStep2}
        onOpenChange={setDeleteStep2}
        title="Confirmacion final"
        description={`Para eliminar definitivamente "${planName}", escribe ELIMINAR abajo.`}
        confirmWord="ELIMINAR"
        onConfirm={deletePlan}
      />
    </div>
  )
}

// ─── Sub-componentes ──────────────────────────────────────────────────────

function RobotAssignRow({
  fraccion, operacion, rate, totalHrs, assigns, robots, programaForOp, onToggle, onSetPercent,
}: {
  modeloNum: string
  fraccion: number
  operacion: string
  rate: number
  totalHrs: number
  assigns: RobotAssign[]
  robots: RobotLite[]
  /** robot_id -> estado para esta (modelo, fraccion). undefined = sin matriz */
  programaForOp: Record<string, ProgramaEstado> | undefined
  onToggle: (robotId: string) => void
  onSetPercent: (robotId: string, pct: number) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pickerOpen) return
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [pickerOpen])

  const robotsByID = useMemo(() => new Map(robots.map((r) => [r.id, r])), [robots])
  const selectedIds = new Set(assigns.map((a) => a.robot_id))
  const hasMatriz = programaForOp !== undefined

  // Si hay matriz: solo se muestran robots con TIENE o FALTA para esta (modelo, fraccion)
  // Si no hay matriz: todos los robots como fallback
  // Prioridad: TIENE -> FALTA -> (sin info solo en fallback). Activos antes que fuera de servicio.
  const available = useMemo(() => {
    const q = search.toLowerCase()
    const filter = (r: RobotLite) => {
      if (selectedIds.has(r.id)) return false
      if (!r.nombre.toLowerCase().includes(q)) return false
      if (hasMatriz) return !!programaForOp![r.id]
      return true
    }
    const rank = (r: RobotLite) => {
      const estadoPrograma = programaForOp?.[r.id]
      const activo = r.estado === 'ACTIVO'
      let score = 0
      if (estadoPrograma === 'TIENE') score -= 100
      else if (estadoPrograma === 'FALTA') score -= 50
      if (!activo) score += 10
      return score
    }
    return robots.filter(filter).sort((a, b) => {
      const diff = rank(a) - rank(b)
      if (diff !== 0) return diff
      return a.nombre.localeCompare(b.nombre)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [robots, assigns, search, programaForOp])

  return (
    <tr className="border-b hover:bg-muted/10 align-top">
      <td className="px-3 py-1.5 font-mono text-muted-foreground">F{fraccion}</td>
      <td className="px-3 py-1.5 truncate" title={operacion}>{operacion}</td>
      <td className="px-3 py-1.5 text-right text-muted-foreground font-mono">{rate}</td>
      <td className="px-3 py-1.5 text-right text-muted-foreground">{totalHrs.toFixed(1)}</td>
      <td className="px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {assigns.length === 0 && (
            <span className="text-muted-foreground italic">Sin asignar</span>
          )}
          {assigns.map((a) => {
            const r = robotsByID.get(a.robot_id)
            const estadoPrograma = programaForOp?.[a.robot_id]
            const activo = r ? r.estado === 'ACTIVO' : true
            const warnings: string[] = []
            if (!activo) warnings.push('fuera de servicio')
            if (estadoPrograma === 'FALTA') warnings.push('programa no cargado')
            const hasWarn = warnings.length > 0
            return (
              <div
                key={a.robot_id}
                className={cn(
                  'inline-flex items-center gap-1 border rounded-md px-1.5 py-0.5',
                  hasWarn ? 'border-yellow-500/50 bg-yellow-500/10' : 'bg-muted/30',
                )}
                title={hasWarn ? warnings.join(' · ') : undefined}
              >
                <span className={cn('font-medium', !activo && 'line-through opacity-70')}>
                  {r?.nombre ?? a.robot_id.slice(0, 6)}
                </span>
                {estadoPrograma === 'FALTA' && (
                  <span className="text-[9px] font-bold text-yellow-500">!</span>
                )}
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={a.porcentaje}
                  onChange={(e) => onSetPercent(a.robot_id, Number(e.target.value) || 0)}
                  className="h-6 w-14 text-xs px-1 text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-muted-foreground">%</span>
                <button
                  type="button"
                  onClick={() => onToggle(a.robot_id)}
                  className="rounded-full hover:bg-destructive/20 p-0.5"
                  title="Quitar"
                >
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              </div>
            )
          })}
          <div className="relative" ref={pickerRef}>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 text-[10px] px-2"
              onClick={() => setPickerOpen((v) => !v)}
            >
              <Plus className="h-3 w-3 mr-1" /> Agregar robot
            </Button>
            {pickerOpen && (
              <div className="absolute z-50 top-full left-0 mt-1 w-60 bg-popover border rounded-lg shadow-lg p-2 space-y-2">
                <Input
                  placeholder="Buscar robot..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-7 text-xs"
                  autoFocus
                />
                <div className="max-h-56 overflow-y-auto space-y-0.5">
                  {!hasMatriz && (
                    <p className="text-[10px] text-muted-foreground px-2 py-1 italic">
                      Sin matriz para esta operacion — se muestran todos
                    </p>
                  )}
                  {available.map((r) => {
                    const estadoPrograma = programaForOp?.[r.id]
                    const activo = r.estado === 'ACTIVO'
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => { onToggle(r.id); setSearch('') }}
                        className={cn(
                          'w-full text-left px-2 py-1 rounded text-xs hover:bg-accent flex items-center justify-between gap-2',
                          !activo && 'opacity-60',
                        )}
                      >
                        <span className={cn('font-medium', !activo && 'line-through')}>{r.nombre}</span>
                        <span className="flex items-center gap-1 text-[9px]">
                          {estadoPrograma === 'TIENE' && (
                            <span className="px-1 py-0.5 rounded bg-green-500/15 text-green-500 font-semibold">TIENE</span>
                          )}
                          {estadoPrograma === 'FALTA' && (
                            <span className="px-1 py-0.5 rounded bg-yellow-500/15 text-yellow-500 font-semibold">FALTA</span>
                          )}
                          {!activo && (
                            <span className="px-1 py-0.5 rounded bg-muted text-muted-foreground">FUERA SVC</span>
                          )}
                        </span>
                      </button>
                    )
                  })}
                  {available.length === 0 && (
                    <p className="text-[10px] text-muted-foreground px-2 py-1">
                      {robots.length === selectedIds.size
                        ? 'Todos asignados'
                        : hasMatriz
                          ? 'Sin robots con programa'
                          : 'Sin resultados'}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  )
}

function RobotLoadChart({
  loadByRobot, robots, capacity,
}: {
  loadByRobot: Map<string, { totalHrs: number; byModel: Map<string, number> }>
  robots: RobotLite[]
  capacity: number
}) {
  // Ordenar: solo robots con carga > 0, desc por horas
  const rows = useMemo(() => {
    const arr: { id: string; nombre: string; total: number; byModel: [string, number][] }[] = []
    for (const r of robots) {
      const load = loadByRobot.get(r.id)
      if (!load || load.totalHrs === 0) continue
      arr.push({
        id: r.id,
        nombre: r.nombre,
        total: load.totalHrs,
        byModel: [...load.byModel.entries()].sort((a, b) => b[1] - a[1]),
      })
    }
    return arr.sort((a, b) => b.total - a.total)
  }, [loadByRobot, robots])

  const maxTotal = Math.max(capacity, ...rows.map((r) => r.total))

  // Paleta simple para modelos (cycle)
  const MODEL_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']
  const modelColor = useMemo(() => {
    const allModels = new Set<string>()
    for (const r of rows) for (const [m] of r.byModel) allModels.add(m)
    const map = new Map<string, string>()
    let i = 0
    for (const m of [...allModels].sort()) {
      map.set(m, MODEL_COLORS[i % MODEL_COLORS.length])
      i++
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  if (rows.length === 0) {
    return <div className="text-xs text-muted-foreground py-4 text-center">Ningun robot tiene carga asignada aun.</div>
  }

  return (
    <div className="space-y-1.5">
      {rows.map((r) => {
        const widthPct = Math.min(100, (r.total / maxTotal) * 100)
        const capPct = Math.min(100, (capacity / maxTotal) * 100)
        const over = r.total > capacity
        return (
          <div key={r.id} className="flex items-center gap-2 text-xs">
            <div className="w-24 shrink-0 truncate font-mono" title={r.nombre}>{r.nombre}</div>
            <div className="flex-1 relative h-5 bg-muted/40 rounded overflow-hidden">
              {/* Marca de capacidad */}
              <div
                className="absolute top-0 bottom-0 border-l border-dashed border-foreground/40"
                style={{ left: `${capPct}%` }}
                title={`Capacidad ${capacity}h`}
              />
              {/* Barras stacked por modelo */}
              <div className="absolute inset-0 flex">
                {r.byModel.map(([m, hrs]) => {
                  const pct = (hrs / maxTotal) * 100
                  return (
                    <div
                      key={m}
                      style={{ width: `${pct}%`, backgroundColor: modelColor.get(m) || '#999' }}
                      title={`${m}: ${hrs.toFixed(1)} hrs`}
                    />
                  )
                })}
              </div>
              {/* Total overlay */}
              <div
                className={cn(
                  'absolute top-0 bottom-0 right-0 flex items-center pr-2 text-[10px] font-semibold',
                  over ? 'text-destructive' : 'text-foreground',
                )}
                style={{ left: `${widthPct}%`, minWidth: 'fit-content' }}
              >
                <span className="ml-1">{r.total.toFixed(1)}h</span>
              </div>
            </div>
          </div>
        )
      })}
      {/* Leyenda de modelos */}
      <div className="flex flex-wrap gap-2 pt-2 text-[10px] text-muted-foreground">
        {[...modelColor.entries()].map(([m, c]) => (
          <div key={m} className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-sm" style={{ backgroundColor: c }} />
            <span>{m}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
