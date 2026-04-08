/**
 * Cliente API para el módulo Balance Backlog.
 * Wrappea POST /api/balance-backlog (Excel upload o JSON manual).
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

export interface CatalogoModelo {
  modelo_num: string
  label: string
  total_seg_par: number
  robot_restringido: boolean
  imagen_url?: string
}

export interface ResumenSemana {
  semana: number
  pares: number
  horas_robot: number
  pct_capacidad: number
  n_modelos: number
}

export interface ResumenModelo {
  modelo: string
  total: number
  distribucion: Record<string, number>
  robot_restringido: boolean
  sin_catalogo: boolean
  imagen_url?: string
}

export interface ResumenMeta {
  max_mod_pedido?: number
  max_mod_usado?: number
  max_mod_real?: number
  min_factible?: number
  ajustado?: boolean
  intentos?: number[]
  demanda_model_weeks?: number
}

export interface ResumenBacklog {
  semanas: number[]
  capacidad_robot_sem: number
  robots_activos: number
  por_semana: ResumenSemana[]
  por_modelo: ResumenModelo[]
  errores: string[]
  meta?: ResumenMeta
}

export interface BalanceBacklogResult {
  blob: Blob
  filename: string
  resumen: ResumenBacklog
}

export interface ManualPayload {
  sem_inicio: number
  sem_fin: number
  modelos: { nombre: string; total: number }[]
}

export interface BalanceOptions {
  max_modelos?: number
  max_sem?: number
  excluir?: string
  fijar?: string
  no_aislar?: string
}

export async function downloadPlantillaBacklog(): Promise<void> {
  const res = await fetch(`${API_URL}/api/balance-backlog/plantilla`)
  if (!res.ok) throw new Error(`Error ${res.status} al descargar plantilla`)
  const blob = await res.blob()
  downloadBlob(blob, 'Backlog_Plantilla.xlsx')
}

export async function fetchCatalogoBacklog(): Promise<CatalogoModelo[]> {
  const res = await fetch(`${API_URL}/api/balance-backlog/catalogo`)
  if (!res.ok) throw new Error(`Error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.modelos || []
}

async function postBalance(form: FormData): Promise<BalanceBacklogResult> {
  const res = await fetch(`${API_URL}/api/balance-backlog`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Error ${res.status}: ${body}`)
  }
  const blob = await res.blob()
  // Filename
  let filename = 'Backlog_OPTIMIZADO.xlsx'
  const cd = res.headers.get('Content-Disposition')
  if (cd) {
    const m = cd.match(/filename="([^"]+)"/)
    if (m) filename = m[1]
  }
  // Resumen
  let resumen: ResumenBacklog = {
    semanas: [], capacidad_robot_sem: 0, robots_activos: 0,
    por_semana: [], por_modelo: [], errores: [],
  }
  const xResumen = res.headers.get('X-Resumen')
  if (xResumen) {
    try { resumen = JSON.parse(xResumen) } catch { /* ignore */ }
  }
  return { blob, filename, resumen }
}

export async function balanceFromExcel(
  file: File,
  opts: BalanceOptions = {},
): Promise<BalanceBacklogResult> {
  const form = new FormData()
  form.append('file', file)
  if (opts.max_modelos != null) form.append('max_modelos', String(opts.max_modelos))
  if (opts.max_sem != null) form.append('max_sem', String(opts.max_sem))
  if (opts.excluir) form.append('excluir', opts.excluir)
  if (opts.fijar) form.append('fijar', opts.fijar)
  if (opts.no_aislar) form.append('no_aislar', opts.no_aislar)
  return postBalance(form)
}

export async function balanceFromManual(
  payload: ManualPayload,
  opts: BalanceOptions = {},
): Promise<BalanceBacklogResult> {
  const form = new FormData()
  form.append('payload', JSON.stringify(payload))
  if (opts.max_modelos != null) form.append('max_modelos', String(opts.max_modelos))
  if (opts.max_sem != null) form.append('max_sem', String(opts.max_sem))
  if (opts.excluir) form.append('excluir', opts.excluir)
  if (opts.fijar) form.append('fijar', opts.fijar)
  if (opts.no_aislar) form.append('no_aislar', opts.no_aislar)
  return postBalance(form)
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
