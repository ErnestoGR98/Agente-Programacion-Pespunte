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
  modelo?: {
    id: string; modelo_num: string; alternativas: string[]
    imagen_url?: string | null; alternativas_imagenes?: Record<string, string>
  } | null
  onSave: (data: {
    id?: string; modeloNum: string; codigoFull: string; claveMaterial: string
    alternativas: string[]; imageFile?: File | null
    altImageFiles?: Record<string, File>
  }) => Promise<void>
}

export function ModeloDialog({ open, onOpenChange, modelo, onSave }: Props) {
  const [modeloNum, setModeloNum] = useState('')
  const [alternativas, setAlternativas] = useState('')
  const [saving, setSaving] = useState(false)
  // Single image (when no alternativas)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  // Per-alternativa images
  const [altImages, setAltImages] = useState<Record<string, File | null>>({})
  const [altPreviews, setAltPreviews] = useState<Record<string, string | null>>({})
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const mainFileRef = useRef<HTMLInputElement>(null)

  const parsedAlts = alternativas.split(',').map((s) => s.trim()).filter(Boolean)

  useEffect(() => {
    if (open) {
      setModeloNum(modelo?.modelo_num || '')
      setAlternativas(modelo?.alternativas?.join(', ') || '')
      setImageFile(null)
      setImagePreview(modelo?.imagen_url || null)
      setAltImages({})
      setAltPreviews(modelo?.alternativas_imagenes || {})
      setDraggingKey(null)
    }
  }, [open, modelo])

  const isValid = /^\d{5}$/.test(modeloNum.trim())

  function processFileForAlt(alt: string, file: File) {
    if (!file.type.startsWith('image/')) return
    setAltImages((prev) => ({ ...prev, [alt]: file }))
    const reader = new FileReader()
    reader.onload = () => setAltPreviews((prev) => ({ ...prev, [alt]: reader.result as string }))
    reader.readAsDataURL(file)
  }

  function processMainFile(file: File) {
    if (!file.type.startsWith('image/')) return
    setImageFile(file)
    const reader = new FileReader()
    reader.onload = () => setImagePreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  function removeAltImage(alt: string) {
    setAltImages((prev) => { const n = { ...prev }; delete n[alt]; return n })
    setAltPreviews((prev) => { const n = { ...prev }; delete n[alt]; return n })
  }

  async function handleSave() {
    if (!isValid) return
    setSaving(true)
    const alts = parsedAlts
    const num = modeloNum.trim()
    const codigoFull = alts.length > 0 ? `${num} ${alts.join('/')}` : num
    // Collect new alt image files
    const altImageFiles: Record<string, File> = {}
    for (const [alt, file] of Object.entries(altImages)) {
      if (file && alts.includes(alt)) altImageFiles[alt] = file
    }
    await onSave({
      id: modelo?.id,
      modeloNum: num,
      codigoFull,
      claveMaterial: '',
      alternativas: alts,
      imageFile: parsedAlts.length === 0 ? imageFile : null,
      altImageFiles: parsedAlts.length > 0 ? altImageFiles : undefined,
    })
    setSaving(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{modelo ? 'Editar Modelo' : 'Nuevo Modelo'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
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

          {/* Images per alternativa */}
          {parsedAlts.length > 0 ? (
            <div className="space-y-2">
              <Label className="text-xs">Imagenes por alternativa</Label>
              <div className="grid grid-cols-2 gap-2">
                {parsedAlts.map((alt) => {
                  const preview = altPreviews[alt] || null
                  return (
                    <div key={alt} className="space-y-1">
                      <span className="text-[10px] font-semibold text-muted-foreground">{alt}</span>
                      {preview ? (
                        <div className="relative inline-block">
                          <img
                            src={preview}
                            alt={alt}
                            className="h-20 w-20 rounded border object-contain bg-white"
                          />
                          <button
                            className="absolute -top-1.5 -right-1.5 rounded-full bg-destructive p-0.5 text-white"
                            onClick={() => removeAltImage(alt)}
                          >
                            <X className="h-3 w-3" />
                          </button>
                          <button
                            className="mt-1 text-[10px] text-primary hover:underline block"
                            onClick={() => fileRefs.current[alt]?.click()}
                          >
                            Cambiar
                          </button>
                        </div>
                      ) : (
                        <button
                          className={`flex h-20 w-full items-center justify-center gap-1 rounded border-2 border-dashed transition-colors ${
                            draggingKey === alt
                              ? 'border-primary bg-primary/5 text-primary'
                              : 'border-muted-foreground/30 text-muted-foreground hover:border-foreground/50 hover:text-foreground'
                          }`}
                          onClick={() => fileRefs.current[alt]?.click()}
                          onDragOver={(e) => { e.preventDefault(); setDraggingKey(alt) }}
                          onDragLeave={() => setDraggingKey(null)}
                          onDrop={(e) => {
                            e.preventDefault()
                            setDraggingKey(null)
                            const file = e.dataTransfer.files?.[0]
                            if (file) processFileForAlt(alt, file)
                          }}
                        >
                          <ImagePlus className="h-4 w-4" />
                          <span className="text-[10px]">{alt}</span>
                        </button>
                      )}
                      <input
                        ref={(el) => { fileRefs.current[alt] = el }}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/avif"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) processFileForAlt(alt, file)
                        }}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            /* Single image when no alternativas */
            <div className="space-y-1">
              <Label className="text-xs">Imagen del modelo</Label>
              <div className="flex items-center gap-3">
                {imagePreview ? (
                  <div className="relative">
                    <img
                      src={imagePreview}
                      alt="Preview"
                      className="h-20 w-20 rounded border object-contain bg-white"
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
                    className={`flex h-20 w-full items-center justify-center gap-2 rounded border-2 border-dashed transition-colors ${
                      draggingKey === '_main'
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-muted-foreground/30 text-muted-foreground hover:border-foreground/50 hover:text-foreground'
                    }`}
                    onClick={() => mainFileRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDraggingKey('_main') }}
                    onDragLeave={() => setDraggingKey(null)}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDraggingKey(null)
                      const file = e.dataTransfer.files?.[0]
                      if (file) processMainFile(file)
                    }}
                  >
                    <ImagePlus className="h-5 w-5" />
                    <span className="text-xs">Click o arrastra imagen</span>
                  </button>
                )}
                <input
                  ref={mainFileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/avif"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) processMainFile(file)
                  }}
                />
                {imagePreview && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => mainFileRef.current?.click()}
                  >
                    Cambiar
                  </Button>
                )}
              </div>
            </div>
          )}

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
