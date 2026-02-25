'use client'

import { useEffect } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { ChatWidget } from '@/components/shared/ChatWidget'
import { wakeUpAPI } from '@/lib/api/fastapi'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Warm up Render API on first load
  useEffect(() => {
    wakeUpAPI()
  }, [])

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
      <ChatWidget />
    </div>
  )
}
