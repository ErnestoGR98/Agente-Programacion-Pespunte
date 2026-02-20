'use client'

import { useState, useRef, useEffect } from 'react'
import { useAppStore } from '@/lib/store/useAppStore'
import { sendChatMessage } from '@/lib/api/fastapi'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Send, Trash2 } from 'lucide-react'
import type { ChatMessage } from '@/types'

const SUGGESTIONS = [
  '¿Cuantos pares se producen esta semana?',
  '¿Que modelos tienen tardiness?',
  '¿Como esta la utilizacion por dia?',
  '¿Que restricciones estan activas?',
]

export default function AsistentePage() {
  const { currentPedidoNombre, currentSemana } = useAppStore()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend(text?: string) {
    const content = text || input.trim()
    if (!content) return

    const userMsg: ChatMessage = { role: 'user', content }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setSending(true)

    try {
      const res = await sendChatMessage({
        messages: newMessages,
        pedido_nombre: currentPedidoNombre || '',
        semana: currentSemana || '',
        model: 'claude-sonnet-4-5-20250929',
      })
      setMessages([...newMessages, { role: 'assistant', content: res.response }])
    } catch (err) {
      setMessages([
        ...newMessages,
        { role: 'assistant', content: `Error: ${err instanceof Error ? err.message : 'No se pudo conectar con el asistente'}` },
      ])
    }
    setSending(false)
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Asistente</h1>
          <p className="text-sm text-muted-foreground">
            Pregunta sobre la programacion de produccion.
          </p>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setMessages([])}>
            <Trash2 className="mr-1 h-3 w-3" /> Limpiar
          </Button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 mb-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <p className="text-muted-foreground">Haz una pregunta sobre tu programacion</p>
            <div className="grid grid-cols-2 gap-2">
              {SUGGESTIONS.map((s) => (
                <Button
                  key={s}
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => handleSend(s)}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <Card key={i} className={msg.role === 'user' ? 'ml-12' : 'mr-12'}>
            <CardContent className="py-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">
                {msg.role === 'user' ? 'Tu' : 'Asistente'}
              </p>
              <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
            </CardContent>
          </Card>
        ))}

        {sending && (
          <Card className="mr-12">
            <CardContent className="py-3">
              <Loader2 className="h-4 w-4 animate-spin" />
            </CardContent>
          </Card>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <Input
          placeholder="Escribe tu pregunta..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          disabled={sending}
        />
        <Button onClick={() => handleSend()} disabled={sending || !input.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
