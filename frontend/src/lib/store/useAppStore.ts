import { create } from 'zustand'
import type { Resultado } from '@/types'

interface AppStore {
  // Pipeline step: 0=sin datos, 1=pedido cargado, 2=optimizado
  appStep: 0 | 1 | 2
  setAppStep: (step: 0 | 1 | 2) => void

  // Pedido y semana actuales
  currentPedidoNombre: string | null
  currentSemana: string | null
  setCurrentPedido: (nombre: string, semana: string) => void

  // Resultado de optimización cargado
  currentResult: Resultado | null
  setCurrentResult: (result: Resultado | null) => void

  // Reset
  reset: () => void
}

export const useAppStore = create<AppStore>((set) => ({
  appStep: 0,
  setAppStep: (step) => set({ appStep: step }),

  currentPedidoNombre: null,
  currentSemana: null,
  setCurrentPedido: (nombre, semana) => set({
    currentPedidoNombre: nombre,
    currentSemana: semana,
    appStep: 1,
  }),

  currentResult: null,
  setCurrentResult: (result) => set({
    currentResult: result,
    appStep: result ? 2 : 1,
  }),

  reset: () => set({
    appStep: 0,
    currentPedidoNombre: null,
    currentSemana: null,
    currentResult: null,
  }),
}))
