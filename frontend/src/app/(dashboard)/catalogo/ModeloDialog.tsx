'use client'

import { useState, useEffect, useRef } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ImagePlus, X } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  modelo?: { id: string; modelo_num: string; alternativas: string[]; imagen_url?: string | null } | null
  onSave: (data: {
    id?: string; modeloNum: string; codigoFull: string; claveMaterial: string
    alternativas: string[]; imageFile?: File | null
  }) => Promise<void>
}

export function ModeloDialog({ open, onOpenChange, modelo, onSave }: Props) {
  const [modeloNum, setModeloNum] = useState('')
  const [alternativas, setAlternativas] = useState('')
  const [saving, setSaving] = useState(false)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setModeloNum(modelo?.modelo_num || '')
      setAlternativas(modelo?.alternativas?.join(', ') || '')
      setImageFile(null)
      setImagePreview(modelo?.imagen_url || null)
    }
  }, [open, modelo])

  const isValid = /^\d{5}$/.test(modeloNum.trim())

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    const reader = new FileReader()
    reader.onload = () => setImagePreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  async function handleSave() {
    if (!isValid) return
    setSaving(true)
    const alts = alternativas
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const num = modeloNum.trim()
    const codigoFull = alts.length > 0 ? `${num} ${alts.join('/')}` : num
    await onSave({
      id: modelo?.id,
      modeloNum: num,
      codigoFull,
      claveMaterial: '',
      alternativas: alts,
      imageFile: imageFile,
    })
    setSaving(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{modelo ? 'Editar Modelo' : 'Nuevo Modelo'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {/* Imagen */}
          <div className="space-y-1">
            <Label className="text-xs">Imagen del modelo</Label>
            <div className="flex items-center gap-3">
              {imagePreview ? (
                <div className="relative">
                  <img
                    src={imagePreview}
                    alt="Preview"
                    className="h-20 w-20 rounded border object-cover"
                  />
                  <button
                    className="absolute -top-1.5 -right-1.5 rounded-full bg-destructive p-0.5 text-white"
                    onClick={() => { setImageFile(null); setImagePreview(null) }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <button
                  className="flex h-20 w-20 items-center justify-center rounded border-2 border-dashed border-muted-foreground/30 text-muted-foreground hover:border-foreground/50 hover:text-foreground transition-colors"
                  onClick={() => fileRef.current?.click()}
                >
                  <ImagePlus className="h-6 w-6" />
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleFileChange}
              />
              {imagePreview && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => fileRef.current?.click()}
                >
                  Cambiar
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Numero de Modelo *</Label>
            <Input
              value={modeloNum}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 5)
                setModeloNum(v)
              }}
              placeholder="65413"
              maxLength={5}
              className="h-8 font-mono"
            />
            {modeloNum.length > 0 && modeloNum.length < 5 && (
              <span className="text-[10px] text-muted-foreground">{5 - modeloNum.length} digitos restantes</span>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Alternativas de color (separadas por coma)</Label>
            <Input
              value={alternativas}
              onChange={(e) => setAlternativas(e.target.value)}
              placeholder="NE, GC"
              className="h-8"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button size="sm" onClick={handleSave} disabled={saving || !isValid}>
              {saving ? 'Guardando...' : 'Guardar'}
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
