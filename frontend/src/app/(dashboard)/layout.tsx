'use client'

import { useEffect, useState } from 'react'
import { Sidebar, SidebarContext, MenuButton } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { ChatWidget } from '@/components/shared/ChatWidget'
import { wakeUpAPI } from '@/lib/api/fastapi'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)

  // Warm up Render API on first load
  useEffect(() => {
    wakeUpAPI()
  }, [])

  return (
    <SidebarContext.Provider value={{ open, setOpen, pinned, setPinned }}>
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          <TopBar />
          <main className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6">
            {children}
          </main>
        </div>
        <ChatWidget />
      </div>
    </SidebarContext.Provider>
  )
}
