// ============================================================
// Tipos del dominio - basados en 001_initial_schema.sql
// ============================================================

// --- Enums ---

export type ResourceType = 'MESA' | 'ROBOT' | 'PLANA' | 'POSTE' | 'MAQUILA' | 'GENERAL'

export type ProcessType = 'PRELIMINARES' | 'ROBOT' | 'POST' | 'MAQUILA' | 'N/A PRELIMINAR'

export type ConstraintType =
  | 'PRIORIDAD' | 'MAQUILA' | 'RETRASO_MATERIAL' | 'FIJAR_DIA'
  | 'FECHA_LIMITE' | 'SECUENCIA' | 'AGRUPAR_MODELOS' | 'AJUSTE_VOLUMEN'
  | 'LOTE_MINIMO_CUSTOM' | 'ROBOT_NO_DISPONIBLE' | 'AUSENCIA_OPERARIO'
  | 'CAPACIDAD_DIA' | 'PRECEDENCIA'

export type DayName = 'Sab' | 'Lun' | 'Mar' | 'Mie' | 'Jue' | 'Vie'

export type RobotEstado = 'ACTIVO' | 'FUERA DE SERVICIO'

export type RobotArea = 'PESPUNTE' | 'AVIOS'

// --- Tablas de Configuración ---

export type MaquinaTipo =
  // Robot base types
  | '3020' | '6040' | 'CHACHE'
  // Maquina preliminar base types
  | 'MAQ_PINTURA' | 'REMACH_NEUMATICA' | 'REMACH_MECANICA' | 'PERFORADORA_JACK'
  // Maquina pespunte base types
  | 'PLANA' | 'POSTE' | 'ZIGZAG' | 'RIBETE' | 'CODO'
  // Modificadores (aditivos)
  | 'DOBLE_ACCION' | '2AG'

/** @deprecated usa MaquinaTipo */
export type RobotTipo = MaquinaTipo

type TipoEntry = { value: MaquinaTipo; label: string }

/** Tipos base de robot (mutuamente excluyentes) */
export const ROBOT_TIPOS_BASE: TipoEntry[] = [
  { value: '3020', label: '3020' },
  { value: '6040', label: '6040' },
  { value: 'CHACHE', label: 'Chache (4530)' },
]

/** Modificadores robot: solo 2A */
export const ROBOT_TIPOS_MODS: TipoEntry[] = [
  { value: 'DOBLE_ACCION', label: '2A' },
]

/** Tipos base de maquina preliminar (mutuamente excluyentes) */
export const PRELIMINAR_TIPOS_BASE: TipoEntry[] = [
  { value: 'MAQ_PINTURA', label: 'Maq. Pintura' },
  { value: 'REMACH_NEUMATICA', label: 'Remach. Neumatica' },
  { value: 'REMACH_MECANICA', label: 'Remach. Mecanica' },
  { value: 'PERFORADORA_JACK', label: 'Perforadora Jack' },
]

/** Tipos base de maquina pespunte convencional (mutuamente excluyentes) */
export const MAQUINA_TIPOS_BASE: TipoEntry[] = [
  { value: 'PLANA', label: 'Plana-Recta' },
  { value: 'POSTE', label: 'Poste' },
  { value: 'ZIGZAG', label: 'Zigzag' },
  { value: 'RIBETE', label: 'Ribete' },
  { value: 'CODO', label: 'Codo' },
]

/** Modificadores maquina pespunte: 2A y 2AG */
export const MAQUINA_TIPOS_MODS: TipoEntry[] = [
  { value: 'DOBLE_ACCION', label: '2A' },
  { value: '2AG', label: '2AG' },
]

/** Todos los tipos (para exports, etc.) */
export const ROBOT_TIPOS = [...ROBOT_TIPOS_BASE, ...ROBOT_TIPOS_MODS]

export interface Robot {
  id: string
  nombre: string
  estado: RobotEstado
  area: RobotArea
  tipos: MaquinaTipo[]
  orden: number
  created_at: string
}

export interface RobotAlias {
  id: string
  alias: string
  robot_id: string
}

