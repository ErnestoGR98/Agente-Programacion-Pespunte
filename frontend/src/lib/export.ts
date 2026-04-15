import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

/**
 * Export tabular data as .xlsx file
 */
export function exportToExcel(
  title: string,
  headers: string[],
  rows: (string | number)[][],
) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31)) // sheet name max 31 chars
  XLSX.writeFile(wb, `${title}.xlsx`)
}

/**
 * Export tabular data as .pdf file
 */
export function exportToPDF(
  title: string,
  headers: string[],
  rows: (string | number)[][],
) {
  const doc = new jsPDF({ orientation: rows[0]?.length > 8 ? 'landscape' : 'portrait' })
  doc.setFontSize(14)
  doc.text(title, 14, 15)
  doc.setFontSize(8)
  doc.text(new Date().toLocaleDateString('es-MX'), 14, 21)

  autoTable(doc, {
    head: [headers],
    body: rows.map((r) => r.map((c) => String(c))),
    startY: 25,
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [37, 99, 235], fontSize: 7 },
    alternateRowStyles: { fillColor: [245, 245, 245] },
  })

  doc.save(`${title}.pdf`)
}

/**
 * Export a simple table as PDF with model images in a specific column.
 */
export function exportTableWithImagesPDF(
  title: string,
  headers: string[],
  rows: (string | number)[][],
  modeloImages: Map<string, string>,
  imageColHeader = 'Modelo',
) {
  const doc = new jsPDF({ orientation: 'landscape' })
  doc.setFontSize(14)
  doc.text(title.replace(/_/g, ' '), 14, 15)
  doc.setFontSize(8)
  doc.text(new Date().toLocaleDateString('es-MX'), 14, 21)

  const imgColIdx = headers.findIndex((h) => h.toLowerCase() === imageColHeader.toLowerCase())
  const hasImages = modeloImages.size > 0 && imgColIdx >= 0
  const imgW = 12
  const imgH = 9

  autoTable(doc, {
    head: [headers],
    body: rows.map((r) => r.map((c) => String(c))),
    startY: 25,
    styles: { fontSize: 8, cellPadding: 2, minCellHeight: imgH + 4 },
    headStyles: { fillColor: [37, 99, 235], fontSize: 8 },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    columnStyles: hasImages ? {
      [imgColIdx]: { cellWidth: 35, minCellHeight: imgH + 3, cellPadding: { top: 1.5, bottom: 1.5, left: imgW + 3, right: 1.5 } },
    } : undefined,
    didParseCell(data) {
      if (data.section !== 'body') return
      // Style TOTAL row (last row)
      const lastRow = rows[rows.length - 1]
      if (data.row.index === rows.length - 1 && lastRow.some((c) => String(c).toUpperCase() === 'TOTAL')) {
        data.cell.styles.fillColor = [37, 99, 235]
        data.cell.styles.textColor = [255, 255, 255]
        data.cell.styles.fontStyle = 'bold'
      }
    },
    didDrawCell(data) {
      if (!hasImages || data.section !== 'body') return
      if (data.column.index !== imgColIdx) return
      const val = String(data.cell.raw)
      const b64 = modeloImages.get(val)
      if (!b64) return
      try {
        const fmt = b64.startsWith('data:image/png') ? 'PNG' : 'JPEG'
        const cellY = data.cell.y + (data.cell.height - imgH) / 2
        doc.addImage(b64, fmt, data.cell.x + 1, cellY, imgW, imgH)
      } catch { /* skip */ }
    },
  })

  doc.save(`${title}.pdf`)
}

/**
 * Export pedido table as PDF with a maquila delivery sub-row per item.
 */
export function exportPedidoWithMaquilaPDF(
  title: string,
  headers: string[],
  rows: (string | number)[][],
  maquilaEntrega: (string | null)[],   // same length as rows — formatted entrega text or null
  modeloImages?: Map<string, string>,
) {
  const doc = new jsPDF({ orientation: 'landscape' })
  doc.setFontSize(14)
  doc.text(title.replace(/_/g, ' '), 14, 15)
  doc.setFontSize(8)
  doc.text(new Date().toLocaleDateString('es-MX'), 14, 21)

  // Build flat body: item rows + optional maquila entrega sub-row
  const body: (string | number)[][] = []
  const rowTypes: ('item' | 'maquila' | 'total')[] = []

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const isTotal = String(r[0]).toUpperCase() === 'TOTAL'
    body.push(r)
    rowTypes.push(isTotal ? 'total' : 'item')

    const entrega = maquilaEntrega[i]
    if (entrega) {
      body.push(['', `Maquila entrega: ${entrega}`, '', ''])
      rowTypes.push('maquila')
    }
  }

  const imgColIdx = headers.findIndex((h) => h.toLowerCase() === 'modelo')
  const hasImages = modeloImages && modeloImages.size > 0 && imgColIdx >= 0
  const imgW = 12
  const imgH = 9

  autoTable(doc, {
    head: [headers],
    body: body.map((r) => r.map((c) => String(c))),
    startY: 25,
    styles: { fontSize: 8, cellPadding: 2, minCellHeight: imgH + 4 },
    headStyles: { fillColor: [37, 99, 235], fontSize: 8 },
    columnStyles: hasImages ? {
      [imgColIdx]: { cellWidth: 35, minCellHeight: imgH + 3, cellPadding: { top: 1.5, bottom: 1.5, left: imgW + 3, right: 1.5 } },
    } : undefined,
    didParseCell(data) {
      if (data.section !== 'body') return
      const type = rowTypes[data.row.index]
      if (type === 'total') {
        data.cell.styles.fillColor = [37, 99, 235]
        data.cell.styles.textColor = [255, 255, 255]
        data.cell.styles.fontStyle = 'bold'
      } else if (type === 'maquila') {
        data.cell.styles.fillColor = [254, 242, 242]
        data.cell.styles.fontSize = 7
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.textColor = [185, 28, 28]
        data.cell.styles.minCellHeight = 5
        data.cell.styles.cellPadding = 1.5
      }
    },
    didDrawCell(data) {
      if (!hasImages || data.section !== 'body') return
      if (data.column.index !== imgColIdx) return
      const type = rowTypes[data.row.index]
      if (type !== 'item') return
      const val = String(data.cell.raw)
      const b64 = modeloImages!.get(val)
      if (!b64) return
      try {
        const fmt = b64.startsWith('data:image/png') ? 'PNG' : 'JPEG'
        const cellY = data.cell.y + (data.cell.height - imgH) / 2
        doc.addImage(b64, fmt, data.cell.x + 1, cellY, imgW, imgH)
      } catch { /* skip */ }
    },
  })

  doc.save(`${title}.pdf`)
}

/**
 * Export catalog as PDF with per-model sections (separated tables)
 */
export interface CatalogModelGroup {
  modeloNum: string
  rows: (string | number)[][]
}

