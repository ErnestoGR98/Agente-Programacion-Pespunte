'use client'

import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import { supabase } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { KpiCard } from '@/components/shared/KpiCard'
import { cn } from '@/lib/utils'
import {
  Plus, Trash2, Download, Clock, Calculator, ChevronDown, ChevronRight,
  Save, FolderOpen, Upload, FileSpreadsheet,
} from 'lucide-react'
import type { DayName, ProcessType } from '@/types'
import { DAY_ORDER, STAGE_COLORS } from '@/types'
import { ComparativoTab } from './ComparativoTab'
import { ReferenciaTab } from './ReferenciaTab'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CatOp {
  fraccion: number
  operacion: string
  input_o_proceso: ProcessType
  etapa: string
  recurso: string
  rate: number
}

interface CatModelo {
  id: string
  modelo_num: string
  alternativas: string[]
  operaciones: CatOp[]
}

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
  const [loadingCat, setLoadingCat] = useState(true)

  // --- Plan state ---
  const [planId, setPlanId] = useState<string | null>(null)
  const [planName, setPlanName] = useState('')
  const [rows, setRows] = useState<PlanRow[]>([])
  const [activeDays, setActiveDays] = useState<DayName[]>(['Lun', 'Mar', 'Mie', 'Jue', 'Vie'])
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  // --- Saved plans list ---
  const [savedPlans, setSavedPlans] = useState<PlanHeader[]>([])

  // --- Tab state ---
  const [tab, setTab] = useState<'editor' | 'comparativo' | 'referencia'>('editor')

  // --- Load catalog + saved plans ---
  useEffect(() => {
    ;(async () => {
      setLoadingCat(true)
      const [modRes, opsRes, plansRes] = await Promise.all([
        supabase.from('catalogo_modelos').select('id, modelo_num, alternativas').order('modelo_num'),
        supabase.from('catalogo_operaciones').select('modelo_id, fraccion, operacion, input_o_proceso, etapa, recurso, rate').order('fraccion'),
        supabase.from('planes_semanales').select('id, nombre, semana, nota, created_at').order('created_at', { ascending: false }),
      ])
      const mods = (modRes.data || []) as { id: string; modelo_num: string; alternativas: string[] }[]
      const ops = (opsRes.data || []) as (CatOp & { modelo_id: string })[]

      const opsByModel = new Map<string, CatOp[]>()
      for (const op of ops) {
        if (!opsByModel.has(op.modelo_id)) opsByModel.set(op.modelo_id, [])
        opsByModel.get(op.modelo_id)!.push({
          fraccion: op.fraccion,
          operacion: op.operacion,
          input_o_proceso: op.input_o_proceso,
          etapa: op.etapa,
          recurso: op.recurso,
          rate: Number(op.rate),
        })
      }

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

  const modelsInPlan = useMemo(() => new Set(rows.map((r) => r.key)), [rows])

  const addModel = useCallback((modeloNum: string, color: string) => {
    const key = color ? `${modeloNum} ${color}` : modeloNum
    if (modelsInPlan.has(key)) return
    setRows((prev) => [
      ...prev,
      {
        key,
        modelo_num: modeloNum,
        color,
        pares: Object.fromEntries(activeDays.map((d) => [d, 0])) as Record<DayName, number>,
      },
    ])
    setDirty(true)
  }, [activeDays, modelsInPlan])

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

    const { data: items } = await supabase
      .from('plan_semanal_items')
      .select('modelo_num, color, dia, pares')
      .eq('plan_id', id)

    if (!items) return

    // Group items into rows
    const rowMap = new Map<string, PlanRow>()
    for (const item of items) {
      const key = item.color ? `${item.modelo_num} ${item.color}` : item.modelo_num
      if (!rowMap.has(key)) {
        rowMap.set(key, {
          key,
          modelo_num: item.modelo_num,
          color: item.color || '',
          pares: Object.fromEntries(activeDays.map((d) => [d, 0])) as Record<DayName, number>,
        })
      }
      const row = rowMap.get(key)!
      if (item.dia in row.pares || activeDays.includes(item.dia as DayName)) {
        row.pares[item.dia as DayName] = item.pares
      }
    }

    setPlanId(id)
    setPlanName(plan.nombre)
    setRows(Array.from(rowMap.values()))
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
      const items: { plan_id: string; modelo_num: string; color: string; dia: string; pares: number }[] = []
      for (const row of rows) {
        for (const d of activeDays) {
          if ((row.pares[d] || 0) > 0) {
            items.push({
              plan_id: id!,
              modelo_num: row.modelo_num,
              color: row.color,
              dia: d,
              pares: row.pares[d],
            })
          }
        }
      }

      if (items.length > 0) {
        await supabase.from('plan_semanal_items').insert(items)
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
  }, [planId, planName, rows, activeDays])

  // --- New plan ---
  const newPlan = useCallback(() => {
    setPlanId(null)
    setPlanName(computeNextPlanName(savedPlans.map((p) => p.nombre)))
    setRows([])
    setExpandedModels(new Set())
    setDirty(false)
  }, [savedPlans])

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
      const key = color ? `${modeloNum} ${color}` : modeloNum
      if (seen.has(key)) continue
      seen.add(key)

      const pares = Object.fromEntries(activeDays.map((d) => [d, 0])) as Record<DayName, number>
      for (const { day, col } of dayColMap) {
        const val = Number(row[col] || 0)
        if (val > 0) pares[day] = Math.round(val)
      }

      newRows.push({ key, modelo_num: modeloNum, color, pares })
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
                      const alts = c.alternativas?.length ? c.alternativas : ['']
                      return alts.map((alt) => {
                        const key = alt ? `${c.modelo_num} ${alt}` : c.modelo_num
                        const inPlan = modelsInPlan.has(key)
                        return (
                          <button
                            key={key}
                            disabled={inPlan}
                            onClick={() => {
                              addModel(c.modelo_num, alt)
                              setSelectorOpen(false)
                              setSelectorSearch('')
                            }}
                            className={cn(
                              'w-full text-left px-2 py-1.5 rounded text-sm',
                              inPlan
                                ? 'text-muted-foreground/40 cursor-not-allowed'
                                : 'hover:bg-accent',
                            )}
                          >
                            {key}
                            {inPlan && (
                              <span className="ml-2 text-xs text-muted-foreground">(ya agregado)</span>
                            )}
                          </button>
                        )
                      })
                    })}
                    {filteredCatalog.length === 0 && (
                      <p className="text-xs text-muted-foreground px-2 py-3">Sin resultados</p>
                    )}
                  </div>
                </div>
              )}
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
                    return (
                      <tr key={row.key} className="border-b hover:bg-muted/30">
                        <td className="py-1.5 px-2 font-medium">{row.key}</td>
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
        </TabsContent>

        <TabsContent value="comparativo" className="mt-4">
          <ComparativoTab />
        </TabsContent>

        <TabsContent value="referencia" className="mt-4">
          <ReferenciaTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
