'use client'

import { useState } from 'react'
import type { usePedido } from '@/lib/hooks/usePedido'
import { importCatalog, downloadTemplate } from '@/lib/api/fastapi'
import { KpiCard } from '@/components/shared/KpiCard'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { CheckCircle, Download, Loader2 } from 'lucide-react'

export function CatalogoTab({ pedido }: { pedido: ReturnType<typeof usePedido> }) {
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function handleUploadCatalog(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const res = await importCatalog(file)
      setMessage(`Importados ${res.modelos_importados} modelos, ${res.total_operaciones} operaciones`)
      await pedido.reload()
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : 'Error'}`)
    }
    setUploading(false)
  }

  const totalOps = pedido.catalogo.reduce((sum, m) => sum + m.num_ops, 0)

  return (
    <div className="space-y-4 mt-4">
      {message && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <KpiCard label="Modelos" value={pedido.catalogo.length} />
        <KpiCard label="Total Operaciones" value={totalOps} />
        <KpiCard
          label="Sec/Par Promedio"
          value={pedido.catalogo.length > 0
            ? Math.round(pedido.catalogo.reduce((s, m) => s + m.total_sec_per_pair, 0) / pedido.catalogo.length)
            : 0
          }
        />
      </div>

      {/* Import + Template Download */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <Label className="text-sm">Importar Catalogo Excel:</Label>
            <Input
              type="file" accept=".xlsx,.xls"
              onChange={handleUploadCatalog}
              className="h-8 w-64"
              disabled={uploading}
            />
            {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
            <Button variant="outline" size="sm" onClick={() => downloadTemplate().catch(() => setMessage('Error descargando template'))}>
              <Download className="mr-1 h-3 w-3" /> Descargar Template
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Catalogo table */}
      <Card>
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Modelo</TableHead>
                <TableHead>Codigo Full</TableHead>
                <TableHead>Alternativas</TableHead>
                <TableHead>Clave Material</TableHead>
                <TableHead>Operaciones</TableHead>
                <TableHead>Sec/Par</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pedido.catalogo.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono font-medium">{m.modelo_num}</TableCell>
                  <TableCell>{m.codigo_full}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {m.alternativas.map((a) => (
                        <Badge key={a} variant="outline" className="text-xs">{a}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{m.clave_material}</TableCell>
                  <TableCell>{m.num_ops}</TableCell>
                  <TableCell>{m.total_sec_per_pair}</TableCell>
                </TableRow>
              ))}
              {pedido.catalogo.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Catalogo vacio. Importa un Excel para comenzar.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