export function exportCatalogoPDF(
  title: string,
  headers: string[],
  groups: CatalogModelGroup[],
) {
  const doc = new jsPDF({ orientation: 'landscape' })
  doc.setFontSize(16)
  doc.text(title.replace(/_/g, ' '), 14, 15)
  doc.setFontSize(8)
  doc.text(new Date().toLocaleDateString('es-MX'), 14, 22)

  let startY = 28

  for (const group of groups) {
    if (startY > 155) {
      doc.addPage()
      startY = 15
    }

    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text(`Modelo: ${group.modeloNum}`, 14, startY + 5)
    doc.setFont('helvetica', 'normal')
    startY += 9

    autoTable(doc, {
      head: [headers],
      body: group.rows.map((r) => r.map((c) => String(c))),
      startY,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [37, 99, 235], fontSize: 7 },
      alternateRowStyles: { fillColor: [245, 245, 245] },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    startY = (doc as any).lastAutoTable.finalY + 10
  }

  doc.save(`${title}.pdf`)
}

/**
 * Export programa as PDF with one page per day, colored by etapa
 */
export interface MaquilaCard {
  factory: string
  modelo: string
  pares: number
  operations: string[]   // e.g. ["1.- Colocar forro", "2.- Cerrar talon"]
  unassigned?: boolean
}

export interface DayKpis {
  totalPares: number
  weeklyPares: number
  paresAdelantados: number
  paresRezago: number
  tardiness: number
  maxHc: number
  plantilla: number
  status: string
  unassignedCount: number
}

export interface ProgramaDayGroup {
  day: string
  rows: (string | number)[][]
  etapas: string[]       // etapa per row (same length as rows)
  maquilaCards?: MaquilaCard[]
  kpis?: DayKpis
}

/** Load an image URL as base64 data URI for jsPDF.
 *  Uses canvas to normalise any format (PNG/WEBP) → JPEG,
 *  which avoids the jsPDF format-mismatch crash.
 *  Falls back to fetch+FileReader if canvas fails. */
export async function loadImageBase64(url: string): Promise<string | null> {
  // 1. Canvas approach – same CORS behaviour as <img> in the UI
  try {
    const dataUrl = await new Promise<string | null>((resolve) => {
      const img = new window.Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          const c = document.createElement('canvas')
          c.width = img.naturalWidth
          c.height = img.naturalHeight
          const ctx = c.getContext('2d')
          if (!ctx) { resolve(null); return }
          // White background (transparent PNGs render black in JPEG)
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, c.width, c.height)
          ctx.drawImage(img, 0, 0)
          resolve(c.toDataURL('image/jpeg', 0.85))
        } catch { resolve(null) }
      }
      img.onerror = () => resolve(null)
      img.src = url
    })
    if (dataUrl) return dataUrl
  } catch { /* fall through */ }

  // 2. Fallback: fetch + FileReader (keeps original MIME)
  try {
    const resp = await fetch(url)
    const blob = await resp.blob()
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch { return null }
}

/** Pre-load images for all unique modelos. Returns Map<"64197 NE", base64> */
export async function preloadModeloImages(
  modelos: string[],
  imageMap: { main: Record<string, string>; alts: Record<string, Record<string, string>> },
  getUrl: (num: string, color?: string) => string | null,
): Promise<Map<string, string>> {
  const unique = [...new Set(modelos)]
  const result = new Map<string, string>()
  const tasks = unique.map(async (m) => {
    const [num, ...c] = m.split(' ')
    const url = getUrl(num, c.join(' '))
    if (!url) return
    const b64 = await loadImageBase64(url)
    if (b64) result.set(m, b64)
  })
  await Promise.all(tasks)
  return result
}

// Stage colors matching the frontend STAGE_COLORS
const STAGE_RGB: Record<string, [number, number, number]> = {
  PRELIMINAR: [245, 158, 11],
  ROBOT: [16, 185, 129],
  POST: [236, 72, 153],
  MAQUILA: [239, 68, 68],
}

function getEtapaRGB(etapa: string, inputProceso?: string): [number, number, number] {
  // Usar input_o_proceso como fuente primaria
  if (inputProceso) {
    if (inputProceso.includes('N/A')) return [148, 163, 184]
    if (inputProceso.includes('PRELIMINAR')) return STAGE_RGB.PRELIMINAR
    if (inputProceso.includes('ROBOT')) return STAGE_RGB.ROBOT
    if (inputProceso.includes('POST')) return STAGE_RGB.POST
    if (inputProceso.includes('MAQUILA')) return STAGE_RGB.MAQUILA
  }
  // Fallback a etapa con matching ampliado
  if (!etapa) return [148, 163, 184]
  if (etapa.includes('N/A PRELIMINAR')) return [148, 163, 184]
  if (etapa.includes('PRELIMINAR') || etapa.includes('PRE') || etapa === 'MESA') return STAGE_RGB.PRELIMINAR
  if (etapa.includes('ROBOT')) return STAGE_RGB.ROBOT
  if (etapa.includes('POST') || etapa.includes('ZIGZAG')) return STAGE_RGB.POST
  if (etapa.includes('MAQUILA')) return STAGE_RGB.MAQUILA
  return [148, 163, 184]
}

function withAlpha(rgb: [number, number, number], alpha: number): [number, number, number] {
  return [
    Math.round(255 + (rgb[0] - 255) * alpha),
    Math.round(255 + (rgb[1] - 255) * alpha),
    Math.round(255 + (rgb[2] - 255) * alpha),
  ]
}

