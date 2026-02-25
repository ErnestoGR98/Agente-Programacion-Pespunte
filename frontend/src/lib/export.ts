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
export interface ProgramaDayGroup {
  day: string
  rows: (string | number)[][]
  etapas: string[]       // etapa per row (same length as rows)
  maquilaInfo?: string[] // lines to show at top of page as bullet list
}

// Stage colors matching the frontend STAGE_COLORS
const STAGE_RGB: Record<string, [number, number, number]> = {
  PRELIMINAR: [245, 158, 11],
  ROBOT: [16, 185, 129],
  POST: [236, 72, 153],
  MAQUILA: [239, 68, 68],
}

function getEtapaRGB(etapa: string): [number, number, number] {
  if (!etapa) return [148, 163, 184]
  if (etapa.includes('N/A PRELIMINAR')) return [148, 163, 184]
  if (etapa.includes('PRELIMINAR') || etapa.includes('PRE')) return STAGE_RGB.PRELIMINAR
  if (etapa.includes('ROBOT')) return STAGE_RGB.ROBOT
  if (etapa.includes('POST')) return STAGE_RGB.POST
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
) {
  const doc = new jsPDF({ orientation: 'landscape' })
  // Find where block columns start (after HC)
  const hcIdx = headers.indexOf('HC')
  const totalIdx = headers.indexOf('TOTAL')
  const blockStart = hcIdx >= 0 ? hcIdx + 1 : -1
  const blockEnd = totalIdx >= 0 ? totalIdx : headers.length

  let first = true

  for (const group of groups) {
    if (!first) doc.addPage()
    first = false

    doc.setFontSize(16)
    doc.text(`${title.replace(/_/g, ' ')} — ${group.day}`, 14, 15)
    doc.setFontSize(8)
    doc.text(new Date().toLocaleDateString('es-MX'), 14, 22)

    let startY = 28

    // Maquila info banner as bullet list
    if (group.maquilaInfo && group.maquilaInfo.length > 0) {
      doc.setFontSize(7)
      doc.setTextColor(239, 68, 68)
      doc.setFont('helvetica', 'bold')
      doc.text('MAQUILA:', 14, startY)
      doc.setFont('helvetica', 'normal')
      startY += 4
      for (const line of group.maquilaInfo) {
        doc.text(`•  ${line}`, 16, startY)
        startY += 3.5
      }
      doc.setTextColor(0, 0, 0)
      startY += 1
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

    autoTable(doc, {
      head: [headers],
      body: group.rows.map((r) => r.map((c) => String(c))),
      startY,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [37, 99, 235], fontSize: 7 },
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
