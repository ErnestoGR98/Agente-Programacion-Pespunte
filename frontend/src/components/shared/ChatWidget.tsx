'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useAppStore } from '@/lib/store/useAppStore'
import { sendChatMessage } from '@/lib/api/fastapi'
import { supabase } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Loader2, Send, Trash2, MessageSquare, X, Minimize2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { ChatMessage } from '@/types'

const SUGGESTIONS = [
  '¿Cuantos pares se producen esta semana?',
  '¿Que modelos tienen tardiness?',
  '¿Como esta la utilizacion por dia?',
  '¿Que restricciones estan activas?',
]

export function ChatWidget() {
  const { currentPedidoNombre, currentSemana } = useAppStore()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const semanaKey = currentSemana || currentPedidoNombre || 'general'

  const loadHistory = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('chat_messages')
      .select('role, content')
      .eq('semana', semanaKey)
      .order('created_at', { ascending: true })
    setMessages((data as ChatMessage[]) || [])
    setLoading(false)
    setLoaded(true)
  }, [semanaKey])

  // Load history when widget opens for the first time or semana changes
  useEffect(() => {
    if (open && !loaded) {
      loadHistory()
    }
  }, [open, loaded, loadHistory])

  // Reset loaded flag when semana changes
  useEffect(() => {
    setLoaded(false)
  }, [semanaKey])

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, open])

  async function saveMessage(msg: ChatMessage) {
    await supabase.from('chat_messages').insert({
      semana: semanaKey,
      role: msg.role,
      content: msg.content,
    })
  }

  async function handleSend(text?: string) {
    const content = text || input.trim()
    if (!content) return

    const userMsg: ChatMessage = { role: 'user', content }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
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
  }

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-all hover:scale-105 flex items-center justify-center"
        >
          <MessageSquare className="h-6 w-6" />
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-96 h-[32rem] flex flex-col bg-background border rounded-xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-primary text-primary-foreground">
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
                  {msg.role === 'assistant' ? (
                    <div className="prose prose-xs dark:prose-invert max-w-none text-xs [&_table]:text-[10px] [&_th]:px-1.5 [&_th]:py-0.5 [&_td]:px-1.5 [&_td]:py-0.5 [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_pre]:text-[10px] [&_code]:text-[10px]">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
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

          {/* Input */}
          <div className="border-t p-3 flex gap-2">
            <Input
              placeholder="Escribe tu pregunta..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              disabled={sending}
              className="text-sm"
            />
            <Button
              size="icon"
              onClick={() => handleSend()}
              disabled={sending || !input.trim()}
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
