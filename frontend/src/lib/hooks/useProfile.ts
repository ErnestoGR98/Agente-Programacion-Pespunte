'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { UserRol } from '@/lib/permissions'

export function useProfile() {
  const [rol, setRol] = useState<UserRol | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        if (mounted) { setRol(null); setLoading(false) }
        return
      }
      const { data } = await supabase
        .from('profiles')
        .select('rol')
        .eq('id', user.id)
        .maybeSingle()
      if (!mounted) return
      setRol(((data?.rol as UserRol) ?? 'usuario'))
      setLoading(false)
    }

    load()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      load()
    })

    return () => { mounted = false; subscription.unsubscribe() }
  }, [])

  return { rol, isAdmin: rol === 'admin', loading }
}