export interface Fabrica {
  id: string
  nombre: string
  orden: number
  es_maquila: boolean
}

export interface CapacidadRecurso {
  id: string
  tipo: ResourceType
  pares_hora: number
}

export interface DiaLaboral {
  id: string
  nombre: DayName
  orden: number
  minutos: number
  plantilla: number
  minutos_ot: number
  plantilla_ot: number
  es_sabado: boolean
}

export interface Horario {
  id: string
  tipo: 'SEMANA' | 'FINSEMANA'
  entrada: string
  salida: string
  comida_inicio: string | null
  comida_fin: string | null
  bloque_min: number
}

export interface PesoPriorizacion {
  id: string
  nombre: string
  valor: number
}

export interface ParametroOptimizacion {
  id: string
  nombre: string
  valor: number
}

// --- Catálogo ---

export interface CatalogoModelo {
  id: string
  modelo_num: string
  codigo_full: string | null
  alternativas: string[]
  clave_material: string
  total_sec_per_pair: number
  num_ops: number
  imagen_url: string | null
  alternativas_imagenes: Record<string, string>
  created_at: string
  updated_at: string
}

export interface CatalogoOperacion {
  id: string
  modelo_id: string
  fraccion: number
  operacion: string
  input_o_proceso: ProcessType
  etapa: string
  recurso: ResourceType
  recurso_raw: string
  rate: number
  sec_per_pair: number
}

export interface CatalogoOperacionRobot {
  id: string
  operacion_id: string
  robot_id: string
}

export interface ModeloFabrica {
  id: string
  modelo_id: string
  fabrica_id: string
}

// --- Operarios ---

export interface Operario {
  id: string
  nombre: string
  fabrica_id: string | null
  eficiencia: number
  activo: boolean
  created_at: string
  updated_at: string
  // Relaciones (joined)
  fabricas?: { nombre: string } | null
  recursos?: string[]
  robots?: string[]
  dias?: DayName[]
}

export interface OperarioRecurso {
  id: string
  operario_id: string
  recurso: ResourceType
}

export interface OperarioRobot {
  id: string
  operario_id: string
  robot_id: string
}

export interface OperarioDia {
  id: string
  operario_id: string
  dia: DayName
}

// --- Pedidos ---

export interface Pedido {
  id: string
  nombre: string
  created_at: string
}

export interface PedidoItem {
  id: string
  pedido_id: string
  modelo_num: string
  color: string
  clave_material: string
  fabrica: string
  volumen: number
}

export interface AsignacionMaquila {
  id: string
  pedido_item_id: string
  maquila: string
  pares: number
  fracciones: number[]
}

export interface MaquilaOperacion {
  fraccion: number
  operacion: string
  modelo_id: string
}

// --- Restricciones ---

export interface Restriccion {
  id: string
  semana: string | null
  tipo: ConstraintType
  modelo_num: string
  activa: boolean
  parametros: Record<string, unknown>
  created_at: string
}

// --- Avance ---

export interface Avance {
  id: string
  semana: string
  updated_at: string
}

export interface AvanceDetalle {
  id: string
  avance_id: string
  modelo_num: string
  dia: DayName
  pares: number
}

// --- Resultados ---

export interface Resultado {
  id: string
  nombre: string
  base_name: string
  version: number
  nota: string
  fecha_optimizacion: string
  weekly_schedule: WeeklyScheduleEntry[]
  weekly_summary: WeeklySummary
  daily_results: Record<string, DailyResult>
  pedido_snapshot: unknown[]
  params_snapshot: Record<string, unknown>
}

// --- Tipos de datos de optimización ---

export interface WeeklyScheduleEntry {
  Dia: string
  Modelo: string
  Fabrica: string
  Pares: number
  HC_Necesario: number
}

export interface WeeklySummary {
  status: string
  total_pares: number
  total_tardiness: number
  wall_time_s: number
  days: WeeklySummaryDay[]
  models: WeeklySummaryModel[]
}

