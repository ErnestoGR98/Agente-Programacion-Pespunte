'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Sidebar, SidebarContext } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { ChatWidget } from '@/components/shared/ChatWidget'
import { wakeUpAPI } from '@/lib/api/fastapi'
import { useProfile } from '@/lib/hooks/useProfile'
import { isRouteAllowed } from '@/lib/permissions'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const { isAdmin, loading: loadingProfile } = useProfile()

  // Warm up Render API on first load
  useEffect(() => {
    wakeUpAPI()
  }, [])

  // Guard: redirige no-admin a /planeacion si intenta entrar a una ruta no permitida
  useEffect(() => {
    if (loadingProfile) return
    if (isRouteAllowed(pathname, isAdmin)) return
    router.replace('/planeacion')
  }, [loadingProfile, isAdmin, pathname, router])

  // Mientras decidimos si el rol tiene acceso, no rendereamos contenido
  // (evita flash de paginas no autorizadas para usuarios no-admin)
  const allowed = !loadingProfile && isRouteAllowed(pathname, isAdmin)

  return (
    <SidebarContext.Provider value={{ open, setOpen, pinned, setPinned }}>
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          <TopBar />
          <main className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6">
            {allowed ? children : null}
          </main>
        </div>
        {isAdmin && <ChatWidget />}
      </div>
    </SidebarContext.Provider>
  )
}