export function exportProgramaPDF(
  title: string,
  headers: string[],
  groups: ProgramaDayGroup[],
  modeloImages?: Map<string, string>,
) {
  const doc = new jsPDF({ orientation: 'landscape' })
  // Find where block columns start (after HC)
  const hcIdx = headers.indexOf('HC')
  const totalIdx = headers.indexOf('TOTAL')
  const blockStart = hcIdx >= 0 ? hcIdx + 1 : -1
  const blockEnd = totalIdx >= 0 ? totalIdx : headers.length

  // First page: maquila cards in columns
  const maquilaCards = groups.find((g) => g.maquilaCards && g.maquilaCards.length > 0)?.maquilaCards
  if (maquilaCards && maquilaCards.length > 0) {
    doc.setFontSize(16)
    doc.text(`${title.replace(/_/g, ' ')} — Maquila`, 14, 15)
    doc.setFontSize(8)
    doc.text(new Date().toLocaleDateString('es-MX'), 14, 22)

    doc.setFontSize(10)
    doc.setTextColor(239, 68, 68)
    doc.setFont('helvetica', 'bold')
    doc.text('Produccion Externa (Maquila)', 14, 30)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(0, 0, 0)

    const pageW = doc.internal.pageSize.getWidth()
    const margin = 14
    const gap = 6
    const cols = Math.min(maquilaCards.length, 3)
    const cardW = (pageW - margin * 2 - gap * (cols - 1)) / cols

    let cx = margin
    let cy = 36
    let colIdx = 0
    let rowMaxH = 0  // tallest card in current row

    for (const card of maquilaCards) {
      const isUn = card.unassigned
      const r = isUn ? 245 : 239
      const g = isUn ? 158 : 68
      const b = isUn ? 11 : 68

      // Card border
      const cardH = 10 + card.operations.length * 3.5 + 2
      if (cardH > rowMaxH) rowMaxH = cardH
      doc.setDrawColor(r, g, b)
      doc.setLineWidth(0.3)
      doc.roundedRect(cx, cy, cardW, cardH, 1.5, 1.5, 'S')

      // Header: factory + modelo
      doc.setFontSize(7)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(r, g, b)
      doc.text(`${card.factory}  |  ${card.modelo} — ${card.pares}p`, cx + 2, cy + 4.5)

      // Operations list
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      let oy = cy + 9
      for (const op of card.operations) {
        doc.text(op, cx + 3, oy)
        oy += 3.5
      }

      colIdx++
      if (colIdx >= cols) {
        colIdx = 0
        cx = margin
        cy += rowMaxH + gap  // advance by tallest card in row
        rowMaxH = 0
      } else {
        cx += cardW + gap
      }
    }

    doc.setTextColor(0, 0, 0)
  }

  let first = !maquilaCards || maquilaCards.length === 0

  for (const group of groups) {
    if (!first) doc.addPage()
    first = false

    doc.setFontSize(16)
    doc.text(`${title.replace(/_/g, ' ')} — ${group.day}`, 14, 15)
    doc.setFontSize(8)
    doc.text(new Date().toLocaleDateString('es-MX'), 14, 22)

    let startY = 28

    // KPIs row
    if (group.kpis) {
      const k = group.kpis
      const pageW = doc.internal.pageSize.getWidth()
      const kpiMargin = 14
      const kpiGap = 3
      const kpiCols = 5
      const kpiW = (pageW - kpiMargin * 2 - kpiGap * (kpiCols - 1)) / kpiCols
      const kpiH = 14
      const kpis: { label: string; value: string; detail?: string; detailColor?: [number, number, number] }[] = [
        {
          label: 'Pares del Dia',
          value: k.totalPares.toLocaleString(),
          detail: k.weeklyPares > 0
            ? `Prog: ${k.weeklyPares.toLocaleString()}${k.paresRezago > 0 ? `  Rez: +${k.paresRezago.toLocaleString()}` : ''}${k.paresAdelantados > 0 ? `  Adel: +${k.paresAdelantados.toLocaleString()}` : ''}${k.tardiness > 0 ? `  Pend: -${k.tardiness.toLocaleString()}` : ''}`
            : undefined,
        },
        { label: 'HC Maximo', value: String(k.maxHc) },
        { label: 'Plantilla', value: String(k.plantilla) },
        {
          label: 'Estado',
          value: k.status,
          detail: k.tardiness > 0 ? `${k.tardiness} pares pendientes` : undefined,
          detailColor: k.tardiness > 0 ? [245, 158, 11] : undefined,
        },
        {
          label: 'Sin Operario',
          value: String(k.unassignedCount),
          detail: k.unassignedCount > 0 ? 'operaciones sin asignar' : 'todo asignado',
          detailColor: k.unassignedCount > 0 ? [239, 68, 68] : [34, 197, 94],
        },
      ]
      let kx = kpiMargin
      for (const kpi of kpis) {
        // Box border
        doc.setDrawColor(100, 100, 100)
        doc.setLineWidth(0.2)
        doc.roundedRect(kx, startY, kpiW, kpiH, 1, 1, 'S')
        // Label
        doc.setFontSize(5.5)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(140, 140, 140)
        doc.text(kpi.label, kx + 2, startY + 3.5)
        // Value
        doc.setFontSize(10)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(0, 0, 0)
        doc.text(kpi.value, kx + 2, startY + 9)
        // Detail
        if (kpi.detail) {
          doc.setFontSize(4.5)
          doc.setFont('helvetica', 'normal')
          const dc = kpi.detailColor || [140, 140, 140]
          doc.setTextColor(dc[0], dc[1], dc[2])
          doc.text(kpi.detail, kx + 2, startY + 12.5)
        }
        kx += kpiW + kpiGap
      }
      doc.setTextColor(0, 0, 0)
      startY += kpiH + 4
    }

    // Legend
    doc.setFontSize(6)
    let lx = 14
    for (const [name, rgb] of Object.entries(STAGE_RGB)) {
      doc.setFillColor(...rgb)
      doc.rect(lx, startY - 2.5, 3, 3, 'F')
      doc.setTextColor(0, 0, 0)
      doc.text(name, lx + 4, startY)
      lx += doc.getTextWidth(name) + 8
    }
    startY += 5

    const modeloIdx = headers.indexOf('MODELO')
    const hasImages = modeloImages && modeloImages.size > 0
    const imgW = 8
    const imgH = 6

    autoTable(doc, {
      head: [headers],
      body: group.rows.map((r) => r.map((c) => String(c))),
      startY,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [37, 99, 235], fontSize: 7 },
      columnStyles: hasImages && modeloIdx >= 0 ? {
        [modeloIdx]: { cellWidth: 30, cellPadding: { top: 1, bottom: 1, left: imgW + 3, right: 1.5 } },
      } : undefined,
      didParseCell(data) {
        if (data.section !== 'body') return
        const rowIdx = data.row.index
        const etapa = group.etapas[rowIdx] || ''
        const rgb = getEtapaRGB(etapa)
        const col = data.column.index

        // Color block cells that have a value > 0
        if (blockStart >= 0 && col >= blockStart && col < blockEnd) {
          const val = data.cell.raw as string
          if (val && val !== '' && val !== '0') {
            data.cell.styles.fillColor = withAlpha(rgb, 0.2)
            data.cell.styles.textColor = rgb
            data.cell.styles.fontStyle = 'bold'
          }
        }

        // Bold TOTAL column
        if (col === totalIdx) {
          data.cell.styles.fontStyle = 'bold'
        }
      },
      didDrawCell(data) {
        if (!hasImages || data.section !== 'body') return
        if (data.column.index !== modeloIdx) return
        const modelo = String(data.cell.raw)
        const b64 = modeloImages!.get(modelo)
        if (!b64) return
        try {
          const fmt = b64.startsWith('data:image/png') ? 'PNG' : 'JPEG'
          const cellY = data.cell.y + (data.cell.height - imgH) / 2
          doc.addImage(b64, fmt, data.cell.x + 1, cellY, imgW, imgH)
        } catch { /* skip if image fails */ }
      },
    })
  }

  doc.save(`${title}.pdf`)
}

/**
 * Copy tabular data as JSON to clipboard
 * Returns true if successful
 */
export async function copyAsJSON(
  headers: string[],
  rows: (string | number)[][],
): Promise<boolean> {
  const data = rows.map((row) => {
    const obj: Record<string, string | number> = {}
    headers.forEach((h, i) => {
      obj[h] = row[i] ?? ''
    })
    return obj
  })
  try {
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2))
    return true
  } catch {
    return false
  }
}

/**
 * Download tabular data as a .json file
 */
