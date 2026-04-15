'use client'

import { useMemo, useRef, useState, useCallback } from 'react'
import type { OperacionFull } from '@/lib/hooks/useCatalogo'
import type { Restriccion } from '@/types'
import { STAGE_COLORS } from '@/types'
import { Bot, FileSpreadsheet, FileText, Loader2 } from 'lucide-react'
import { exportCursogramaExcel } from '@/lib/export'

/* ================================================================
   CURSOGRAMA ANALITICO DEL PROCESO
   Tabla industrial con columnas de simbolos por etapa de proceso:
     ● Preliminares   ⬡ Robot   ◆ Post   ▲ Maquila   ○ N/A Preliminar
   Conectados por lineas verticales mostrando el flujo del proceso.
   ================================================================ */

type StageType = 'PRELIMINARES' | 'ROBOT' | 'POST' | 'MAQUILA' | 'N/A PRELIMINAR'

const STAGE_ORDER: StageType[] = ['PRELIMINARES', 'ROBOT', 'POST', 'MAQUILA', 'N/A PRELIMINAR']

const STAGE_SYMBOLS: Record<StageType, { label: string; short: string; color: string; shape: 'circle' | 'hexagon' | 'diamond' | 'triangle' | 'circle-outline' }> = {
  PRELIMINARES:     { label: 'Preliminares',   short: 'PRE',  color: STAGE_COLORS.PRELIMINAR,           shape: 'circle' },
  ROBOT:            { label: 'Robot',           short: 'ROB',  color: STAGE_COLORS.ROBOT,                shape: 'hexagon' },
  POST:             { label: 'Post',            short: 'POST', color: STAGE_COLORS.POST,                 shape: 'diamond' },
  MAQUILA:          { label: 'Maquila',         short: 'MAQ',  color: STAGE_COLORS.MAQUILA,              shape: 'triangle' },
  'N/A PRELIMINAR': { label: 'N/A Preliminar',  short: 'N/A',  color: STAGE_COLORS['N/A PRELIMINAR'],    shape: 'circle-outline' },
}

/* ---- SVG Symbol shapes ---- */
function SymbolShape({ stage, active, size = 18 }: { stage: StageType; active: boolean; size?: number }) {
  const sym = STAGE_SYMBOLS[stage]
  const fill = active ? sym.color : 'transparent'
  const stroke = sym.color
  const r = size / 2

  switch (sym.shape) {
    case 'circle':
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={r} cy={r} r={r - 1.5} fill={fill} stroke={stroke} strokeWidth={active ? 0 : 2} />
        </svg>
      )
    case 'hexagon': {
      const cx = r, cy = r, hr = r - 2
      const pts = Array.from({ length: 6 }, (_, i) => {
        const angle = (Math.PI / 3) * i - Math.PI / 2
        return `${cx + hr * Math.cos(angle)},${cy + hr * Math.sin(angle)}`
      }).join(' ')
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={active ? 0 : 1.5} />
        </svg>
      )
    }
    case 'diamond':
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <polygon
            points={`${r},2 ${size - 2},${r} ${r},${size - 2} 2,${r}`}
            fill={fill} stroke={stroke} strokeWidth={active ? 0 : 1.5}
          />
        </svg>
      )
    case 'triangle':
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <polygon
            points={`${r},2 ${size - 2},${size - 2} 2,${size - 2}`}
            fill={fill} stroke={stroke} strokeWidth={active ? 0 : 1.5}
          />
        </svg>
      )
    case 'circle-outline':
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={r} cy={r} r={r - 2} fill="transparent" stroke={stroke} strokeWidth={2} strokeDasharray="3 2" />
          {active && <circle cx={r} cy={r} r={r - 5} fill={stroke} />}
        </svg>
      )
  }
}

function normalizeStage(proceso: string): StageType {
  if (!proceso) return 'PRELIMINARES'
  if (proceso === 'N/A PRELIMINAR') return 'N/A PRELIMINAR'
  if (proceso === 'PRELIMINARES' || proceso.includes('PRELIMINAR')) return 'PRELIMINARES'
  if (proceso === 'ROBOT') return 'ROBOT'
  if (proceso === 'POST') return 'POST'
  if (proceso === 'MAQUILA') return 'MAQUILA'
  return 'PRELIMINARES'
}

/* ---- Row data ---- */
interface ChartRow {
  num: number
  fraccion: number
  operacion: string
  input_o_proceso: string
  etapa: string
  recurso: string
  rate: number
  secPerPair: number
  robots: string[]
  stage: StageType
}

/* ---- Main component ---- */
export interface ProcessFlowDiagramProps {
  operaciones: OperacionFull[]
  reglas: Restriccion[]
  modeloNum?: string
}

