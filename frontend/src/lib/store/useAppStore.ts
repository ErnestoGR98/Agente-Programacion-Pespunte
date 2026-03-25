import { create } from 'zustand'
import type { Resultado, DayName } from '@/types'

/** Draft row for the weekly planner */
export interface WeeklyDraftRow {
  modelo_num: string
  color: string
  fabrica: string
  pedido: number
  days: Record<DayName, number>
}

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

  // Weekly planner draft (survives tab switches)
  weeklyDraft: WeeklyDraftRow[] | null
  weeklyDraftSemana: string | null
  setWeeklyDraft: (rows: WeeklyDraftRow[], semana: string) => void
  clearWeeklyDraft: () => void

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

  weeklyDraft: null,
  weeklyDraftSemana: null,
  setWeeklyDraft: (rows, semana) => set({
    weeklyDraft: rows,
    weeklyDraftSemana: semana,
  }),
  clearWeeklyDraft: () => set({
    weeklyDraft: null,
    weeklyDraftSemana: null,
  }),

  reset: () => set({
    appStep: 0,
    currentPedidoNombre: null,
    currentSemana: null,
    currentResult: null,
    weeklyDraft: null,
    weeklyDraftSemana: null,
  }),
}))