export function downloadAsJSON(
  title: string,
  headers: string[],
  rows: (string | number)[][],
) {
  const data = rows.map((row) => {
    const obj: Record<string, string | number> = {}
    headers.forEach((h, i) => {
      obj[h] = row[i] ?? ''
    })
    return obj
  })
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${title}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Export sabana semanal as PDF — one page per day with block detail,
 * plus a summary page with model totals.
 */
export interface SabanaDayData {
  day: string
  dayColor: [number, number, number]
  headers: string[]
  rows: (string | number)[][]
  etapas: string[]
  modelHeaders: { rowIdx: number; modelo: string; total: string }[]
}

export function exportSabanaPDF(
  title: string,
  dayPages: SabanaDayData[],
) {
  const doc = new jsPDF({ orientation: 'landscape' })
  let first = true

  for (const page of dayPages) {
    if (!first) doc.addPage()
    first = false

    const dc = page.dayColor
    doc.setFontSize(16)
    doc.setTextColor(dc[0], dc[1], dc[2])
    doc.text(`${title.replace(/_/g, ' ')} — ${page.day}`, 14, 15)
    doc.setFontSize(8)
    doc.setTextColor(100, 100, 100)
    doc.text(new Date().toLocaleDateString('es-MX'), 14, 21)
    doc.setTextColor(0, 0, 0)

    // Legend
    let lx = 14
    const ly = 25
    doc.setFontSize(6)
    for (const [name, rgb] of Object.entries(STAGE_RGB)) {
      doc.setFillColor(...rgb)
      doc.rect(lx, ly - 2.5, 3, 3, 'F')
      doc.setTextColor(0, 0, 0)
      doc.text(name, lx + 4, ly)
      lx += doc.getTextWidth(name) + 8
    }

    const modelRowIdxs = new Set(page.modelHeaders.map((m) => m.rowIdx))

    autoTable(doc, {
      head: [page.headers],
      body: page.rows.map((r) => r.map((c) => String(c))),
      startY: 30,
      styles: { fontSize: 5, cellPadding: 1, overflow: 'hidden' },
      headStyles: { fillColor: [dc[0], dc[1], dc[2]], fontSize: 5, cellPadding: 1 },
      didParseCell(data) {
        if (data.section !== 'body') return
        const idx = data.row.index

        // Model header row
        if (modelRowIdxs.has(idx)) {
          data.cell.styles.fillColor = [240, 240, 240]
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.fontSize = 6
          return
        }

        // Etapa coloring for block cells with values
        const etapa = page.etapas[idx] || ''
        const rgb = getEtapaRGB(etapa)
        const val = data.cell.raw as string
        if (val && val !== '' && val !== '0' && val !== '-' && data.column.index >= 3) {
          data.cell.styles.fillColor = withAlpha(rgb, 0.2)
          data.cell.styles.textColor = rgb
          data.cell.styles.fontStyle = 'bold'
        }
      },
    })
  }

  doc.save(`${title}.pdf`)
}

// ── Styled Sabana Excel Export ──

export interface SabanaExcelRow {
  modelo: string
  fraccion: number
  operacion: string
  recurso: string
  rate?: number
  etapa: string
  days: Record<string, {
    blocks: number[]
    total: number
    operario: string
    isSinAsignar: boolean
    adelanto?: boolean
  } | null>
  weekTotal: number
}

export interface SabanaExcelModelGroup {
  modelo: string
  dayTotals: Record<string, number>
  weekTotal: number
  rows: SabanaExcelRow[]
}

const ETAPA_EXCEL_COLORS: Record<string, string> = {
  PRELIMINAR: 'FFF59E0B',
  ROBOT: 'FF10B981',
  POST: 'FFEC4899',
  MAQUILA: 'FFEF4444',
  'N/A PRELIMINAR': 'FF94A3B8',
}

const DAY_EXCEL_COLORS: Record<string, string> = {
  Lun: 'FF3B82F6', Mar: 'FF8B5CF6', Mie: 'FF06B6D4',
  Jue: 'FFF59E0B', Vie: 'FF10B981', Sab: 'FFEF4444',
}

function getEtapaExcelColor(etapa: string): string {
  if (!etapa) return 'FF94A3B8'
  if (etapa.includes('N/A PRELIMINAR')) return ETAPA_EXCEL_COLORS['N/A PRELIMINAR']
  if (etapa.includes('PRELIMINAR') || etapa.includes('PRE')) return ETAPA_EXCEL_COLORS.PRELIMINAR
  if (etapa.includes('ROBOT')) return ETAPA_EXCEL_COLORS.ROBOT
  if (etapa.includes('POST')) return ETAPA_EXCEL_COLORS.POST
  if (etapa.includes('MAQUILA')) return ETAPA_EXCEL_COLORS.MAQUILA
  return 'FF94A3B8'
}

function lightenArgb(argb: string, factor = 0.75): string {
  const r = parseInt(argb.slice(2, 4), 16)
  const g = parseInt(argb.slice(4, 6), 16)
  const b = parseInt(argb.slice(6, 8), 16)
  const lr = Math.round(r + (255 - r) * factor)
  const lg = Math.round(g + (255 - g) * factor)
  const lb = Math.round(b + (255 - b) * factor)
  return `FF${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`
}

function _thinBorder() {
  const side = { style: 'thin', color: { rgb: 'FFD0D0D0' } }
  return { top: side, bottom: side, left: side, right: side }
}

type StyledCell = { v: string | number; s?: Record<string, unknown> }

/* ================================================================
   CURSOGRAMA ANALITICO — Excel formateado
   ================================================================ */

export type CursogramaStage = 'PRELIMINARES' | 'ROBOT' | 'POST' | 'MAQUILA' | 'N/A PRELIMINAR'

export interface CursogramaExcelRow {
  num: number
  fraccion: number
  operacion: string
  recurso: string
  seg: number
  rate: number
  stage: CursogramaStage
  robots: string[]
}

export interface CursogramaExcelSummary {
  counts: Record<CursogramaStage, number>
  totalOps: number
  totalSec: number
}

const CURSOGRAMA_STAGE_COLORS: Record<CursogramaStage, string> = {
  PRELIMINARES: 'FFF59E0B',
  ROBOT: 'FF10B981',
  POST: 'FFEC4899',
  MAQUILA: 'FF8B5CF6',
  'N/A PRELIMINAR': 'FF94A3B8',
}

const CURSOGRAMA_STAGE_LABELS: Record<CursogramaStage, string> = {
  PRELIMINARES: 'Preliminares',
  ROBOT: 'Robot',
  POST: 'Post',
  MAQUILA: 'Maquila',
  'N/A PRELIMINAR': 'N/A Preliminar',
}

const CURSOGRAMA_STAGE_SHORT: Record<CursogramaStage, string> = {
  PRELIMINARES: 'PRE',
  ROBOT: 'ROB',
  POST: 'POST',
  MAQUILA: 'MAQ',
  'N/A PRELIMINAR': 'N/A',
}

const CURSOGRAMA_STAGE_MARK: Record<CursogramaStage, string> = {
  PRELIMINARES: '●',
  ROBOT: '⬢',
  POST: '◆',
  MAQUILA: '▲',
  'N/A PRELIMINAR': '○',
}

const CURSOGRAMA_STAGE_ORDER: CursogramaStage[] = ['PRELIMINARES', 'ROBOT', 'POST', 'MAQUILA', 'N/A PRELIMINAR']

export function exportCursogramaExcel(
  title: string,
  modeloNum: string,
  rows: CursogramaExcelRow[],
  summary: CursogramaExcelSummary,
) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSXStyle = require('xlsx-js-style')

  const aoa: StyledCell[][] = []

  const border = _thinBorder()
  const darkBg = { fill: { fgColor: { rgb: 'FF1E3A5F' } }, font: { bold: true, color: { rgb: 'FFFFFFFF' }, sz: 11 }, alignment: { horizontal: 'center', vertical: 'center' }, border }
  const titleSt = { fill: { fgColor: { rgb: 'FF0F172A' } }, font: { bold: true, color: { rgb: 'FFFFFFFF' }, sz: 14 }, alignment: { horizontal: 'left', vertical: 'center' }, border }
  const subTitleSt = { fill: { fgColor: { rgb: 'FFF1F5F9' } }, font: { italic: true, sz: 10, color: { rgb: 'FF475569' } }, alignment: { horizontal: 'left' }, border }

  const totalCols = 12 // #, F, Desc, Recurso, Seg, Rate, PRE, ROB, POST, MAQ, N/A, Robot

  // Row 1: Title
  const titleRow: StyledCell[] = [{ v: `CURSOGRAMA ANALITICO DEL PROCESO`, s: titleSt }]
  for (let i = 1; i < totalCols; i++) titleRow.push({ v: '', s: titleSt })
  aoa.push(titleRow)

  // Row 2: Subtitle (modelo + fecha)
  const subtitleRow: StyledCell[] = [{ v: `Modelo: ${modeloNum}   —   ${new Date().toLocaleDateString('es-MX')}`, s: subTitleSt }]
  for (let i = 1; i < totalCols; i++) subtitleRow.push({ v: '', s: subTitleSt })
  aoa.push(subtitleRow)

  // Row 3: Header
  const headerLabels = ['#', 'F', 'Descripcion del Proceso', 'Recurso', 'Seg', 'Rate',
    ...CURSOGRAMA_STAGE_ORDER.map((s) => CURSOGRAMA_STAGE_SHORT[s]), 'Robot']
  aoa.push(headerLabels.map((h, idx) => {
    // Color-code stage short labels in header
    if (idx >= 6 && idx < 6 + CURSOGRAMA_STAGE_ORDER.length) {
      const stage = CURSOGRAMA_STAGE_ORDER[idx - 6]
      const color = CURSOGRAMA_STAGE_COLORS[stage]
      return { v: h, s: { ...darkBg, font: { bold: true, color: { rgb: color }, sz: 10 } } }
    }
    return { v: h, s: darkBg }
  }))

  // Data rows
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const stageColor = CURSOGRAMA_STAGE_COLORS[r.stage]
    const stageBg = lightenArgb(stageColor, 0.88)
    const altBg = i % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC'

    const row: StyledCell[] = [
      { v: r.num, s: { fill: { fgColor: { rgb: altBg } }, font: { sz: 9, color: { rgb: 'FF64748B' } }, alignment: { horizontal: 'center' }, border } },
      { v: r.fraccion, s: { fill: { fgColor: { rgb: altBg } }, font: { bold: true, sz: 10, color: { rgb: stageColor } }, alignment: { horizontal: 'center' }, border } },
      { v: r.operacion, s: { fill: { fgColor: { rgb: altBg } }, font: { sz: 10 }, alignment: { horizontal: 'left', vertical: 'center' }, border: { ...border, left: { style: 'medium', color: { rgb: stageColor } } } } },
      { v: r.recurso, s: { fill: { fgColor: { rgb: altBg } }, font: { sz: 9, color: { rgb: 'FF475569' } }, alignment: { horizontal: 'center' }, border } },
      { v: r.seg, s: { fill: { fgColor: { rgb: altBg } }, font: { sz: 9 }, alignment: { horizontal: 'center' }, border } },
      { v: r.rate, s: { fill: { fgColor: { rgb: altBg } }, font: { sz: 9, bold: true }, alignment: { horizontal: 'center' }, border } },
    ]

    // Stage symbol columns
    for (const s of CURSOGRAMA_STAGE_ORDER) {
      if (r.stage === s) {
        row.push({
          v: CURSOGRAMA_STAGE_MARK[s],
          s: { fill: { fgColor: { rgb: stageBg } }, font: { bold: true, sz: 14, color: { rgb: stageColor } }, alignment: { horizontal: 'center', vertical: 'center' }, border },
        })
      } else {
        row.push({ v: '', s: { fill: { fgColor: { rgb: altBg } }, border } })
      }
    }

    // Robot column
    row.push({
      v: r.robots.length > 0 ? '✓' : '',
      s: { fill: { fgColor: { rgb: altBg } }, font: { bold: true, sz: 10, color: { rgb: 'FF10B981' } }, alignment: { horizontal: 'center' }, border },
    })

    aoa.push(row)
  }

  // Blank separator
  aoa.push([{ v: '', s: {} }])

  // RESUMEN section
  const resumenTitleSt = { fill: { fgColor: { rgb: 'FF1E3A5F' } }, font: { bold: true, color: { rgb: 'FFFFFFFF' }, sz: 11 }, alignment: { horizontal: 'center' }, border }
  const resumenRow: StyledCell[] = [{ v: 'RESUMEN', s: resumenTitleSt }]
  for (let i = 1; i < 3; i++) resumenRow.push({ v: '', s: resumenTitleSt })
  aoa.push(resumenRow)

  const resHeadSt = { fill: { fgColor: { rgb: 'FFF1F5F9' } }, font: { bold: true, sz: 10, color: { rgb: 'FF475569' } }, alignment: { horizontal: 'center' }, border }
  aoa.push([
    { v: '', s: resHeadSt },
    { v: 'Actividad', s: { ...resHeadSt, alignment: { horizontal: 'left' } } },
    { v: 'Act.', s: resHeadSt },
  ])

  for (const s of CURSOGRAMA_STAGE_ORDER) {
    const color = CURSOGRAMA_STAGE_COLORS[s]
    aoa.push([
      { v: CURSOGRAMA_STAGE_MARK[s], s: { font: { bold: true, sz: 14, color: { rgb: color } }, alignment: { horizontal: 'center' }, border } },
      { v: CURSOGRAMA_STAGE_LABELS[s], s: { font: { sz: 10 }, alignment: { horizontal: 'left' }, border } },
      { v: summary.counts[s], s: { font: { bold: true, sz: 10 }, alignment: { horizontal: 'right' }, border } },
    ])
  }

  const totalSt = { fill: { fgColor: { rgb: 'FFF1F5F9' } }, font: { bold: true, sz: 10 }, border }
  aoa.push([
    { v: '', s: totalSt },
    { v: 'Total actividades', s: { ...totalSt, alignment: { horizontal: 'left' } } },
    { v: summary.totalOps, s: { ...totalSt, alignment: { horizontal: 'right' } } },
  ])
  aoa.push([
    { v: '', s: totalSt },
    { v: 'Tiempo seg/par', s: { ...totalSt, alignment: { horizontal: 'left' } } },
    { v: summary.totalSec, s: { ...totalSt, alignment: { horizontal: 'right' } } },
  ])

  const ws = XLSXStyle.utils.aoa_to_sheet(aoa)

  // Column widths
  ws['!cols'] = [
    { wch: 4 },   // #
    { wch: 4 },   // F
    { wch: 42 },  // Descripcion
    { wch: 10 },  // Recurso
    { wch: 6 },   // Seg
    { wch: 6 },   // Rate
    { wch: 6 },   // PRE
    { wch: 6 },   // ROB
    { wch: 6 },   // POST
    { wch: 6 },   // MAQ
    { wch: 6 },   // N/A
    { wch: 8 },   // Robot
  ]

  // Row heights
  ws['!rows'] = [
    { hpt: 24 },  // Title
    { hpt: 18 },  // Subtitle
    { hpt: 22 },  // Header
  ]

  // Merges: title row + subtitle row + RESUMEN title row
  const resumenTitleRowIdx = 3 + rows.length + 1 // headers=3 (title+sub+header), rows, blank
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } },
    { s: { r: resumenTitleRowIdx, c: 0 }, e: { r: resumenTitleRowIdx, c: 2 } },
  ]

  const wb = XLSXStyle.utils.book_new()
  XLSXStyle.utils.book_append_sheet(wb, ws, title.slice(0, 31))
  XLSXStyle.writeFile(wb, `${title}.xlsx`)
}