export function ProcessFlowDiagram({ operaciones, reglas, modeloNum }: ProcessFlowDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false)

  const rows: ChartRow[] = useMemo(() => {
    return operaciones
      .slice()
      .sort((a, b) => a.fraccion - b.fraccion)
      .map((op, idx) => ({
        num: idx + 1,
        fraccion: op.fraccion,
        operacion: op.operacion,
        input_o_proceso: op.input_o_proceso,
        etapa: op.etapa,
        recurso: op.recurso,
        rate: op.rate,
        secPerPair: op.sec_per_pair || (op.rate > 0 ? Math.round(3600 / op.rate) : 0),
        robots: op.robots || [],
        stage: normalizeStage(op.input_o_proceso),
      }))
  }, [operaciones])

  const summary = useMemo(() => {
    const counts: Record<StageType, number> = {
      PRELIMINARES: 0, ROBOT: 0, POST: 0, MAQUILA: 0, 'N/A PRELIMINAR': 0,
    }
    let totalSec = 0
    for (const r of rows) {
      counts[r.stage]++
      totalSec += r.secPerPair
    }
    return { counts, totalSec, totalOps: rows.length }
  }, [rows])

  const title = `Cursograma_${modeloNum || 'modelo'}`

  const handleExcel = useCallback(() => {
    exportCursogramaExcel(
      title,
      modeloNum || 'modelo',
      rows.map((r) => ({
        num: r.num,
        fraccion: r.fraccion,
        operacion: r.operacion,
        recurso: r.recurso,
        seg: r.secPerPair,
        rate: r.rate,
        stage: r.stage,
        robots: r.robots,
      })),
      { counts: summary.counts, totalOps: summary.totalOps, totalSec: summary.totalSec },
    )
  }, [rows, summary, title, modeloNum])

  const handlePdf = useCallback(async () => {
    if (!containerRef.current) return
    setExporting(true)
    try {
      const html2canvas = (await import('html2canvas-pro')).default
      const { jsPDF } = await import('jspdf')

      const root = document.documentElement
      const wasDark = root.classList.contains('dark')
      if (wasDark) root.classList.remove('dark')
      root.classList.add('light')
      await new Promise((r) => setTimeout(r, 60))

      const scroller = containerRef.current.querySelector('[data-cursograma-scroll]') as HTMLElement | null
      const prevMaxH = scroller?.style.maxHeight
      const prevOverflow = scroller?.style.overflow
      if (scroller) {
        scroller.style.maxHeight = 'none'
        scroller.style.overflow = 'visible'
      }
      const exportBar = containerRef.current.querySelector('[data-export-hide]') as HTMLElement | null
      const prevDisplay = exportBar?.style.display
      if (exportBar) exportBar.style.display = 'none'

      const canvas = await html2canvas(containerRef.current, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        width: containerRef.current.scrollWidth,
        windowWidth: containerRef.current.scrollWidth,
      })

      if (scroller) {
        scroller.style.maxHeight = prevMaxH || ''
        scroller.style.overflow = prevOverflow || ''
      }
      if (exportBar) exportBar.style.display = prevDisplay || ''
      root.classList.remove('light')
      if (wasDark) root.classList.add('dark')

      const imgW = canvas.width
      const imgH = canvas.height
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const margin = 10
      const headerSpace = 22
      const maxW = pageW - margin * 2
      const bodyH = pageH - headerSpace - margin

      pdf.setFontSize(14)
      pdf.text(`Cursograma Analitico${modeloNum ? ` — ${modeloNum}` : ''}`, margin, 14)
      pdf.setFontSize(9)
      pdf.setTextColor(120)
      pdf.text(new Date().toLocaleDateString('es-MX'), margin, 19)
      pdf.setTextColor(0)

      // Fit width to page, paginate vertically if too tall
      const scale = maxW / imgW
      const finalW = maxW
      const finalH = imgH * scale

      if (finalH <= bodyH) {
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, headerSpace, finalW, finalH)
      } else {
        const sliceHpx = bodyH / scale
        let yPx = 0
        let first = true
        while (yPx < imgH) {
          if (!first) {
            pdf.addPage()
            pdf.setFontSize(9)
            pdf.setTextColor(120)
            pdf.text(`Cursograma Analitico${modeloNum ? ` — ${modeloNum}` : ''} (cont.)`, margin, 14)
            pdf.setTextColor(0)
          }
          const h = Math.min(sliceHpx, imgH - yPx)
          const slice = document.createElement('canvas')
          slice.width = imgW
          slice.height = h
          const ctx = slice.getContext('2d')
          if (ctx) ctx.drawImage(canvas, 0, yPx, imgW, h, 0, 0, imgW, h)
          pdf.addImage(slice.toDataURL('image/png'), 'PNG', margin, headerSpace, finalW, h * scale)
          yPx += h
          first = false
        }
      }

      pdf.save(`${title}.pdf`)
    } finally {
      setExporting(false)
    }
  }, [modeloNum, title])

  if (operaciones.length === 0) {
    return (
      <div className="h-[400px] flex items-center justify-center text-sm text-muted-foreground">
        Sin operaciones registradas para este modelo.
      </div>
    )
  }

  return (
    <div ref={containerRef} className="border rounded-lg bg-card overflow-hidden">
      {/* Header */}
      <div className="bg-muted/50 border-b px-4 py-2 flex items-start flex-wrap gap-4">
        <div>
          <h3 className="text-sm font-bold tracking-wide">CURSOGRAMA ANALITICO DEL PROCESO</h3>
          {modeloNum && (
            <span className="text-xs text-muted-foreground font-mono">Modelo: {modeloNum}</span>
          )}
        </div>
        <div className="flex items-center gap-1" data-export-hide>
            <button
              onClick={handleExcel}
              className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
              title="Exportar Excel"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Excel
            </button>
            <button
              onClick={handlePdf}
              disabled={exporting}
              className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-60"
              title="Exportar PDF"
            >
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
              PDF
            </button>
        </div>

        {/* Summary / Resumen */}
        <div className="border rounded px-2.5 py-1.5 bg-card text-[10px]">
          <div className="font-semibold text-[11px] mb-1 text-center border-b pb-0.5">RESUMEN</div>
          <table className="border-collapse">
            <thead>
              <tr>
                <th className="pr-1.5 text-left text-muted-foreground font-medium w-5"></th>
                <th className="pr-2 text-left text-muted-foreground font-medium">Actividad</th>
                <th className="text-right text-muted-foreground font-medium w-6">Act.</th>
              </tr>
            </thead>
            <tbody>
              {STAGE_ORDER.map((stage) => (
                <tr key={stage}>
                  <td className="pr-1.5 py-0.5">
                    <SymbolShape stage={stage} active={true} size={12} />
                  </td>
                  <td className="pr-2">{STAGE_SYMBOLS[stage].label}</td>
                  <td className="text-right font-mono font-bold">{summary.counts[stage]}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t">
                <td colSpan={2} className="pt-1 font-semibold">Total actividades</td>
                <td className="text-right font-mono font-bold pt-1">{summary.totalOps}</td>
              </tr>
              <tr>
                <td colSpan={2} className="font-semibold">Tiempo seg/par</td>
                <td className="text-right font-mono font-bold">{summary.totalSec.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Chart table */}
      <div data-cursograma-scroll className="overflow-auto max-h-[560px] w-fit max-w-full">
        <table className="text-xs border-collapse">
          <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur">
            <tr className="border-b-2">
              <th className="border-r px-1 py-1 text-center w-6 text-muted-foreground">#</th>
              <th className="border-r px-1 py-1 text-center w-6 text-muted-foreground">F</th>
              <th className="border-r px-1.5 py-1 text-left w-[220px]">Descripcion del Proceso</th>
              <th className="border-r px-1 py-1 text-center w-12">Recurso</th>
              <th className="border-r px-1 py-1 text-center w-9" title="Segundos por par">Seg</th>
              <th className="border-r px-1 py-1 text-center w-9" title="Pares por hora">Rate</th>
              {/* Symbol columns */}
              {STAGE_ORDER.map((stage) => (
                <th key={stage} className="border-r px-0 py-1 text-center w-6" title={STAGE_SYMBOLS[stage].label}>
                  <div className="flex flex-col items-center gap-0.5">
                    <SymbolShape stage={stage} active={true} size={13} />
                    <span className="text-[7px] text-muted-foreground leading-none">{STAGE_SYMBOLS[stage].short}</span>
                  </div>
                </th>
              ))}
              <th className="px-1 py-1 text-center w-6" title="Robot asignado">
                <Bot className="h-3 w-3 mx-auto text-muted-foreground" />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const sym = STAGE_SYMBOLS[row.stage]
              const currColIdx = STAGE_ORDER.indexOf(row.stage)
              const prevColIdx = idx > 0 ? STAGE_ORDER.indexOf(rows[idx - 1].stage) : -1
              const nextColIdx = idx < rows.length - 1 ? STAGE_ORDER.indexOf(rows[idx + 1].stage) : -1

              return (
                <tr
                  key={row.fraccion}
                  className="border-b hover:bg-accent/30 transition-colors"
                  style={{ backgroundColor: `${sym.color}06` }}
                >
                  <td className="border-r px-1.5 py-1 text-center font-mono text-muted-foreground text-[10px]">
                    {row.num}
                  </td>
                  <td className="border-r px-1.5 py-1 text-center font-mono font-bold text-[10px]" style={{ color: sym.color }}>
                    {row.fraccion}
                  </td>
                  <td className="border-r px-2 py-1">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: sym.color }} />
                      <span className="truncate" title={row.operacion}>{row.operacion}</span>
                    </div>
                  </td>
                  <td className="border-r px-1 py-1 text-center text-[10px] text-muted-foreground">
                    {row.recurso}
                  </td>
                  <td className="border-r px-1 py-1 text-center font-mono text-[10px]">
                    {row.secPerPair}
                  </td>
                  <td className="border-r px-1 py-1 text-center font-mono text-[10px] font-semibold">
                    {row.rate}
                  </td>

                  {/* Symbol columns with connecting lines */}
                  {STAGE_ORDER.map((stage, colIdx) => {
                    const isActive = row.stage === stage

                    // Determine which lines to draw
                    // Vertical line on top: if previous row connects through or to this column
                    const showTopLine = idx > 0 && (
                      (prevColIdx === colIdx && currColIdx === colIdx) ||
                      (prevColIdx === colIdx && currColIdx !== colIdx) ||
                      (prevColIdx !== currColIdx && currColIdx === colIdx)
                    )

                    // Vertical line on bottom: if next row connects from this column
                    const showBottomLine = idx < rows.length - 1 && (
                      (currColIdx === colIdx && nextColIdx === colIdx) ||
                      (currColIdx === colIdx && nextColIdx !== colIdx) ||
                      (currColIdx !== nextColIdx && nextColIdx === colIdx)
                    )

                    // Horizontal line: when transitioning between columns
                    const minCol = Math.min(prevColIdx, currColIdx)
                    const maxCol = Math.max(prevColIdx, currColIdx)
                    const showHorizLine = idx > 0 && prevColIdx !== currColIdx && prevColIdx >= 0 &&
                      colIdx >= minCol && colIdx <= maxCol

                    return (
                      <td key={stage} className="border-r px-0 py-0 relative h-7">
                        {/* Top vertical line */}
                        {showTopLine && !showHorizLine && (
                          <div
                            className="absolute left-1/2 top-0 w-[1.5px] h-1/2 -translate-x-1/2"
                            style={{ backgroundColor: '#94A3B8' }}
                          />
                        )}

                        {/* Horizontal connecting line */}
                        {showHorizLine && (
                          <>
                            {/* Horizontal bar across the cell */}
                            {colIdx > minCol && colIdx < maxCol && (
                              <div
                                className="absolute top-0 left-0 w-full h-[1.5px]"
                                style={{ backgroundColor: '#94A3B8' }}
                              />
                            )}
                            {/* Left corner (from previous column going right) */}
                            {colIdx === minCol && (
                              <div className="absolute top-0 h-[1.5px]" style={{
                                backgroundColor: '#94A3B8',
                                left: '50%', right: 0,
                              }} />
                            )}
                            {/* Right corner (arriving at current column) */}
                            {colIdx === maxCol && (
                              <div className="absolute top-0 h-[1.5px]" style={{
                                backgroundColor: '#94A3B8',
                                left: 0, width: '50%',
                              }} />
                            )}
                            {/* Vertical stub from corner down to center */}
                            {(colIdx === prevColIdx || colIdx === currColIdx) && (
                              <div
                                className="absolute left-1/2 top-0 w-[1.5px] -translate-x-1/2"
                                style={{
                                  backgroundColor: '#94A3B8',
                                  height: colIdx === currColIdx ? '50%' : 0,
                                }}
                              />
                            )}
                          </>
                        )}

                        {/* Bottom vertical line */}
                        {isActive && idx < rows.length - 1 && (
                          <div
                            className="absolute left-1/2 bottom-0 w-[1.5px] h-1/2 -translate-x-1/2"
                            style={{ backgroundColor: '#94A3B8' }}
                          />
                        )}

                        {/* Symbol */}
                        <div className="flex justify-center items-center h-full relative z-10">
                          {isActive ? (
                            <SymbolShape stage={stage} active={true} size={15} />
                          ) : (
                            <div className="w-4 h-4" />
                          )}
                        </div>
                      </td>
                    )
                  })}

                  {/* Robot indicator */}
                  <td className="px-1 py-1 text-center">
                    {row.robots.length > 0 && (
                      <div className="flex justify-center" title={row.robots.join(', ')}>
                        <Bot className="h-3 w-3 text-emerald-500" />
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
