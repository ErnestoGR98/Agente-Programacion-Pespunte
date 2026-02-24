'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  onConfirm: () => void | Promise<void>
  confirmWord?: string
  variant?: 'destructive' | 'default'
}

export function ConfirmDialog({
  open, onOpenChange, title, description, onConfirm,
  confirmWord = 'CONFIRMAR',
  variant = 'destructive',
}: Props) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) setInput('')
  }, [open])

  const isMatch = input.trim().toUpperCase() === confirmWord.toUpperCase()

  async function handleConfirm() {
    if (!isMatch) return
    setLoading(true)
    await onConfirm()
    setLoading(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Escribe <span className="font-mono font-bold">{confirmWord}</span> para confirmar:
          </p>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={confirmWord}
            className="h-8 font-mono"
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={variant}
              onClick={handleConfirm}
              disabled={!isMatch || loading}
            >
              {loading ? 'Procesando...' : 'Confirmar'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