export function exportSabanaExcel(
  title: string,
  dayNames: string[],
  blockLabels: string[],
  modelGroups: SabanaExcelModelGroup[],
  showOperario: boolean,
) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSXStyle = require('xlsx-js-style')

  const numBlocks = blockLabels.length
  const colsPerDay = numBlocks + 1 + (showOperario ? 1 : 0)
  const fixedCols = 5

  const aoa: StyledCell[][] = []

  // ── Row 1: Day group header ──
  const darkBg = { fill: { fgColor: { rgb: 'FF1E3A5F' } }, font: { bold: true, color: { rgb: 'FFFFFFFF' } }, border: _thinBorder() }
  const headerRow1: StyledCell[] = []
  for (let i = 0; i < fixedCols; i++) headerRow1.push({ v: '', s: darkBg })
  for (const d of dayNames) {
    const dc = DAY_EXCEL_COLORS[d] || 'FF666666'
    const lightDc = lightenArgb(dc, 0.85)
    for (let i = 0; i < colsPerDay; i++) {
      headerRow1.push({
        v: i === 0 ? d : '',
        s: { fill: { fgColor: { rgb: lightDc } }, font: { bold: true, color: { rgb: dc }, sz: 12 }, alignment: { horizontal: 'center' }, border: _thinBorder() },
      })
    }
  }
  headerRow1.push({ v: 'SEM', s: { ...darkBg, font: { bold: true, color: { rgb: 'FFFFFFFF' }, sz: 11 }, alignment: { horizontal: 'center' } } })
  aoa.push(headerRow1)

  // ── Row 2: Sub-headers ──
  const subSt = (dc?: string) => ({
    fill: { fgColor: { rgb: 'FF1E3A5F' } },
    font: { bold: true, color: { rgb: dc || 'FFFFFFFF' }, sz: 9 },
    alignment: { horizontal: 'center' },
    border: _thinBorder(),
  })
  const headerRow2: StyledCell[] = [
    { v: 'MODELO', s: subSt() }, { v: 'F', s: subSt() }, { v: 'OPERACION', s: subSt() }, { v: 'REC', s: subSt() }, { v: 'RATE', s: subSt() },
  ]
  for (const d of dayNames) {
    const dc = DAY_EXCEL_COLORS[d] || 'FFFFFFFF'
    const lightDc = lightenArgb(dc, 0.7)
    for (const bl of blockLabels) headerRow2.push({ v: bl, s: { ...subSt(lightDc), font: { bold: true, color: { rgb: lightDc }, sz: 7 } } })
    headerRow2.push({ v: 'TOT', s: { ...subSt(dc), font: { bold: true, color: { rgb: dc }, sz: 9 } } })
    if (showOperario) headerRow2.push({ v: 'OP', s: { ...subSt(lightDc), font: { bold: true, color: { rgb: lightDc }, sz: 8 } } })
  }
  headerRow2.push({ v: 'TOT', s: subSt() })
  aoa.push(headerRow2)

  // ── Data rows ──
  for (const mg of modelGroups) {
    const modelSt = { fill: { fgColor: { rgb: 'FFE8E8E8' } }, font: { bold: true, sz: 10 }, border: _thinBorder() }
    const modelRow: StyledCell[] = [
      { v: mg.modelo, s: modelSt }, { v: '', s: modelSt }, { v: '', s: modelSt }, { v: '', s: modelSt }, { v: '', s: modelSt },
    ]
    for (const d of dayNames) {
      const p = mg.dayTotals[d] || 0
      const dc = DAY_EXCEL_COLORS[d] || 'FF666666'
      for (let i = 0; i < numBlocks; i++) modelRow.push({ v: '', s: modelSt })
      modelRow.push({ v: p > 0 ? p : '', s: { ...modelSt, font: { bold: true, color: { rgb: dc }, sz: 10 }, alignment: { horizontal: 'center' } } })
      if (showOperario) modelRow.push({ v: '', s: modelSt })
    }
    modelRow.push({ v: mg.weekTotal > 0 ? mg.weekTotal : '', s: { ...modelSt, font: { bold: true, sz: 10 }, alignment: { horizontal: 'center' } } })
    aoa.push(modelRow)

    for (const r of mg.rows) {
      const ec = getEtapaExcelColor(r.etapa)
      const ecBg = lightenArgb(ec, 0.85)
      const row: StyledCell[] = [
        { v: '', s: { border: _thinBorder() } },
        { v: r.fraccion, s: { alignment: { horizontal: 'center' }, border: _thinBorder() } },
        { v: r.operacion, s: { font: { color: { rgb: ec } }, border: _thinBorder() } },
        { v: r.recurso, s: { font: { sz: 8 }, border: _thinBorder() } },
        { v: r.rate || '', s: { font: { sz: 8 }, alignment: { horizontal: 'center' }, border: _thinBorder() } },
      ]

      for (const d of dayNames) {
        const cell = r.days[d]
        const dc = DAY_EXCEL_COLORS[d] || 'FF666666'

        if (!cell || cell.total === 0) {
          for (let i = 0; i < numBlocks; i++) row.push({ v: '', s: { border: _thinBorder() } })
          row.push({ v: '', s: { border: _thinBorder() } })
          if (showOperario) row.push({ v: '', s: { border: _thinBorder() } })
          continue
        }

        for (let bi = 0; bi < numBlocks; bi++) {
          const val = cell.blocks[bi] || 0
          if (val > 0) {
            const bg = cell.isSinAsignar ? 'FFFECACA' : cell.adelanto ? 'FFDBEAFE' : ecBg
            const fc = cell.isSinAsignar ? 'FFEF4444' : cell.adelanto ? 'FF3B82F6' : ec
            row.push({ v: val, s: { fill: { fgColor: { rgb: bg } }, font: { bold: true, color: { rgb: fc }, sz: 9 }, alignment: { horizontal: 'center' }, border: _thinBorder() } })
          } else {
            row.push({ v: '', s: { border: _thinBorder() } })
          }
        }

        const totBg = cell.isSinAsignar ? 'FFFECACA' : cell.adelanto ? 'FFDBEAFE' : lightenArgb(dc, 0.9)
        const totFc = cell.isSinAsignar ? 'FFEF4444' : cell.adelanto ? 'FF3B82F6' : dc
        row.push({ v: cell.total, s: { fill: { fgColor: { rgb: totBg } }, font: { bold: true, color: { rgb: totFc }, sz: 9 }, alignment: { horizontal: 'center' }, border: _thinBorder() } })

        if (showOperario) {
          row.push({
            v: cell.isSinAsignar ? 'SIN ASIGNAR' : cell.operario || '',
            s: { font: { sz: 7, color: { rgb: cell.isSinAsignar ? 'FFEF4444' : 'FF666666' }, bold: cell.isSinAsignar }, alignment: { horizontal: 'center' }, border: _thinBorder() },
          })
        }
      }

      row.push({ v: r.weekTotal, s: { font: { bold: true, sz: 10 }, alignment: { horizontal: 'center' }, border: _thinBorder() } })
      aoa.push(row)
    }
  }

  // Build worksheet
  const ws = XLSXStyle.utils.aoa_to_sheet(aoa.map((row: StyledCell[]) => row.map((c: StyledCell) => c.v)))

  for (let ri = 0; ri < aoa.length; ri++) {
    for (let ci = 0; ci < aoa[ri].length; ci++) {
      const addr = XLSXStyle.utils.encode_cell({ r: ri, c: ci })
      if (!ws[addr]) ws[addr] = { v: '', t: 's' }
      if (aoa[ri][ci].s) ws[addr].s = aoa[ri][ci].s
    }
  }

  // Column widths
  const colWidths: { wch: number }[] = [{ wch: 14 }, { wch: 3 }, { wch: 28 }, { wch: 12 }]
  for (let di = 0; di < dayNames.length; di++) {
    for (let bi = 0; bi < numBlocks; bi++) colWidths.push({ wch: 5 })
    colWidths.push({ wch: 6 })
    if (showOperario) colWidths.push({ wch: 14 })
  }
  colWidths.push({ wch: 7 })
  ws['!cols'] = colWidths

  // Merge day header cells (row 0)
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = []
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: fixedCols - 1 } })
  let mergeCol = fixedCols
  for (let di = 0; di < dayNames.length; di++) {
    merges.push({ s: { r: 0, c: mergeCol }, e: { r: 0, c: mergeCol + colsPerDay - 1 } })
    mergeCol += colsPerDay
  }
  ws['!merges'] = merges

  const wb = XLSXStyle.utils.book_new()
  XLSXStyle.utils.book_append_sheet(wb, ws, title.slice(0, 31))
  XLSXStyle.writeFile(wb, `${title}.xlsx`)
}


