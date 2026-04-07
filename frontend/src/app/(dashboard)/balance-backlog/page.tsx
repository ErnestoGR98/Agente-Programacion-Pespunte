'use client'

import { useEffect, useRef, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  fetchCatalogoBacklog, balanceFromExcel, balanceFromManual, downloadBlob, downloadPlantillaBacklog,
  type CatalogoModelo, type ResumenBacklog, type BalanceBacklogResult,
} from '@/lib/api/balance_backlog'
import { Plus, Trash2, Wand2, Download, AlertTriangle, Loader2, FileDown, UploadCloud, FileSpreadsheet, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FilaManual {
  modelo: string
  total: string  // string para input controlado
}

export default function BalanceBacklogPage() {
  const [tab, setTab] = useState<'manual' | 'excel'>('manual')

  // Modo manual
  const [semIni, setSemIni] = useState('15')
  const [semFin, setSemFin] = useState('21')
  const [filas, setFilas] = useState<FilaManual[]>([
    { modelo: '', total: '' },
  ])

  // Catálogo (dropdown)
  const [catalogo, setCatalogo] = useState<CatalogoModelo[]>([])
  const [catalogoLoading, setCatalogoLoading] = useState(false)

  // Modo Excel
  const [file, setFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    const f = e.dataTransfer.files?.[0]
    if (f && (f.name.endsWith('.xlsx') || f.name.endsWith('.xls'))) {
      setFile(f)
    } else if (f) {
      setError('Solo se aceptan archivos .xlsx')
    }
  }

  // Opciones avanzadas
  const [maxModelos, setMaxModelos] = useState('5')
  const [excluir, setExcluir] = useState('')

  // Resultado
  const [loading, setLoading] = useState(false)
  const [resultado, setResultado] = useState<BalanceBacklogResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setCatalogoLoading(true)
    fetchCatalogoBacklog()
      .then(setCatalogo)
      .catch((e) => console.error('No se pudo cargar catálogo:', e))
      .finally(() => setCatalogoLoading(false))
  }, [])

  const totalManual = filas.reduce((acc, f) => acc + (parseInt(f.total) || 0), 0)

  const addFila = () => setFilas([...filas, { modelo: '', total: '' }])
  const removeFila = (i: number) => setFilas(filas.filter((_, idx) => idx !== i))
  const updateFila = (i: number, k: keyof FilaManual, v: string) => {
    const nf = [...filas]
    nf[i] = { ...nf[i], [k]: v }
    setFilas(nf)
  }

  async function handleGenerar() {
    setError(null)
    setResultado(null)
    setLoading(true)
    try {
      const opts = {
        max_modelos: parseInt(maxModelos) || 5,
        excluir: excluir.trim(),
      }
      let res: BalanceBacklogResult
      if (tab === 'excel') {
        if (!file) throw new Error('Selecciona un archivo Excel')
        res = await balanceFromExcel(file, opts)
      } else {
        const ini = parseInt(semIni)
        const fin = parseInt(semFin)
        if (!ini || !fin || fin < ini) throw new Error('Rango de semanas inválido')
        const modelos = filas
          .filter((f) => f.modelo.trim() && parseInt(f.total) > 0)
          .map((f) => ({ nombre: f.modelo.trim(), total: parseInt(f.total) }))
        if (!modelos.length) throw new Error('Agrega al menos un modelo con pares')
        res = await balanceFromManual({ sem_inicio: ini, sem_fin: fin, modelos }, opts)
      }
      setResultado(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Propuesta de Backlog</h1>
        <p className="text-sm text-muted-foreground">
          Distribuye un backlog de pares en semanas balanceando capacidad de robots, mezcla de productos y lotes contiguos.
          Datos en vivo de Supabase. No requiere ejecutar el optimizador.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Define el backlog</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'manual' | 'excel')}>
            <TabsList>
              <TabsTrigger value="manual">Llenar a mano</TabsTrigger>
              <TabsTrigger value="excel">Subir Excel</TabsTrigger>
            </TabsList>

            <TabsContent value="manual" className="space-y-4 mt-4">
              <div className="flex gap-4">
                <div>
                  <Label htmlFor="sem-ini">Semana inicio (ISO)</Label>
                  <Input id="sem-ini" type="number" value={semIni} onChange={(e) => setSemIni(e.target.value)} className="w-28" />
                </div>
                <div>
                  <Label htmlFor="sem-fin">Semana fin (ISO)</Label>
                  <Input id="sem-fin" type="number" value={semFin} onChange={(e) => setSemFin(e.target.value)} className="w-28" />
                </div>
              </div>

              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Modelo</TableHead>
                      <TableHead className="w-40">Total Pares</TableHead>
                      <TableHead className="w-16"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filas.map((f, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Input
                            list="catalogo-modelos"
                            placeholder={catalogoLoading ? 'Cargando catálogo…' : 'Ej: 68127 NE/RO SLI'}
                            value={f.modelo}
                            onChange={(e) => updateFila(i, 'modelo', e.target.value)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            placeholder="0"
                            value={f.total}
                            onChange={(e) => updateFila(i, 'total', e.target.value)}
                          />
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => removeFila(i)} title="Eliminar">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell colSpan={3}>
                        <Button variant="outline" size="sm" onClick={addFila}>
                          <Plus className="h-4 w-4 mr-1" /> Agregar modelo
                        </Button>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                <datalist id="catalogo-modelos">
                  {catalogo.map((c) => (
                    <option key={c.modelo_num} value={c.label}>
                      {c.robot_restringido ? '⚠ robots únicos' : ''}
                    </option>
                  ))}
                </datalist>
              </div>

              <div className="text-sm text-muted-foreground">
                Total: <span className="font-semibold text-foreground">{totalManual.toLocaleString()}</span> pares en {filas.filter((f) => f.modelo.trim()).length} modelos
              </div>
            </TabsContent>

            <TabsContent value="excel" className="space-y-4 mt-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Label>Excel del backlog</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadPlantillaBacklog().catch((e) => setError(String(e)))}
                  title="Descargar Excel en blanco con el formato correcto"
                >
                  <FileDown className="h-4 w-4 mr-2" /> Descargar plantilla
                </Button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />

              <div
                onDragEnter={(e) => { e.preventDefault(); setDragActive(true) }}
                onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
                onDragLeave={(e) => { e.preventDefault(); setDragActive(false) }}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-8 cursor-pointer transition-colors',
                  dragActive
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50 hover:bg-accent/30',
                )}
              >
                {file ? (
                  <>
                    <FileSpreadsheet className="h-10 w-10 text-primary" />
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{file.name}</span>
                      <span className="text-xs text-muted-foreground">({(file.size / 1024).toFixed(1)} KB)</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setFile(null) }}
                        className="rounded-full p-1 hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                        title="Quitar archivo"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">Click o arrastra otro archivo para reemplazar</p>
                  </>
                ) : (
                  <>
                    <UploadCloud className={cn('h-10 w-10', dragActive ? 'text-primary' : 'text-muted-foreground')} />
                    <div className="text-center">
                      <p className="text-sm font-medium">
                        {dragActive ? 'Suelta el archivo aquí' : 'Arrastra el archivo o haz click para seleccionar'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Formato simple (Modelo + Total Pares + rango de semanas) o legacy (matriz modelo×semana)
                      </p>
                    </div>
                  </>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Opciones (avanzado)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="max-modelos">Máx modelos por semana</Label>
              <Input id="max-modelos" type="number" value={maxModelos} onChange={(e) => setMaxModelos(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="excluir">Excluir modelos (separados por coma)</Label>
              <Input id="excluir" placeholder="Ej: 93347, 69906" value={excluir} onChange={(e) => setExcluir(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button onClick={handleGenerar} disabled={loading} size="lg">
          {loading ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generando…</>
          ) : (
            <><Wand2 className="h-4 w-4 mr-2" /> Generar propuesta</>
          )}
        </Button>
        {resultado && (
          <Button variant="outline" onClick={() => downloadBlob(resultado.blob, resultado.filename)}>
            <Download className="h-4 w-4 mr-2" /> Descargar Excel
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {resultado && resultado.resumen.por_semana.length > 0 && (
        <ResumenView resumen={resultado.resumen} />
      )}
    </div>
  )
}

function ResumenView({ resumen }: { resumen: ResumenBacklog }) {
  const totalPares = resumen.por_semana.reduce((a, s) => a + s.pares, 0)
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Distribución por semana</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground mb-2">
            Capacidad robots: {resumen.capacidad_robot_sem} h/sem ({resumen.robots_activos} robots activos)
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Semana</TableHead>
                <TableHead className="text-right">Pares</TableHead>
                <TableHead className="text-right">h-Robot</TableHead>
                <TableHead className="text-right">% Capacidad</TableHead>
                <TableHead className="text-right"># Modelos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resumen.por_semana.map((s) => (
                <TableRow key={s.semana}>
                  <TableCell className="font-medium">Sem {s.semana}</TableCell>
                  <TableCell className="text-right">{s.pares.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{s.horas_robot}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={s.pct_capacidad > 90 ? 'destructive' : s.pct_capacidad > 70 ? 'default' : 'secondary'}>
                      {s.pct_capacidad}%
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{s.n_modelos}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold border-t-2">
                <TableCell>TOTAL</TableCell>
                <TableCell className="text-right">{totalPares.toLocaleString()}</TableCell>
                <TableCell colSpan={3}></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Distribución por modelo</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Modelo</TableHead>
                <TableHead className="text-right">Total</TableHead>
                {resumen.semanas.map((s) => (
                  <TableHead key={s} className="text-right">S{s}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {resumen.por_modelo.map((m) => (
                <TableRow key={m.modelo}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2 flex-wrap">
                      {m.modelo}
                      {m.robot_restringido && (
                        <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/20">
                          robots únicos
                        </Badge>
                      )}
                      {m.sin_catalogo && (
                        <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30 hover:bg-rose-500/20">
                          sin catálogo
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-semibold">{m.total.toLocaleString()}</TableCell>
                  {resumen.semanas.map((s) => (
                    <TableCell key={s} className="text-right text-muted-foreground">
                      {m.distribucion[String(s)] ? m.distribucion[String(s)].toLocaleString() : '—'}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {resumen.errores.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="font-semibold">Errores de validación:</div>
            <ul className="list-disc ml-4 mt-1">
              {resumen.errores.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
