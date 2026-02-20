'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { Pedido, PedidoItem, CatalogoModelo, Fabrica } from '@/types'

export function usePedido() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [items, setItems] = useState<PedidoItem[]>([])
  const [currentPedidoId, setCurrentPedidoId] = useState<string | null>(null)
  const [catalogo, setCatalogo] = useState<CatalogoModelo[]>([])
  const [fabricas, setFabricas] = useState<Fabrica[]>([])
  const [loading, setLoading] = useState(true)

  const loadBase = useCallback(async () => {
    setLoading(true)
    const [pedRes, catRes, fabRes] = await Promise.all([
      supabase.from('pedidos').select('*').order('created_at', { ascending: false }),
      supabase.from('catalogo_modelos').select('*').order('modelo_num'),
      supabase.from('fabricas').select('*').order('orden'),
    ])
    if (pedRes.data) setPedidos(pedRes.data)
    if (catRes.data) setCatalogo(catRes.data)
    if (fabRes.data) setFabricas(fabRes.data)
    setLoading(false)
  }, [])

  useEffect(() => { loadBase() }, [loadBase])

  async function loadPedido(pedidoId: string) {
    setCurrentPedidoId(pedidoId)
    const { data } = await supabase
      .from('pedido_items')
      .select('*')
      .eq('pedido_id', pedidoId)
      .order('modelo_num')
    setItems(data || [])
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
    }
    await loadBase()
  }

  async function addItem(item: Omit<PedidoItem, 'id' | 'pedido_id'>) {
    if (!currentPedidoId) return
    await supabase.from('pedido_items').insert({
      ...item,
      pedido_id: currentPedidoId,
    })
    await loadPedido(currentPedidoId)
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
    // Replace all items
    await supabase.from('pedido_items').delete().eq('pedido_id', pedidoId)
    if (newItems.length > 0) {
      await supabase.from('pedido_items').insert(
        newItems.map((it) => ({ ...it, pedido_id: pedidoId }))
      )
    }
    await loadPedido(pedidoId)
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

  const totalPares = items.reduce((sum, it) => sum + it.volumen, 0)
  const modelosUnicos = new Set(items.map((it) => it.modelo_num)).size

  return {
    loading, pedidos, items, currentPedidoId, catalogo, fabricas,
    totalPares, modelosUnicos,
    loadPedido, createPedido, deletePedido,
    addItem, updateItem, deleteItem, saveItems,
    consolidateDuplicates,
    reload: loadBase,
  }
}