// ============================================================
// Programa Diario — Excel Export (styled, one sheet per day)
// ============================================================

export interface ProgramaExcelDayGroup {
  day: string
  rows: {
    modelo: string
    fraccion: number
    operacion: string
    etapa: string
    recurso: string
    operario: string
    rate: number
    hc: number
    blocks: number[]
    total: number
    isSinAsignar: boolean
    inputProceso: string
  }[]
}

export function exportProgramaExcel(
  title: string,
  blockLabels: string[],
  groups: ProgramaExcelDayGroup[],
) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSXStyle = require('xlsx-js-style')

  const wb = XLSXStyle.utils.book_new()

  for (const group of groups) {
    if (group.rows.length === 0) continue

    const aoa: StyledCell[][] = []
    const numBlocks = blockLabels.length

    // Header styles
    const darkBg = {
      fill: { fgColor: { rgb: 'FF1E293B' } },
      font: { bold: true, color: { rgb: 'FFFFFFFF' }, sz: 9 },
      alignment: { horizontal: 'center' },
      border: _thinBorder(),
    }
    const dayColor = DAY_EXCEL_COLORS[group.day] || 'FF666666'

    // Title row
    const titleSt = {
      fill: { fgColor: { rgb: dayColor } },
      font: { bold: true, color: { rgb: 'FFFFFFFF' }, sz: 12 },
      alignment: { horizontal: 'left' },
      border: _thinBorder(),
    }
    const titleRow: StyledCell[] = [{ v: `${group.day} — ${title}`, s: titleSt }]
    for (let i = 1; i < 8 + numBlocks + 1; i++) titleRow.push({ v: '', s: titleSt })
    aoa.push(titleRow)

    // Header row
    const headers = ['MODELO', 'F', 'OPERACION', 'ETAPA', 'RECURSO', 'OPERARIO', 'RATE', 'HC', ...blockLabels, 'TOTAL']
    aoa.push(headers.map((h) => ({ v: h, s: darkBg })))

    // Track current model for grouping
    let currentModelo = ''

    for (const r of group.rows) {
      const ec = getEtapaExcelColor(r.inputProceso || r.etapa)
      const ecBg = lightenArgb(ec, 0.85)
      const isSin = r.isSinAsignar

      // Model separator row
      if (r.modelo !== currentModelo) {
        currentModelo = r.modelo
        const modelSt = {
          fill: { fgColor: { rgb: 'FFE2E8F0' } },
          font: { bold: true, sz: 10, color: { rgb: 'FF1E293B' } },
          border: _thinBorder(),
        }
        const mRow: StyledCell[] = [{ v: r.modelo, s: modelSt }]
        for (let i = 1; i < headers.length; i++) mRow.push({ v: '', s: modelSt })
        aoa.push(mRow)
      }

      // Data row
      const row: StyledCell[] = [
        { v: '', s: { border: _thinBorder() } },
        { v: r.fraccion, s: { alignment: { horizontal: 'center' }, font: { bold: true }, border: _thinBorder() } },
        { v: r.operacion, s: { font: { color: { rgb: ec }, sz: 9 }, border: _thinBorder() } },
        { v: r.etapa || r.inputProceso, s: { font: { color: { rgb: ec }, sz: 8, bold: true }, fill: { fgColor: { rgb: ecBg } }, alignment: { horizontal: 'center' }, border: _thinBorder() } },
        { v: r.recurso, s: { font: { sz: 8 }, border: _thinBorder() } },
        {
          v: r.operario || '-',
          s: isSin
            ? { font: { bold: true, color: { rgb: 'FFEF4444' }, sz: 8 }, fill: { fgColor: { rgb: 'FFFECACA' } }, border: _thinBorder() }
            : { font: { sz: 8 }, border: _thinBorder() },
        },
        { v: r.rate, s: { alignment: { horizontal: 'center' }, font: { sz: 8 }, border: _thinBorder() } },
        { v: r.hc, s: { alignment: { horizontal: 'center' }, font: { sz: 8 }, border: _thinBorder() } },
      ]

      // Block cells — colored by etapa
      for (let bi = 0; bi < numBlocks; bi++) {
        const val = r.blocks[bi] || 0
        if (val > 0) {
          row.push({
            v: val,
            s: {
              fill: { fgColor: { rgb: isSin ? 'FFFECACA' : ecBg } },
              font: { bold: true, color: { rgb: isSin ? 'FFEF4444' : ec }, sz: 9 },
              alignment: { horizontal: 'center' },
              border: _thinBorder(),
            },
          })
        } else {
          row.push({ v: '', s: { border: _thinBorder() } })
        }
      }

      // Total
      row.push({
        v: r.total,
        s: {
          font: { bold: true, sz: 10 },
          alignment: { horizontal: 'center' },
          border: _thinBorder(),
        },
      })

      aoa.push(row)
    }

    // Create sheet
    const ws = XLSXStyle.utils.aoa_to_sheet(aoa)

    // Column widths
    const colWidths = [
      { wch: 16 }, // MODELO
      { wch: 4 },  // F
      { wch: 30 }, // OPERACION
      { wch: 14 }, // ETAPA
      { wch: 14 }, // RECURSO
      { wch: 25 }, // OPERARIO
      { wch: 6 },  // RATE
      { wch: 4 },  // HC
      ...blockLabels.map(() => ({ wch: 6 })),
      { wch: 7 },  // TOTAL
    ]
    ws['!cols'] = colWidths

    // Merge title row
    const merges = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }]
    ws['!merges'] = merges

    XLSXStyle.utils.book_append_sheet(wb, ws, group.day.slice(0, 31))
  }

  XLSXStyle.writeFile(wb, `${title}.xlsx`)
}