export interface WeeklySummaryDay {
  dia: string
  pares: number
  hc_necesario: number
  hc_disponible: number
  utilizacion_pct: number
  overtime_hrs: number
  is_saturday: boolean
}

export interface WeeklySummaryModel {
  codigo: string
  volumen: number
  producido: number
  tardiness: number
  pct_completado: number
}

export interface DailyResult {
  status: string
  total_pares: number
  total_tardiness: number
  plantilla: number
  schedule: DailyScheduleEntry[]
  operator_timelines?: Record<string, OperatorTimelineEntry[]>
  unassigned_ops?: UnassignedOp[]
}

export interface DailyScheduleEntry {
  modelo: string
  fraccion: number
  operacion: string
  recurso: ResourceType
  rate: number
  hc: number
  etapa: string
  blocks: number[]
  total: number
  robot?: string
  operario?: string
  pendiente?: number
}

export interface OperatorTimelineEntry {
  block: number
  label: string
  modelo: string
  fraccion: number
  operacion: string
  recurso: string
  pares: number
  robot: string
}

export interface UnassignedOp {
  modelo: string
  fraccion: number
  operacion: string
  recurso: string
  total_pares: number
  parcial?: boolean
}

// --- API FastAPI ---

export interface OptimizeRequest {
  pedido_nombre: string
  semana: string
  nota: string
  reopt_from_day?: number | null
}

export interface OptimizeResponse {
  status: string
  total_pares: number
  tardiness: number
  wall_time: number
  saved_as: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  messages: ChatMessage[]
  pedido_nombre: string
  semana: string
  model: string
}

export interface ChatResponse {
  response: string
}

// --- Constantes ---

export const RESOURCE_TYPES: ResourceType[] = ['MESA', 'ROBOT', 'PLANA', 'POSTE', 'MAQUILA', 'GENERAL']

