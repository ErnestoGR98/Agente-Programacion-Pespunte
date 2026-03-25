'use client'

import { useState, useMemo, useEffect } from 'react'
import { useAppStore, type WeeklyDraftRow } from '@/lib/store/useAppStore'
import { supabase } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Cell,
} from 'recharts'
import { Loader2, AlertTriangle, CheckCircle2, MinusCircle, Users, Bot } from 'lucide-react'
import { DAY_ORDER } from '@/types'
import type { DayName, ResourceType, CatalogoOperacion, Robot, MaquinaTipo } from '@/types'

// ============================================================
// Types
// ============================================================

interface OperarioSlim {
  id: string
  nombre: string
  activo: boolean
  recursos: ResourceType[]
  dias: DayName[]
  habilidades: string[]
}

/** Per resource type, per day: how many person-blocks are needed vs available */
interface ResourceDayAnalysis {
  recurso: ResourceType
  needed: number       // person-hours needed
  available: number    // operators available this day with this skill
  occupied: number     // min(needed, available)
  free: number         // max(0, available - needed)
  deficit: number      // max(0, needed - available)
}

interface DayAnalysis {
  dia: DayName
  minutosLaborales: number
  resources: ResourceDayAnalysis[]
  totalNeeded: number
  totalAvailable: number
  totalFree: number
  totalDeficit: number
}

interface OperarioDayStatus {
  dia: DayName
  available: boolean
  /** which resource type would they be assigned to (highest demand first) */
  assignedTo: ResourceType | null
}

interface OperarioAnalysis {
  id: string
  nombre: string
  recursos: ResourceType[]
  habilidades: string[]
  days: OperarioDayStatus[]
  diasOcupado: number
  diasLibre: number
}

// Resource types we analyze (in display order)
const RESOURCE_ORDER: ResourceType[] = ['MESA', 'ROBOT', 'PLANA', 'POSTE']

const RESOURCE_LABELS: Record<string, string> = {
  MESA: 'Mesa / Preliminar',
  ROBOT: 'Robot',
  PLANA: 'Plana-Recta',
  POSTE: 'Poste',
}

// ============================================================
// Helpers
// ============================================================

function deriveRecursosFromHabilidades(habs: string[]): ResourceType[] {
  const set = new Set(habs)
  const r: ResourceType[] = []
  if (set.has('PRELIMINARES')) r.push('MESA')
  if (set.has('ROBOTS')) r.push('ROBOT')
  if (set.has('PLANA_RECTA')) r.push('PLANA')
  if (set.has('POSTE_CONV')) r.push('POSTE')
  return r
}

// ============================================================
// Page
// ============================================================