// ============================================================
// Cascada (Por Operario / Por Recurso) — Excel + PDF Exports
// ============================================================

export interface CascadaCellData {
  modelo: string
  fraccion: number
  recurso: string
  operario: string
  pares: number
  etapaColor: string
}

export interface CascadaRow {
  label: string
  cells: (CascadaCellData | null)[]
}

export function exportCascadaExcel(
  title: string,
  blockLabels: string[],
  rows: CascadaRow[],
  groupBy: 'OPERARIO' | 'RECURSO',
) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSXStyle = require('xlsx-js-style')

  const aoa: StyledCell[][] = []

  const titleSt = {
    fill: { fgColor: { rgb: 'FF1E293B' } },
    font: { bold: true, color: { rgb: 'FFFFFFFF' }, sz: 12 },
    border: _thinBorder(),
  }
  const titleRow: StyledCell[] = [{ v: title, s: titleSt }]
  for (let i = 1; i < blockLabels.length + 1; i++) titleRow.push({ v: '', s: titleSt })
  aoa.push(titleRow)

  const darkBg = {
    fill: { fgColor: { rgb: 'FF1E293B' } },
    font: { bold: true, color: { rgb: 'FFFFFFFF' }, sz: 9 },
    alignment: { horizontal: 'center' },
    border: _thinBorder(),
  }
  aoa.push([
    { v: groupBy, s: { ...darkBg, alignment: { horizontal: 'left' } } },
    ...blockLabels.map((bl) => ({ v: bl, s: darkBg })),
  ])

  for (const row of rows) {
    const isSin = row.label === 'SIN ASIGNAR'
    const dataRow: StyledCell[] = [{
      v: row.label,
      s: { font: { bold: true, sz: 9, color: isSin ? { rgb: 'FFEF4444' } : undefined }, border: _thinBorder() },
    }]

    for (const cell of row.cells) {
      if (!cell) {
        dataRow.push({ v: '', s: { border: _thinBorder(), fill: { fgColor: { rgb: 'FFF8FAFC' } } } })
        continue
      }
      const hex = cell.etapaColor.replace('#', '')
      const ec = `FF${hex}`
      const ecBg = lightenArgb(ec, 0.8)
      dataRow.push({
        v: `${cell.modelo} F${cell.fraccion} ${cell.pares}p`,
        s: {
          fill: { fgColor: { rgb: ecBg } },
          font: { color: { rgb: ec }, sz: 8, bold: true },
          alignment: { horizontal: 'center', wrapText: true },
          border: _thinBorder(),
        },
      })
    }
    aoa.push(dataRow)
  }

  const ws = XLSXStyle.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 30 }, ...blockLabels.map(() => ({ wch: 18 }))]
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: blockLabels.length } }]

  const wb = XLSXStyle.utils.book_new()
  XLSXStyle.utils.book_append_sheet(wb, ws, title.slice(0, 31))
  XLSXStyle.writeFile(wb, `${title}.xlsx`)
}


