'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import type {
  Pedido, PedidoItem, CatalogoModelo, Fabrica, ModeloFabrica,
  AsignacionMaquila, MaquilaOperacion,
} from '@/types'

export function usePedido() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [items, setItems] = useState<PedidoItem[]>([])
  const [currentPedidoId, setCurrentPedidoId] = useState<string | null>(null)
  const [catalogo, setCatalogo] = useState<CatalogoModelo[]>([])
  const [fabricas, setFabricas] = useState<Fabrica[]>([])
  const [modeloFabricas, setModeloFabricas] = useState<ModeloFabrica[]>([])
  const [maquilaOps, setMaquilaOps] = useState<Record<string, MaquilaOperacion[]>>({})
  const [asignaciones, setAsignaciones] = useState<AsignacionMaquila[]>([])
  const [maquilaFabricas, setMaquilaFabricas] = useState<Fabrica[]>([])
  const [loading, setLoading] = useState(true)

  const loadBase = useCallback(async () => {
    setLoading(true)
    const [pedRes, catRes, fabRes, mfRes, maqOpsRes] = await Promise.all([
      supabase.from('pedidos').select('*').order('created_at', { ascending: false }),
      supabase.from('catalogo_modelos').select('*').order('modelo_num'),
      supabase.from('fabricas').select('*').order('orden'),
      supabase.from('modelo_fabrica').select('*'),
      supabase
        .from('catalogo_operaciones')
        .select('fraccion, operacion, modelo_id, catalogo_modelos!inner(modelo_num)')
        .eq('recurso', 'MAQUILA')
        .order('fraccion'),
    ])
    if (pedRes.data) setPedidos(pedRes.data)
    if (catRes.data) setCatalogo(catRes.data)
    if (fabRes.data) {
      setFabricas(fabRes.data)
      setMaquilaFabricas(fabRes.data.filter((f: Fabrica) => f.es_maquila))
    }
    if (mfRes.data) setModeloFabricas(mfRes.data)

    // Build map: modelo_num → MaquilaOperacion[]
    const maqOpsMap: Record<string, MaquilaOperacion[]> = {}
    for (const op of maqOpsRes.data || []) {
      const modeloNum = (op.catalogo_modelos as unknown as { modelo_num: string }).modelo_num
      if (!maqOpsMap[modeloNum]) maqOpsMap[modeloNum] = []
      maqOpsMap[modeloNum].push({
        fraccion: op.fraccion,
        operacion: op.operacion,
        modelo_id: op.modelo_id,
      })
    }
    setMaquilaOps(maqOpsMap)

    setLoading(false)
  }, [])

  useEffect(() => { loadBase() }, [loadBase])

  async function loadPedido(pedidoId: string) {
    setCurrentPedidoId(pedidoId)
    const { data: itemsData } = await supabase
      .from('pedido_items')
      .select('*')
      .eq('pedido_id', pedidoId)
      .order('modelo_num')
    setItems(itemsData || [])

    // Load maquila assignments for all items
    const itemIds = (itemsData || []).map((it: PedidoItem) => it.id)
    if (itemIds.length > 0) {
      const { data: asigData } = await supabase
        .from('asignaciones_maquila')
        .select('*')
        .in('pedido_item_id', itemIds)
      setAsignaciones(asigData || [])
    } else {
      setAsignaciones([])
    }
  }

  async function createPedido(nombre: string): Promise<string | null> {
    const { data } = await supabase
      .from('pedidos')
      .upsert({ nombre }, { onConflict: 'nombre' })
      .select('id')
      .single()
    if (data) {
      await loadBase()
      return data.id
    }
    return null
  }

  async function deletePedido(id: string) {
    await supabase.from('pedidos').delete().eq('id', id)
    if (currentPedidoId === id) {
      setCurrentPedidoId(null)
      setItems([])
      setAsignaciones([])
    }
    await loadBase()
  }

  async function addItem(item: Omit<PedidoItem, 'id' | 'pedido_id'>, pedidoId?: string) {
    const pid = pedidoId || currentPedidoId
    if (!pid) return
    // Check if same modelo+color already exists — if so, sum volumen
    const existing = items.find(
      (it) => it.pedido_id === pid && it.modelo_num === item.modelo_num && it.color === item.color
    )
    if (existing) {
      await supabase.from('pedido_items')
        .update({ volumen: existing.volumen + item.volumen })
        .eq('id', existing.id)
    } else {
      await supabase.from('pedido_items').insert({
        ...item,
        pedido_id: pid,
      })
    }
    await loadPedido(pid)
  }

  async function updateItem(id: string, data: Partial<PedidoItem>) {
    await supabase.from('pedido_items').update(data).eq('id', id)
    if (currentPedidoId) await loadPedido(currentPedidoId)
  }

  async function deleteItem(id: string) {
    await supabase.from('pedido_items').delete().eq('id', id)
    if (currentPedidoId) await loadPedido(currentPedidoId)
  }

  async function saveItems(pedidoId: string, newItems: Omit<PedidoItem, 'id' | 'pedido_id'>[]) {
    // Replace all items (CASCADE deletes asignaciones_maquila too)
    await supabase.from('pedido_items').delete().eq('pedido_id', pedidoId)
    if (newItems.length > 0) {
      await supabase.from('pedido_items').insert(
        newItems.map((it) => ({ ...it, pedido_id: pedidoId }))
      )
    }
    await loadPedido(pedidoId)
  }

  // --- Maquila assignments ---

  async function addMaquilaAssignment(
    pedidoItemId: string, maquila: string, pares: number, fracciones: number[]
  ) {
    await supabase
      .from('asignaciones_maquila')
      .upsert(
        { pedido_item_id: pedidoItemId, maquila, pares, fracciones },
        { onConflict: 'pedido_item_id,maquila' }
      )
    if (currentPedidoId) await loadPedido(currentPedidoId)
  }

  async function updateMaquilaAssignment(id: string, data: { pares?: number; fracciones?: number[] }) {
    await supabase.from('asignaciones_maquila').update(data).eq('id', id)
    if (currentPedidoId) await loadPedido(currentPedidoId)
  }

  async function setAllMaquilaForItem(
    pedidoItemId: string, modeloNum: string, maquila: string, volumen: number
  ) {
    const ops = maquilaOps[modeloNum] || []
    if (ops.length === 0) return
    const fracciones = ops.map((op) => op.fraccion)
    await supabase.from('asignaciones_maquila').delete().eq('pedido_item_id', pedidoItemId)
    await supabase.from('asignaciones_maquila').insert({
      pedido_item_id: pedidoItemId, maquila, pares: volumen, fracciones,
    })
    if (currentPedidoId) await loadPedido(currentPedidoId)
  }

  async function removeMaquilaAssignment(asignacionId: string) {
    await supabase.from('asignaciones_maquila').delete().eq('id', asignacionId)
    if (currentPedidoId) await loadPedido(currentPedidoId)
  }

  async function clearMaquilaAssignments(pedidoItemId: string) {
    await supabase.from('asignaciones_maquila').delete().eq('pedido_item_id', pedidoItemId)
    if (currentPedidoId) await loadPedido(currentPedidoId)
  }

  function consolidateDuplicates() {
    const map = new Map<string, PedidoItem>()
    for (const it of items) {
      const key = `${it.modelo_num}|${it.color}|${it.clave_material}|${it.fabrica}`
      const existing = map.get(key)
      if (existing) {
        existing.volumen += it.volumen
      } else {
        map.set(key, { ...it })
      }
    }
    return Array.from(map.values())
  }

  function getFabricaForModelo(modeloNum: string): string {
    const cat = catalogo.find((m) => m.modelo_num === modeloNum)
    if (!cat) return ''
    const mf = modeloFabricas.find((m) => m.modelo_id === cat.id)
    if (!mf) return ''
    const fab = fabricas.find((f) => f.id === mf.fabrica_id)
    return fab?.nombre || ''
  }

  const totalPares = items.reduce((sum, it) => sum + it.volumen, 0)
  const modelosUnicos = new Set(items.map((it) => it.modelo_num)).size

  return {
    loading, pedidos, items, currentPedidoId, catalogo, fabricas,
    totalPares, modelosUnicos,
    loadPedido, createPedido, deletePedido,
    addItem, updateItem, deleteItem, saveItems,
    consolidateDuplicates, getFabricaForModelo,
    reload: loadBase,
    // Maquila
    maquilaOps, asignaciones, maquilaFabricas,
    addMaquilaAssignment, updateMaquilaAssignment,
    setAllMaquilaForItem, removeMaquilaAssignment, clearMaquilaAssignments,
  }
}