export const DAY_NAMES: DayName[] = ['Sab', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie']

/** Orden logico Lun→Sab para display en frontend */
export const DAY_ORDER: DayName[] = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab']

/** Restricciones TEMPORALES — cambian por semana, en pagina Restricciones */
export const CONSTRAINT_TYPES_TEMPORALES: ConstraintType[] = [
  'PRIORIDAD', 'RETRASO_MATERIAL', 'ROBOT_NO_DISPONIBLE',
  'AUSENCIA_OPERARIO', 'CAPACIDAD_DIA',
  'FIJAR_DIA', 'FECHA_LIMITE', 'AJUSTE_VOLUMEN',
]

/** Reglas PERMANENTES — sin semana, en Configuracion > Reglas y Catalogo > Reglas */
export const CONSTRAINT_TYPES_PERMANENTES: ConstraintType[] = [
  'PRECEDENCIA', 'LOTE_MINIMO_CUSTOM', 'SECUENCIA', 'AGRUPAR_MODELOS',
]

export const STAGE_COLORS: Record<string, string> = {
  PRELIMINAR: '#F59E0B',      // amarillo
  ROBOT: '#10B981',            // verde
  POST: '#EC4899',             // rosa
  'N/A PRELIMINAR': '#94A3B8', // blanco/gris claro
  MAQUILA: '#EF4444',          // rojo
}

export const RESOURCE_COLORS: Record<string, string> = {
  MESA: '#3B82F6',
  ROBOT: '#10B981',
  PLANA: '#F59E0B',
  POSTE: '#8B5CF6',
  MAQUILA: '#6B7280',
  GENERAL: '#94A3B8',
}

// --- Habilidades Granulares (20 skills) ---

export type SkillType =
  // Preliminar (9)
  | 'ARMADO_PALETS' | 'PISTOLA' | 'HEBILLAS' | 'DESHEBRADOS' | 'ALIMENTAR_LINEA'
  | 'MAQ_PINTURA' | 'REMACH_NEUMATICA' | 'REMACH_MECANICA' | 'PERFORADORA_JACK'
  // Robot (4) — no hay robots 2AG, solo 2A
  | 'ROBOT_3020' | 'ROBOT_CHACHE' | 'ROBOT_DOBLE_ACCION' | 'ROBOT_6040'
  // Pespunte Convencional (6)
  | 'ZIGZAG' | 'PLANA_RECTA' | 'DOS_AGUJAS' | 'POSTE_CONV' | 'RIBETE' | 'CODO'

export const SKILL_GROUPS: Record<string, { label: string; color: string; skills: SkillType[] }> = {
  PRELIMINAR: {
    label: 'Preliminares',
    color: '#F59E0B', // amber
    skills: [
      'ARMADO_PALETS', 'PISTOLA', 'HEBILLAS', 'DESHEBRADOS', 'ALIMENTAR_LINEA',
      'MAQ_PINTURA', 'REMACH_NEUMATICA', 'REMACH_MECANICA', 'PERFORADORA_JACK',
    ],
  },
  ROBOT: {
    label: 'Robots',
    color: '#10B981', // emerald
    skills: ['ROBOT_3020', 'ROBOT_CHACHE', 'ROBOT_6040'],
  },
  ROBOT_MOD: {
    label: 'Modificadores Robot',
    color: '#059669', // emerald-dark
    skills: ['ROBOT_DOBLE_ACCION'],
  },
  PESPUNTE_CONV: {
    label: 'Pespunte Convencional',
    color: '#3B82F6', // blue
    skills: ['ZIGZAG', 'PLANA_RECTA', 'DOS_AGUJAS', 'POSTE_CONV', 'RIBETE', 'CODO'],
  },
}

export const SKILL_LABELS: Record<SkillType, string> = {
  ARMADO_PALETS: 'Armado de Palets',
  PISTOLA: 'Uso de Pistola',
  HEBILLAS: 'Armado de Hebillas',
  DESHEBRADOS: 'Deshebrados',
  ALIMENTAR_LINEA: 'Alimentar Linea',
  MAQ_PINTURA: 'Maq. Pintura',
  REMACH_NEUMATICA: 'Remach. Neumatica',
  REMACH_MECANICA: 'Remach. Mecanica',
  PERFORADORA_JACK: 'Perforadora Jack',
  ROBOT_3020: '3020',
  ROBOT_CHACHE: 'Chache (4530)',
  ROBOT_6040: '6040',
  ROBOT_DOBLE_ACCION: 'Doble Accion (2A)',
  ZIGZAG: 'Zigzag',
  PLANA_RECTA: 'Plana-Recta',
  DOS_AGUJAS: '2 Agujas',
  POSTE_CONV: 'Poste',
  RIBETE: 'Ribete',
  CODO: 'Codo',
}

/** Derive resource types from skills (for optimizer compatibility) */
export function deriveRecursos(skills: SkillType[]): ResourceType[] {
  const set = new Set(skills)
  const recursos: ResourceType[] = []
  const PRELIM: SkillType[] = SKILL_GROUPS.PRELIMINAR.skills
  if (PRELIM.some((s) => set.has(s))) recursos.push('MESA')
  const robotSkills = [...SKILL_GROUPS.ROBOT.skills, ...SKILL_GROUPS.ROBOT_MOD.skills]
  if (robotSkills.some((s) => set.has(s))) recursos.push('ROBOT')
  if (set.has('PLANA_RECTA')) recursos.push('PLANA')
  if (set.has('POSTE_CONV')) recursos.push('POSTE')
  return recursos
}

// --- Constantes compartidas ---

export const BLOCK_LABELS = [
  '8-9', '9-10', '10-11', '11-12', '12-1',
  '1-2', 'COMIDA', '3-4', '4-5', '5-6', '6-7',
] as const

export const DEFAULT_CAPACITIES: Record<string, number> = {
  MESA: 15, ROBOT: 8, PLANA: 8, 'POSTE-LINEA': 6,
  'MESA-LINEA': 10, 'PLANA-LINEA': 8, GENERAL: 10,
}

export const CHART_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#14B8A6', '#F97316',
] as const

export const HEATMAP_COLORS = {
  empty: '#F3F4F6',
  low: '#BBF7D0',
  medium: '#FDE68A',
  high: '#FDBA74',
  critical: '#FCA5A5',
} as const
