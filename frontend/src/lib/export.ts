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
 * Export programa as PDF with one page per day
 */
export interface ProgramaDayGroup {
  day: string
  rows: (string | number)[][]
}

export function exportProgramaPDF(
  title: string,
  headers: string[],
  groups: ProgramaDayGroup[],
) {
  const doc = new jsPDF({ orientation: 'landscape' })
  let first = true

  for (const group of groups) {
    if (!first) doc.addPage()
    first = false

    doc.setFontSize(16)
    doc.text(`${title.replace(/_/g, ' ')} — ${group.day}`, 14, 15)
    doc.setFontSize(8)
    doc.text(new Date().toLocaleDateString('es-MX'), 14, 22)

    autoTable(doc, {
      head: [headers],
      body: group.rows.map((r) => r.map((c) => String(c))),
      startY: 28,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [37, 99, 235], fontSize: 7 },
      alternateRowStyles: { fillColor: [245, 245, 245] },
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
