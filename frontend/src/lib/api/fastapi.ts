import type { OptimizeRequest, OptimizeResponse, ChatRequest, ChatResponse } from '@/types'

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

async function fetchAPI<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers as Record<string, string> },
    ...options,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API error ${res.status}: ${body}`)
  }
  return res.json()
}

export async function runOptimization(req: OptimizeRequest): Promise<OptimizeResponse> {
  return fetchAPI<OptimizeResponse>('/api/optimize', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export async function sendChatMessage(req: ChatRequest): Promise<ChatResponse> {
  return fetchAPI<ChatResponse>('/api/chat', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export async function importCatalog(file: File): Promise<{ modelos_importados: number; total_operaciones: number }> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_URL}/api/import-catalog`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Import error ${res.status}`)
  return res.json()
}

export async function importPedido(nombre: string, file: File): Promise<{ nombre: string; items_importados: number }> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_URL}/api/import-pedido/${encodeURIComponent(nombre)}`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Import error ${res.status}`)
  return res.json()
}

/** Download Excel template for catalog/pedido import */
export async function downloadTemplate(): Promise<void> {
  const res = await fetch(`${API_URL}/api/template`, { method: 'GET' })
  if (!res.ok) throw new Error(`Download error ${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'template_pedido.xlsx'
  a.click()
  URL.revokeObjectURL(url)
}

/** Warm up Render free tier on page load */
export async function wakeUpAPI(): Promise<void> {
  try {
    await fetch(`${API_URL}/api/health`, { method: 'GET' })
  } catch {
    // silently ignore - just a warm up
  }
}