export function exportCascadaPDF(
  title: string,
  blockLabels: string[],
  rows: CascadaRow[],
  groupBy: 'OPERARIO' | 'RECURSO',
) {
  import('jspdf').then(({ default: jsPDF }) => {
    import('jspdf-autotable').then((autoTableModule) => {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' })
      doc.setFontSize(14)
      doc.text(title, 14, 12)

      const head = [[groupBy, ...blockLabels]]
      const body: string[][] = []
      const cellStyles: Record<string, { fillColor: number[]; textColor: number[] }> = {}

      rows.forEach((row, ri) => {
        const rowData = [row.label]
        row.cells.forEach((cell, ci) => {
          if (!cell) {
            rowData.push('')
          } else {
            const sub = groupBy === 'OPERARIO' ? cell.recurso : (cell.operario || '').split(' ').slice(0, 2).join(' ')
            rowData.push(`${cell.modelo}\nF${cell.fraccion} · ${sub}\n${cell.pares}p`)
            const hex = cell.etapaColor.replace('#', '')
            const r = parseInt(hex.slice(0, 2), 16)
            const g = parseInt(hex.slice(2, 4), 16)
            const b = parseInt(hex.slice(4, 6), 16)
            cellStyles[`${ri}-${ci + 1}`] = {
              fillColor: [Math.min(255, r + 180), Math.min(255, g + 180), Math.min(255, b + 180)],
              textColor: [r, g, b],
            }
          }
        })
        body.push(rowData)
      })

      ;(autoTableModule as unknown as { default: Function }).default(doc, {
        startY: 16,
        head,
        body,
        theme: 'grid',
        headStyles: { fillColor: [30, 41, 59], fontSize: 7, halign: 'center' },
        bodyStyles: { fontSize: 6, cellPadding: 1, valign: 'middle' },
        columnStyles: { 0: { cellWidth: 35, fontStyle: 'bold', fontSize: 7 } },
        didParseCell: (data: { section: string; row: { index: number }; column: { index: number }; cell: { styles: Record<string, unknown> } }) => {
          if (data.section === 'body' && data.column.index > 0) {
            const style = cellStyles[`${data.row.index}-${data.column.index}`]
            if (style) {
              data.cell.styles.fillColor = style.fillColor
              data.cell.styles.textColor = style.textColor
              data.cell.styles.fontStyle = 'bold'
            }
          }
        },
      })

      doc.save(`${title}.pdf`)
    })
  })
}
