'use client'

import { useState } from 'react'
import { FileSpreadsheet, FileText, Braces, Check } from 'lucide-react'
import { exportToExcel, exportToPDF, copyAsJSON } from '@/lib/export'

interface TableExportProps {
  title: string
  headers: string[]
  rows: (string | number)[][]
  onCustomPDF?: () => void | Promise<void>
}

export function TableExport({ title, headers, rows, onCustomPDF }: TableExportProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopyJSON() {
    const ok = await copyAsJSON(headers, rows)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (rows.length === 0) return null

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => exportToExcel(title, headers, rows)}
        className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
        title="Exportar Excel"
      >
        <FileSpreadsheet className="h-3.5 w-3.5" />
        Excel
      </button>
      <button
        onClick={() => onCustomPDF ? onCustomPDF() : exportToPDF(title, headers, rows)}
        className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
        title="Exportar PDF"
      >
        <FileText className="h-3.5 w-3.5" />
        PDF
      </button>
      <button
        onClick={handleCopyJSON}
        className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
        title="Copiar como JSON"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Braces className="h-3.5 w-3.5" />}
        {copied ? 'Copiado' : 'JSON'}
      </button>
    </div>
  )
}
