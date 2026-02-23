'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAppStore } from '@/lib/store/useAppStore'
import {
  Database, ShieldAlert, MessageSquare, Users, Settings,
  CalendarDays, LayoutGrid, BarChart3, Bot, AlertTriangle, LogOut,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/hooks/useAuth'

interface NavItem {
  href: string
  label: string
  icon: React.ElementType
  minStep: 0 | 1 | 2
}

const NAV_ITEMS: NavItem[] = [
  { href: '/datos', label: 'Datos', icon: Database, minStep: 0 },
  { href: '/restricciones', label: 'Restricciones', icon: ShieldAlert, minStep: 0 },
  { href: '/asistente', label: 'Asistente', icon: MessageSquare, minStep: 0 },
  { href: '/operarios', label: 'Operarios', icon: Users, minStep: 0 },
  { href: '/configuracion', label: 'Configuracion', icon: Settings, minStep: 0 },
  { href: '/resumen', label: 'Resumen Semanal', icon: CalendarDays, minStep: 2 },
  { href: '/programa', label: 'Programa Diario', icon: LayoutGrid, minStep: 2 },
  { href: '/utilizacion', label: 'Utilizacion HC', icon: BarChart3, minStep: 2 },
  { href: '/robots', label: 'Robots', icon: Bot, minStep: 2 },
  { href: '/cuellos', label: 'Cuellos de Botella', icon: AlertTriangle, minStep: 2 },
]

export function Sidebar() {
  const pathname = usePathname()
  const appStep = useAppStore((s) => s.appStep)
  const { user, signOut } = useAuth()

  return (
    <aside className="flex h-screen w-56 flex-col border-r bg-card">
      {/* Logo / titulo */}
      <div className="flex items-center gap-2 border-b px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-bold">
          P
        </div>
        <div>
          <p className="text-sm font-semibold">Pespunte Agent</p>
          <p className="text-xs text-muted-foreground">
            {appStep === 0 && 'Sin datos'}
            {appStep === 1 && 'Pedido cargado'}
            {appStep === 2 && 'Optimizado'}
          </p>
        </div>
      </div>

      {/* Navegacion */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const disabled = appStep < item.minStep
            const active = pathname === item.href
            const Icon = item.icon

            return (
              <li key={item.href}>
                {disabled ? (
                  <span className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground/50 cursor-not-allowed">
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </span>
                ) : (
                  <Link
                    href={item.href}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                      active
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Usuario + logout */}
      {user && (
        <div className="border-t px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="truncate text-xs text-muted-foreground" title={user.email ?? ''}>
              {user.email}
            </span>
            <button
              onClick={signOut}
              className="ml-2 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              title="Cerrar sesion"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Step indicator */}
      <div className="border-t px-4 py-3">
        <div className="flex items-center gap-1">
          {[0, 1, 2].map((step) => (
            <div
              key={step}
              className={cn(
                'h-1.5 flex-1 rounded-full',
                step <= appStep ? 'bg-primary' : 'bg-muted',
              )}
            />
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground text-center">
          Paso {appStep + 1} de 3
        </p>
      </div>
    </aside>
  )
}
