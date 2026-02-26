'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useAppStore } from '@/lib/store/useAppStore'
import { sendChatMessage } from '@/lib/api/fastapi'
import { supabase } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Send, Trash2, MessageSquare, X, Minimize2, Paperclip, FileSpreadsheet } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import * as XLSX from 'xlsx'
import type { ChatMessage, ChatAttachment } from '@/types'

const SUGGESTIONS = [
  '¿Cuantos pares se producen esta semana?',
  '¿Que modelos tienen tardiness?',
  '¿Como esta la utilizacion por dia?',
  '¿Que restricciones estan activas?',
]

const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

const MIN_W = 350
const MIN_H = 400
const MAX_W = 900
const MAX_H = 900
const DEFAULT_W = 384
const DEFAULT_H = 512

export function ChatWidget() {
  const { currentPedidoNombre, currentSemana } = useAppStore()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H })
  const [pos, setPos] = useState({ bottom: 24, right: 24 })
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const resizingRef = useRef(false)
  const draggingRef = useRef(false)

  const semanaKey = currentSemana || currentPedidoNombre || 'general'

  const loadHistory = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('chat_messages')
      .select('role, content, attachments')
      .eq('semana', semanaKey)
      .order('created_at', { ascending: true })
    if (data) {
      setMessages(data.map((d) => ({
        role: d.role as 'user' | 'assistant',
        content: d.content,
        attachments: d.attachments || undefined,
      })))
    } else {
      setMessages([])
    }
    setLoading(false)
    setLoaded(true)
  }, [semanaKey])

  useEffect(() => {
    if (open && !loaded) {
      loadHistory()
    }
  }, [open, loaded, loadHistory])

  useEffect(() => {
    setLoaded(false)
  }, [semanaKey])

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, open])

  async function saveMessage(msg: ChatMessage) {
    // Strip base64 data from attachments for DB storage (keep metadata only)
    const dbAttachments = msg.attachments?.map((att) => ({
      type: att.type,
      filename: att.filename,
      mime_type: att.mime_type,
      size: att.size,
      preview: att.preview,
    })) || null

    await supabase.from('chat_messages').insert({
      semana: semanaKey,
      role: msg.role,
      content: msg.content,
      attachments: dbAttachments,
    })
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > MAX_FILE_SIZE) {
      alert('Archivo demasiado grande. Maximo 2MB.')
      return
    }

    const isImage = ACCEPTED_IMAGE_TYPES.includes(file.type)
    const isExcel = file.name.endsWith('.xlsx')

    if (!isImage && !isExcel) {
      alert('Solo se aceptan imagenes (PNG, JPG, GIF, WebP) y Excel (.xlsx)')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1]
      const attachment: ChatAttachment = {
        type: isImage ? 'image' : 'excel',
        filename: file.name,
        mime_type: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        data: base64,
        size: file.size,
      }

      // Generate Excel preview
      if (isExcel) {
        try {
          const wb = XLSX.read(base64, { type: 'base64' })
          const firstSheet = wb.SheetNames[0]
          if (firstSheet) {
            const ws = wb.Sheets[firstSheet]
            attachment.preview = XLSX.utils.sheet_to_csv(ws, { FS: ' | ' })
              .split('\n')
              .slice(0, 10)
              .join('\n')
          }
        } catch {
          attachment.preview = '(no se pudo previsualizar)'
        }
      }

      setAttachments((prev) => [...prev, attachment])
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  async function handleSend(text?: string) {
    const content = text || input.trim()
    if (!content && attachments.length === 0) return

    const userMsg: ChatMessage = {
      role: 'user',
      content: content || `[Adjunto: ${attachments.map((a) => a.filename).join(', ')}]`,
      attachments: attachments.length > 0 ? [...attachments] : undefined,
    }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setAttachments([])
    setSending(true)

    await saveMessage(userMsg)

    try {
      const res = await sendChatMessage({
        messages: newMessages,
        pedido_nombre: currentPedidoNombre || '',
        semana: currentSemana || '',
        model: 'claude-sonnet-4-6',
      })
      const assistantMsg: ChatMessage = { role: 'assistant', content: res.response }
      setMessages([...newMessages, assistantMsg])
      await saveMessage(assistantMsg)
    } catch (err) {
      const errorMsg: ChatMessage = {
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'No se pudo conectar con el asistente'}`,
      }
      setMessages([...newMessages, errorMsg])
      await saveMessage(errorMsg)
    }
    setSending(false)
  }

  async function handleClear() {
    await supabase.from('chat_messages').delete().eq('semana', semanaKey)
    setMessages([])
    setAttachments([])
  }

  function handleResizeStart(e: React.MouseEvent) {
    e.preventDefault()
    resizingRef.current = true
    const startX = e.clientX
    const startY = e.clientY
    const startW = size.w
    const startH = size.h

    function onMouseMove(ev: MouseEvent) {
      if (!resizingRef.current) return
      // Drag top-left corner: moving left increases width, moving up increases height
      const dw = startX - ev.clientX
      const dh = startY - ev.clientY
      setSize({
        w: Math.min(MAX_W, Math.max(MIN_W, startW + dw)),
        h: Math.min(MAX_H, Math.max(MIN_H, startH + dh)),
      })
    }

    function onMouseUp() {
      resizingRef.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  function handleDragStart(e: React.MouseEvent) {
    // Don't drag if clicking buttons inside header
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    draggingRef.current = true
    const startX = e.clientX
    const startY = e.clientY
    const startRight = pos.right
    const startBottom = pos.bottom

    function onMouseMove(ev: MouseEvent) {
      if (!draggingRef.current) return
      const dr = startX - ev.clientX
      const db = startY - ev.clientY
      setPos({
        right: Math.max(0, Math.min(window.innerWidth - size.w, startRight + dr)),
        bottom: Math.max(0, Math.min(window.innerHeight - size.h, startBottom + db)),
      })
    }

    function onMouseUp() {
      draggingRef.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{ bottom: pos.bottom, right: pos.right }}
          className="fixed z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-all hover:scale-105 flex items-center justify-center"
        >
          <MessageSquare className="h-6 w-6" />
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div
          style={{ width: size.w, height: size.h, bottom: pos.bottom, right: pos.right }}
          className="fixed z-50 flex flex-col bg-background border rounded-xl shadow-2xl overflow-hidden"
        >
          {/* Resize handle — top-left corner */}
          <div
            onMouseDown={handleResizeStart}
            className="absolute top-0 left-0 w-4 h-4 cursor-nw-resize z-10 group"
          >
            <svg className="w-3 h-3 m-0.5 text-muted-foreground/50 group-hover:text-muted-foreground" viewBox="0 0 12 12">
              <path d="M0 12L12 0M0 8L8 0M0 4L4 0" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </div>

          {/* Header — draggable */}
          <div
            onMouseDown={handleDragStart}
            className="flex items-center justify-between px-4 py-3 border-b bg-primary text-primary-foreground cursor-move select-none"
          >
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              <span className="font-medium text-sm">Asistente</span>
              {semanaKey !== 'general' && (
                <span className="text-xs opacity-75">({semanaKey})</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  onClick={handleClear}
                  className="p-1 rounded hover:bg-white/20 transition-colors"
                  title="Limpiar conversacion"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded hover:bg-white/20 transition-colors"
                title="Minimizar"
              >
                <Minimize2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading && (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loading && messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <p className="text-sm text-muted-foreground">Pregunta sobre tu programacion</p>
                <div className="grid grid-cols-1 gap-1.5 w-full px-2">
                  {SUGGESTIONS.map((s) => (
                    <Button
                      key={s}
                      variant="outline"
                      size="sm"
                      className="text-[11px] h-auto py-1.5 whitespace-normal text-left justify-start"
                      onClick={() => handleSend(s)}
                    >
                      {s}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  }`}
                >
                  {/* Attachments display */}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex gap-1.5 mb-1.5 flex-wrap">
                      {msg.attachments.map((att, j) => (
                        att.type === 'image' && att.data ? (
                          <img
                            key={j}
                            src={`data:${att.mime_type};base64,${att.data}`}
                            alt={att.filename}
                            className="max-h-32 max-w-[200px] rounded border border-white/20"
                          />
                        ) : (
                          <div key={j} className="flex items-center gap-1 text-[10px] bg-white/10 rounded px-1.5 py-0.5">
                            <FileSpreadsheet className="h-3 w-3" />
                            {att.filename}
                          </div>
                        )
                      ))}
                    </div>
                  )}

                  {msg.role === 'assistant' ? (
                    <div className="prose prose-xs dark:prose-invert max-w-none text-xs [&_table]:text-[10px] [&_table]:border-collapse [&_table]:border [&_table]:border-border [&_th]:px-1.5 [&_th]:py-0.5 [&_th]:border [&_th]:border-border [&_th]:bg-muted/50 [&_td]:px-1.5 [&_td]:py-0.5 [&_td]:border [&_td]:border-border [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_pre]:text-[10px] [&_code]:text-[10px]">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap text-xs">{msg.content}</div>
                  )}
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-3 py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Attachment preview strip */}
          {attachments.length > 0 && (
            <div className="border-t px-3 pt-2 pb-1 flex gap-2 flex-wrap">
              {attachments.map((att, i) => (
                <div key={i} className="relative group">
                  {att.type === 'image' ? (
                    <img
                      src={`data:${att.mime_type};base64,${att.data}`}
                      alt={att.filename}
                      className="h-12 w-12 object-cover rounded border"
                    />
                  ) : (
                    <div className="h-12 w-12 flex items-center justify-center rounded border bg-emerald-50 dark:bg-emerald-950">
                      <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
                    </div>
                  )}
                  <button
                    onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                  <span className="text-[8px] text-muted-foreground truncate block w-12 text-center">
                    {att.filename.length > 10 ? att.filename.slice(0, 8) + '...' : att.filename}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="border-t p-3 flex gap-2 items-center">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,.xlsx"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              className="shrink-0 p-2 rounded-md hover:bg-muted transition-colors disabled:opacity-50"
              title="Adjuntar imagen o Excel"
            >
              <Paperclip className="h-4 w-4 text-muted-foreground" />
            </button>
            <Input
              placeholder="Escribe tu pregunta..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              disabled={sending}
              className="text-sm"
              data-no-uppercase
            />
            <Button
              size="icon"
              onClick={() => handleSend()}
              disabled={sending || (!input.trim() && attachments.length === 0)}
              className="shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