export default function AnalisisPage() {
  const { appStep, currentSemana, weeklyDraft, weeklyDraftSemana, currentResult } = useAppStore()

  // Detect if we have real daily results from solver
  const dailyResults = currentResult?.daily_results
  const hasRealData = !!(dailyResults && Object.keys(dailyResults).length > 0 &&
    Object.values(dailyResults).some((dr) => dr.schedule && dr.schedule.length > 0))

  const [operarios, setOperarios] = useState<OperarioSlim[]>([])
  const [operaciones, setOperaciones] = useState<CatalogoOperacion[]>([])
  const [diasLaborales, setDiasLaborales] = useState<{ nombre: DayName; minutos: number; plantilla: number }[]>([])
  const [robots, setRobots] = useState<(Robot & { tipos: MaquinaTipo[] })[]>([])
  const [opRobots, setOpRobots] = useState<{ operacion_id: string; robot_id: string }[]>([])
  const [loading, setLoading] = useState(true)

  // Load supporting data
  useEffect(() => {
    async function load() {
      setLoading(true)

      const [opsRes, catOpsRes, diasRes, habRes, diasRelRes, robotsRes, robotTiposRes, opRobotsRes] = await Promise.all([
        supabase.from('operarios').select('id, nombre, activo').eq('activo', true),
        supabase.from('catalogo_operaciones').select('*'),
        supabase.from('dias_laborales').select('nombre, minutos, plantilla').order('orden'),
        supabase.from('operario_habilidades').select('operario_id, habilidad'),
        supabase.from('operario_dias').select('operario_id, dia'),
        supabase.from('robots').select('*').eq('estado', 'ACTIVO').eq('area', 'PESPUNTE').order('orden'),
        supabase.from('robot_tipos').select('robot_id, tipo'),
        supabase.from('catalogo_operaciones_robots').select('operacion_id, robot_id'),
      ])

      const opRows = opsRes.data || []
      const habs = habRes.data || []
      const diasRels = diasRelRes.data || []

      const opFull: OperarioSlim[] = opRows.map((o: { id: string; nombre: string; activo: boolean }) => {
        const opHabs = habs
          .filter((h: { operario_id: string }) => h.operario_id === o.id)
          .map((h: { habilidad: string }) => h.habilidad)
        return {
          ...o,
          habilidades: opHabs,
          recursos: deriveRecursosFromHabilidades(opHabs),
          dias: diasRels
            .filter((d: { operario_id: string }) => d.operario_id === o.id)
            .map((d: { dia: DayName }) => d.dia),
        }
      })

      setOperarios(opFull)
      setOperaciones(catOpsRes.data || [])
      setDiasLaborales(diasRes.data || [])

      // Robots with tipos — only actual robots (3020, 6040, CHACHE base types)
      const ROBOT_BASE_TYPES = new Set(['3020', '6040', 'CHACHE'])
      const tiposData = robotTiposRes.data || []
      const allMachines = (robotsRes.data || []).map((r: Robot) => ({
        ...r,
        tipos: tiposData
          .filter((t: { robot_id: string }) => t.robot_id === r.id)
          .map((t: { tipo: string }) => t.tipo as MaquinaTipo),
      }))
      // Filter: only machines that have at least one robot base type
      const parsedRobots = allMachines.filter(
        (r: { tipos: MaquinaTipo[] }) => r.tipos.some((t: MaquinaTipo) => ROBOT_BASE_TYPES.has(t))
      )
      setRobots(parsedRobots)
      setOpRobots(opRobotsRes.data || [])

      setLoading(false)
    }
    load()
  }, [])

  // Active days
  const activeDays = useMemo(() => {
    return DAY_ORDER.filter((d) => diasLaborales.some((dl) => dl.nombre === d && dl.plantilla > 0))
  }, [diasLaborales])

  // Build model→operations lookup (modelo_num → operations with recurso & sec_per_pair)
  // We need to map from catalogo_operaciones (which uses modelo_id) to modelo_num
  // For that we need the catalogo_modelos mapping
  const [modeloIdToNum, setModeloIdToNum] = useState<Record<string, string>>({})
  useEffect(() => {
    supabase.from('catalogo_modelos').select('id, modelo_num').then(({ data }) => {
      const map: Record<string, string> = {}
      for (const m of data || []) map[m.id] = m.modelo_num
      setModeloIdToNum(map)
    })
  }, [])

  // Build modelo_num → operations grouped by recurso (shared between analyses)
  const modelOps = useMemo(() => {
    const map: Record<string, { recurso: ResourceType; sec_per_pair: number }[]> = {}
    for (const op of operaciones) {
      const modeloNum = modeloIdToNum[op.modelo_id]
      if (!modeloNum) continue
      if (!map[modeloNum]) map[modeloNum] = []
      map[modeloNum].push({
        recurso: op.recurso as ResourceType,
        sec_per_pair: op.sec_per_pair,
      })
    }
    return map
  }, [operaciones, modeloIdToNum])

  // Combined analysis: assign each operator to exactly ONE resource per day
  // This prevents double-counting multi-skill operators
  const { dayAnalysis, operarioAnalysis } = useMemo(() => {
    if (!weeklyDraft || weeklyDraftSemana !== currentSemana) {
      return { dayAnalysis: [] as DayAnalysis[], operarioAnalysis: [] as OperarioAnalysis[] }
    }

    const assignments: Record<string, Record<DayName, ResourceType | null>> = {}
    for (const op of operarios) {
      assignments[op.id] = Object.fromEntries(activeDays.map((d) => [d, null])) as Record<DayName, ResourceType | null>
    }

    const allDayAnalysis: DayAnalysis[] = activeDays.map((dia) => {
      const diaConfig = diasLaborales.find((d) => d.nombre === dia)
      const minutosLab = diaConfig?.minutos || 600

      // 1. Calculate concurrent demand per resource type
      //    = how many models running this day need this resource?
      //    Each model ties up 1 operator per resource type at a time
      //    (operations within a model are sequential, but across models are parallel)
      const neededByRecurso: Record<string, number> = {}
      for (const recurso of RESOURCE_ORDER) {
        let concurrentModels = 0
        for (const row of weeklyDraft) {
          if ((row.days[dia] || 0) === 0) continue
          // Does this model have at least one operation using this resource?
          const ops = modelOps[row.modelo_num] || []
          if (ops.some((op) => op.recurso === recurso)) {
            concurrentModels++
          }
        }
        neededByRecurso[recurso] = concurrentModels
      }

      // 2. Get operators available this day
      const availableOps = operarios.filter((op) => op.dias.includes(dia))
      const usedOps = new Set<string>()

      // 3. Smart assignment: minimize total deficit
      //    Key insight: assign scarce-skill operators to their scarce resource,
      //    not to abundant resources where others can fill in.
      const assignedByRecurso: Record<string, string[]> = {}
      for (const recurso of RESOURCE_ORDER) assignedByRecurso[recurso] = []

      // Calculate scarcity: how many available operators per resource
      const supplyByRecurso: Record<string, number> = {}
      for (const recurso of RESOURCE_ORDER) {
        supplyByRecurso[recurso] = availableOps.filter((op) => op.recursos.includes(recurso)).length
      }

      // Sort resources by scarcity: fill the SCARCEST resource first
      // (fewest available operators relative to need)
      const sortedResources = [...RESOURCE_ORDER]
        .filter((r) => (neededByRecurso[r] || 0) > 0)
        .sort((a, b) => {
          const surplusA = (supplyByRecurso[a] || 0) - (neededByRecurso[a] || 0)
          const surplusB = (supplyByRecurso[b] || 0) - (neededByRecurso[b] || 0)
          return surplusA - surplusB // most scarce first (lowest surplus)
        })

      // For each resource (scarcest first), assign operators
      // Prefer operators who can't help with scarcer resources
      for (const recurso of sortedResources) {
        const needed = neededByRecurso[recurso] || 0
        if (needed === 0) continue

        const candidates = availableOps
          .filter((op) => op.recursos.includes(recurso) && !usedOps.has(op.id))
          .sort((a, b) => {
            // Prefer operators who have FEWER other scarce skills
            // (save flexible operators for resources that truly need them)
            const aOtherScarce = a.recursos.filter(
              (r) => r !== recurso && sortedResources.includes(r)
            ).length
            const bOtherScarce = b.recursos.filter(
              (r) => r !== recurso && sortedResources.includes(r)
            ).length
            return aOtherScarce - bOtherScarce // least flexible first
          })

        for (const op of candidates) {
          if (assignedByRecurso[recurso].length >= needed) break
          assignedByRecurso[recurso].push(op.id)
          assignments[op.id][dia] = recurso
          usedOps.add(op.id)
        }
      }

      // 4. Build resource analysis with real counts
      const totalAvailableDay = availableOps.length
      const totalAssignedDay = usedOps.size

      const resources: ResourceDayAnalysis[] = RESOURCE_ORDER.map((recurso) => {
        const needed = neededByRecurso[recurso] || 0
        const assigned = assignedByRecurso[recurso].length
        const deficit = Math.max(0, needed - assigned)
        // "available" = operators actually assigned to this resource (not double-counted)
        // "free" doesn't make sense per-resource anymore since freed operators might serve other resources
        // We show: needed / assigned / deficit
        return {
          recurso,
          needed,
          available: assigned, // actually assigned to this resource
          occupied: assigned,
          free: 0, // calculated at total level
          deficit,
        }
      })

      const totalNeeded = resources.reduce((s, r) => s + r.needed, 0)
      const totalDeficit = resources.reduce((s, r) => s + r.deficit, 0)
      const totalFree = Math.max(0, totalAvailableDay - totalAssignedDay)

      return {
        dia,
        minutosLaborales: minutosLab,
        resources,
        totalNeeded,
        totalAvailable: totalAvailableDay,
        totalFree,
        totalDeficit,
      }
    })

    // Build operator analysis from assignments
    const opAnalysis: OperarioAnalysis[] = operarios.map((op) => {
      const days: OperarioDayStatus[] = activeDays.map((dia) => ({
        dia,
        available: op.dias.includes(dia),
        assignedTo: op.dias.includes(dia) ? assignments[op.id]?.[dia] ?? null : null,
      }))

      return {
        id: op.id,
        nombre: op.nombre,
        recursos: op.recursos,
        habilidades: op.habilidades,
        days,
        diasOcupado: days.filter((d) => d.assignedTo !== null).length,
        diasLibre: days.filter((d) => d.available && d.assignedTo === null).length,
      }
    })

    return { dayAnalysis: allDayAnalysis, operarioAnalysis: opAnalysis }
  }, [weeklyDraft, weeklyDraftSemana, currentSemana, activeDays, modelOps, operarios, diasLaborales])

  // ============================================================
  // REAL DATA from solver (when daily_results exist)
  // ============================================================

  // Extract real HC usage per resource per day from solver schedule
  const realDayAnalysis = useMemo((): DayAnalysis[] | null => {
    if (!hasRealData || !dailyResults) return null

    return activeDays.map((dia) => {
      const dr = dailyResults[dia]
      if (!dr || !dr.schedule || dr.schedule.length === 0) {
        return {
          dia, minutosLaborales: 0,
          resources: RESOURCE_ORDER.map((r) => ({ recurso: r, needed: 0, available: 0, occupied: 0, free: 0, deficit: 0 })),
          totalNeeded: 0, totalAvailable: 0, totalFree: 0, totalDeficit: 0,
        }
      }

      const diaConfig = diasLaborales.find((d) => d.nombre === dia)
      const availableOps = operarios.filter((op) => op.dias.includes(dia))

      const numBlocks = Math.max(...dr.schedule.map((s) => (s.blocks || []).length), 0)
      const peakByRecurso: Record<string, number> = {}

      for (let b = 0; b < numBlocks; b++) {
        const hcInBlock: Record<string, number> = {}
        for (const s of dr.schedule) {
          const pares = (s.blocks || [])[b] || 0
          if (pares > 0) {
            const recurso = s.recurso || 'GENERAL'
            hcInBlock[recurso] = (hcInBlock[recurso] || 0) + (s.hc || 1)
          }
        }
        for (const [r, hc] of Object.entries(hcInBlock)) {
          peakByRecurso[r] = Math.max(peakByRecurso[r] || 0, hc)
        }
      }

      const assignedByRecurso: Record<string, Set<string>> = {}
      for (const s of dr.schedule) {
        if (s.operario && s.operario !== 'SIN ASIGNAR') {
          const r = s.recurso || 'GENERAL'
          if (!assignedByRecurso[r]) assignedByRecurso[r] = new Set()
          assignedByRecurso[r].add(s.operario)
        }
      }

      const unassignedByRecurso: Record<string, number> = {}
      for (const u of dr.unassigned_ops || []) {
        const r = u.recurso || 'GENERAL'
        unassignedByRecurso[r] = (unassignedByRecurso[r] || 0) + 1
      }

      const resources: ResourceDayAnalysis[] = RESOURCE_ORDER.map((recurso) => {
        const needed = peakByRecurso[recurso] || 0
        const occupied = assignedByRecurso[recurso]?.size || 0
        const deficit = unassignedByRecurso[recurso] || 0
        return { recurso, needed, available: occupied, occupied, free: 0, deficit }
      })

      const totalOccupied = new Set(
        dr.schedule.filter((s) => s.operario && s.operario !== 'SIN ASIGNAR').map((s) => s.operario)
      ).size

      return {
        dia,
        minutosLaborales: diaConfig?.minutos || 600,
        resources,
        totalNeeded: resources.reduce((s, r) => s + r.needed, 0),
        totalAvailable: availableOps.length,
        totalFree: Math.max(0, availableOps.length - totalOccupied),
        totalDeficit: resources.reduce((s, r) => s + r.deficit, 0),
      }
    })
  }, [hasRealData, dailyResults, activeDays, diasLaborales, operarios])

  // Real operator analysis from operator_timelines
  const realOperarioAnalysis = useMemo((): OperarioAnalysis[] | null => {
    if (!hasRealData || !dailyResults) return null

    return operarios.map((op) => {
      const days: OperarioDayStatus[] = activeDays.map((dia) => {
        const dr = dailyResults[dia]
        const timeline = dr?.operator_timelines?.[op.nombre]
        const isAvailable = op.dias.includes(dia)

        let assignedTo: ResourceType | null = null
        if (timeline && timeline.length > 0) {
          const recursoCount: Record<string, number> = {}
          for (const entry of timeline) {
            const r = entry.recurso || 'GENERAL'
            recursoCount[r] = (recursoCount[r] || 0) + 1
          }
          assignedTo = Object.entries(recursoCount).sort((a, b) => b[1] - a[1])[0]?.[0] as ResourceType || null
        }

        return { dia, available: isAvailable, assignedTo }
      })

      return {
        id: op.id,
        nombre: op.nombre,
        recursos: op.recursos,
        habilidades: op.habilidades,
        days,
        diasOcupado: days.filter((d) => d.assignedTo !== null).length,
        diasLibre: days.filter((d) => d.available && d.assignedTo === null).length,
      }
    })
  }, [hasRealData, dailyResults, operarios, activeDays])

  // Use real data if available, otherwise estimation
  const displayDayAnalysis = realDayAnalysis || dayAnalysis
  const displayOperarioAnalysis = realOperarioAnalysis || operarioAnalysis

  // Alerts
  const alerts = useMemo(() => {
    const items: { type: 'danger' | 'warning' | 'info'; message: string }[] = []

    for (const da of displayDayAnalysis) {
      for (const r of da.resources) {
        if (r.deficit > 0) {
          items.push({
            type: 'danger',
            message: `${da.dia}: Faltan ${r.deficit} operario${r.deficit > 1 ? 's' : ''} de ${RESOURCE_LABELS[r.recurso] || r.recurso}. Necesitas ${r.needed}, solo hay ${r.available} disponible${r.available !== 1 ? 's' : ''}.`,
          })
        }
      }
    }

    // Check for operators that are free every day (underutilized)
    for (const oa of displayOperarioAnalysis) {
      if (oa.diasLibre === activeDays.length && oa.days.some((d) => d.available)) {
        items.push({
          type: 'info',
          message: `${oa.nombre} (${oa.recursos.join(', ')}) está libre toda la semana — considerar reasignar o capacitar en otro recurso.`,
        })
      }
    }

    // Check for single-skill bottlenecks
    for (const recurso of RESOURCE_ORDER) {
      const opsWithSkill = operarios.filter((op) => op.recursos.includes(recurso))
      if (opsWithSkill.length === 1) {
        const hasDeficit = displayDayAnalysis.some((da) =>
          da.resources.find((r) => r.recurso === recurso && r.needed > 0)
        )
        if (hasDeficit) {
          items.push({
            type: 'warning',
            message: `Solo ${opsWithSkill[0].nombre} sabe operar ${RESOURCE_LABELS[recurso] || recurso}. Si falta, no hay reemplazo.`,
          })
        }
      }
    }

    return items
  }, [displayDayAnalysis, displayOperarioAnalysis, operarios, activeDays])

  // Robot utilization: per robot type, per day — how many models need it vs how many physical robots
  const robotAnalysis = useMemo(() => {
    if (!weeklyDraft || weeklyDraftSemana !== currentSemana) return []

    // Build operation_id → robot_ids mapping
    const opToRobots: Record<string, string[]> = {}
    for (const or of opRobots) {
      if (!opToRobots[or.operacion_id]) opToRobots[or.operacion_id] = []
      opToRobots[or.operacion_id].push(or.robot_id)
    }

    // Build robot_id → robot info
    const robotById: Record<string, { nombre: string; tipos: MaquinaTipo[] }> = {}
    for (const r of robots) robotById[r.id] = { nombre: r.nombre, tipos: r.tipos }

    // Group robots by tipo base (3020, 6040, CHACHE)
    const tipoToRobots: Record<string, string[]> = {}
    for (const r of robots) {
      for (const t of r.tipos) {
        if (['3020', '6040', 'CHACHE'].includes(t)) {
          if (!tipoToRobots[t]) tipoToRobots[t] = []
          if (!tipoToRobots[t].includes(r.id)) tipoToRobots[t].push(r.id)
        }
      }
    }

    // For each day: which models need ROBOT operations? Which robot types do they need?
    const tipoLabels = Object.keys(tipoToRobots).sort()

    return activeDays.map((dia) => {
      const modelsToday = (weeklyDraft || []).filter((r) => (r.days[dia] || 0) > 0)
      const demandByTipo: Record<string, number> = {}

      for (const row of modelsToday) {
        const ops = operaciones.filter(
          (op) => modeloIdToNum[op.modelo_id] === row.modelo_num && op.recurso === 'ROBOT'
        )
        // Each robot operation of a model can use certain robots
        // Count unique robot types needed by this model
        const tiposNeeded = new Set<string>()
        for (const op of ops) {
          const robotIds = opToRobots[op.id] || []
          for (const rid of robotIds) {
            const r = robotById[rid]
            if (r) {
              for (const t of r.tipos) {
                if (['3020', '6040', 'CHACHE'].includes(t)) tiposNeeded.add(t)
              }
            }
          }
        }
        // If model has ROBOT ops but no specific robot assignment, count as generic ROBOT
        if (ops.length > 0 && tiposNeeded.size === 0) {
          tiposNeeded.add('ROBOT')
        }
        for (const t of tiposNeeded) {
          demandByTipo[t] = (demandByTipo[t] || 0) + 1
        }
      }

      return {
        dia,
        tipos: [...tipoLabels, ...(demandByTipo['ROBOT'] ? ['ROBOT'] : [])].map((tipo) => ({
          tipo,
          needed: demandByTipo[tipo] || 0,
          available: tipo === 'ROBOT' ? robots.length : (tipoToRobots[tipo]?.length || 0),
          deficit: Math.max(0, (demandByTipo[tipo] || 0) - (tipo === 'ROBOT' ? robots.length : (tipoToRobots[tipo]?.length || 0))),
        })),
      }
    })
  }, [weeklyDraft, weeklyDraftSemana, currentSemana, activeDays, operaciones, modeloIdToNum, opRobots, robots])

  // Chart data: HC needed vs available per day
  const hcChartData = useMemo(() => {
    return displayDayAnalysis.map((da) => {
      const totalAssigned = da.resources.reduce((s, r) => s + r.occupied, 0)
      return {
        dia: da.dia,
        'Asignados': totalAssigned,
        'Necesarios': da.totalNeeded,
        'Disponibles': da.totalAvailable,
      }
    })
  }, [displayDayAnalysis])

  // Chart data: robots needed vs available per day (stacked by tipo)
  const robotChartData = useMemo(() => {
    return robotAnalysis.map((ra) => {
      const entry: Record<string, string | number> = { dia: ra.dia }
      for (const t of ra.tipos) {
        entry[`${t.tipo} necesarios`] = t.needed
        entry[`${t.tipo} disponibles`] = t.available
      }
      return entry
    })
  }, [robotAnalysis])

  // ============================================================
  // Render
  // ============================================================

  if (appStep < 1) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Carga un pedido para ver el analisis.
      </div>
    )
  }

  if (!weeklyDraft || weeklyDraftSemana !== currentSemana) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Primero distribuye los pares en el Plan Semanal.
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando datos...
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Analisis de Factibilidad</h1>
          <p className="text-sm text-muted-foreground">
            {currentSemana} — {hasRealData ? 'Datos reales del programa diario' : 'Estimacion basada en el plan semanal'}
          </p>
        </div>
        <Badge variant={hasRealData ? 'default' : 'outline'} className={hasRealData ? 'bg-green-600' : ''}>
          {hasRealData ? 'Datos reales (solver)' : 'Estimacion (pre-solver)'}
        </Badge>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Alertas
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3 space-y-1.5">
            {alerts.map((a, i) => (
              <div
                key={i}
                className={`text-sm rounded px-3 py-2 ${
                  a.type === 'danger'
                    ? 'bg-destructive/10 text-destructive'
                    : a.type === 'warning'
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                }`}
              >
                {a.message}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* HC by Resource × Day */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Operarios por Tipo de Recurso × Dia</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 bg-card z-10 min-w-[150px]">Recurso</TableHead>
                  {activeDays.map((d) => (
                    <TableHead key={d} className="text-center min-w-[130px]">{d}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {RESOURCE_ORDER.map((recurso) => (
                  <TableRow key={recurso}>
                    <TableCell className="sticky left-0 bg-card z-10 font-medium text-sm">
                      {RESOURCE_LABELS[recurso] || recurso}
                    </TableCell>
                    {activeDays.map((dia) => {
                      const da = displayDayAnalysis.find((d) => d.dia === dia)
                      const r = da?.resources.find((r) => r.recurso === recurso)
                      if (!r) return <TableCell key={dia} className="text-center text-muted-foreground">—</TableCell>

                      const hasDeficit = r.deficit > 0
                      const noNeed = r.needed === 0
                      const covered = !hasDeficit && !noNeed

                      return (
                        <TableCell key={dia} className="text-center p-2">
                          <div className={`rounded-lg px-2 py-1.5 ${
                            noNeed
                              ? 'bg-muted/50'
                              : hasDeficit
                              ? 'bg-destructive/15'
                              : 'bg-green-500/10'
                          }`}>
                            {noNeed ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              <>
                                <div className="text-sm">
                                  <span className="font-bold">{r.occupied}</span>
                                  <span className="text-muted-foreground text-xs"> asignados</span>
                                </div>
                                <div className="text-[10px] mt-0.5">
                                  <span className="text-muted-foreground">
                                    de {r.needed} necesarios
                                  </span>
                                </div>
                                {hasDeficit && (
                                  <div className="text-[10px] text-destructive font-bold mt-0.5">
                                    Faltan {r.deficit}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))}

                {/* Totals row */}
                <TableRow className="border-t-2 border-primary/30 bg-primary/5">
                  <TableCell className="sticky left-0 bg-primary/5 z-10 font-bold text-sm text-primary">
                    TOTAL
                  </TableCell>
                  {activeDays.map((dia) => {
                    const da = displayDayAnalysis.find((d) => d.dia === dia)
                    if (!da) return <TableCell key={dia} />
                    const totalAssigned = da.resources.reduce((s, r) => s + r.occupied, 0)
                    return (
                      <TableCell key={dia} className="text-center">
                        <div className="text-sm">
                          <span className="font-bold">{totalAssigned}</span>
                          <span className="text-muted-foreground"> / {da.totalAvailable}</span>
                          <span className="text-muted-foreground text-xs"> personas</span>
                        </div>
                        <div className="flex items-center justify-center gap-2 mt-0.5">
                          {da.totalFree > 0 && (
                            <span className="text-[10px] text-green-600 dark:text-green-400">
                              {da.totalFree} sin asignar
                            </span>
                          )}
                          {da.totalDeficit > 0 && (
                            <span className="text-[10px] text-destructive font-bold">
                              Faltan {da.totalDeficit}
                            </span>
                          )}
                        </div>
                      </TableCell>
                    )
                  })}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Operator detail */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="h-4 w-4" /> Detalle por Operario
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 bg-card z-10 min-w-[120px]">Operario</TableHead>
                  <TableHead className="min-w-[120px]">Habilidades</TableHead>
                  {activeDays.map((d) => (
                    <TableHead key={d} className="text-center min-w-[90px]">{d}</TableHead>
                  ))}
                  <TableHead className="text-center min-w-[70px]">Ocupado</TableHead>
                  <TableHead className="text-center min-w-[70px]">Libre</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayOperarioAnalysis.map((oa) => (
                  <TableRow key={oa.id}>
                    <TableCell className="sticky left-0 bg-card z-10 font-medium text-sm">
                      {oa.nombre}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {oa.recursos.map((r) => (
                          <Badge key={r} variant="outline" className="text-[10px] px-1.5 py-0">
                            {r}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    {oa.days.map((d) => (
                      <TableCell key={d.dia} className="text-center p-1.5">
                        {!d.available ? (
                          <div className="rounded bg-muted/60 px-1 py-1 text-[10px] text-muted-foreground">
                            No disp.
                          </div>
                        ) : d.assignedTo ? (
                          <div className={`rounded px-1 py-1 text-[10px] font-medium ${
                            d.assignedTo === 'ROBOT' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' :
                            d.assignedTo === 'MESA' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' :
                            d.assignedTo === 'PLANA' ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400' :
                            d.assignedTo === 'POSTE' ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400' :
                            'bg-primary/10 text-primary'
                          }`}>
                            {d.assignedTo}
                          </div>
                        ) : (
                          <div className="rounded bg-green-500/10 px-1 py-1 text-[10px] text-green-600 dark:text-green-400">
                            Libre
                          </div>
                        )}
                      </TableCell>
                    ))}
                    <TableCell className="text-center text-sm font-medium">
                      {oa.diasOcupado}
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      <span className={oa.diasLibre > 0 ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}>
                        {oa.diasLibre}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* HC Chart */}
        {hcChartData.length > 0 && (
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="h-4 w-4" /> Headcount por Dia
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={hcChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="dia" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Necesarios" fill="#F59E0B" />
                  <Bar dataKey="Asignados" fill="#3B82F6" />
                  <Bar dataKey="Disponibles" fill="#D1D5DB" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Robot utilization chart */}
        {robotAnalysis.length > 0 && (
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Bot className="h-4 w-4" /> Utilizacion de Robots por Dia
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Table format is clearer for robots */}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[80px]">Tipo</TableHead>
                      <TableHead className="text-center text-xs">Fisicos</TableHead>
                      {activeDays.map((d) => (
                        <TableHead key={d} className="text-center min-w-[60px]">{d}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      // Collect all robot types across all days
                      const allTipos = new Set<string>()
                      for (const ra of robotAnalysis) {
                        for (const t of ra.tipos) allTipos.add(t.tipo)
                      }
                      return [...allTipos].sort().map((tipo) => {
                        const firstDay = robotAnalysis[0]?.tipos.find((t) => t.tipo === tipo)
                        const available = firstDay?.available || 0
                        return (
                          <TableRow key={tipo}>
                            <TableCell className="font-medium text-sm">{tipo}</TableCell>
                            <TableCell className="text-center text-sm font-mono">{available}</TableCell>
                            {activeDays.map((dia) => {
                              const ra = robotAnalysis.find((r) => r.dia === dia)
                              const t = ra?.tipos.find((t) => t.tipo === tipo)
                              const needed = t?.needed || 0
                              const avail = t?.available || 0
                              const deficit = t?.deficit || 0

                              if (needed === 0) {
                                return (
                                  <TableCell key={dia} className="text-center text-xs text-muted-foreground">
                                    —
                                  </TableCell>
                                )
                              }

                              return (
                                <TableCell key={dia} className="text-center p-1.5">
                                  <div className={`rounded px-1 py-0.5 text-xs font-medium ${
                                    deficit > 0
                                      ? 'bg-destructive/15 text-destructive'
                                      : needed === avail
                                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                      : 'bg-green-500/10 text-green-600 dark:text-green-400'
                                  }`}>
                                    {needed}/{avail}
                                    {deficit > 0 && <span className="ml-1 font-bold">!</span>}
                                  </div>
                                </TableCell>
                              )
                            })}
                          </TableRow>
                        )
                      })
                    })()}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
