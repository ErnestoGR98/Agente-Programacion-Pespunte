"""
exporter.py - Exportacion de la programacion a Excel con formato sabana limpio.

Genera un archivo Excel con hojas:
  - Programacion: pares por modelo por dia (la sabana principal)
  - Balance_Diario: headcount necesario vs disponible por dia
  - Detalle_Modelos: informacion por modelo (volumen, completado, etc.)
  - PROG_LUNES, PROG_MARTES, ...: programa hora por hora (Iter 2)
"""

import pandas as pd
from openpyxl.styles import PatternFill, Font, Alignment, Border, Side


# Colores por tipo de recurso para resaltado visual
RESOURCE_COLORS = {
    "MESA": "D4E6F1",        # azul claro
    "MESA-LINEA": "A9CCE3",  # azul medio
    "ROBOT": "F9E79F",       # amarillo
    "PLANA": "A9DFBF",       # verde claro
    "PLANA-LINEA": "7DCEA0", # verde medio
    "POSTE-LINEA": "F5CBA7", # naranja claro
    "GENERAL": "D5DBDB",     # gris
}


def export_schedule(schedule: list, summary: dict, output_path: str,
                    daily_results: dict = None):
    """Exporta la programacion optimizada a Excel."""
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        _write_programacion(schedule, summary, writer)
        _write_balance(summary, writer)
        _write_detalle(summary, writer)

        # Hojas de programa diario (Iteracion 2)
        if daily_results:
            for day_name, day_data in daily_results.items():
                if day_data["schedule"]:
                    _write_daily_program(day_name, day_data, writer)

    print(f"  Archivo exportado: {output_path}")


def _write_programacion(schedule: list, summary: dict, writer: pd.ExcelWriter):
    """Hoja principal: pares por modelo por dia (formato pivote)."""
    if not schedule:
        pd.DataFrame().to_excel(writer, sheet_name="Programacion", index=False)
        return

    df = pd.DataFrame(schedule)

    # Crear tabla pivote: filas=modelo, columnas=dias, valores=pares
    days_order = [ds["dia"] for ds in summary["days"]]
    available_days = [d for d in days_order if d in df["Dia"].values]

    pivot = df.pivot_table(
        index=["Fabrica", "Modelo", "Suela"],
        columns="Dia",
        values="Pares",
        aggfunc="sum",
        fill_value=0,
    )

    # Reordenar columnas segun orden de dias
    pivot = pivot.reindex(columns=[d for d in days_order if d in pivot.columns], fill_value=0)

    # Agregar columna de total
    pivot["TOTAL"] = pivot.sum(axis=1)

    # Agregar HC por modelo (promedio)
    hc_pivot = df.pivot_table(
        index=["Fabrica", "Modelo", "Suela"],
        columns="Dia",
        values="HC_Necesario",
        aggfunc="sum",
        fill_value=0,
    )
    hc_pivot = hc_pivot.reindex(columns=[d for d in days_order if d in hc_pivot.columns], fill_value=0)

    # Reset index para escribir
    pivot = pivot.reset_index()

    pivot.to_excel(writer, sheet_name="Programacion", index=False)

    # Marcar en rojo celdas con lotes no multiplo de 100
    ws = writer.sheets["Programacion"]
    red_font = Font(color="FF0000", bold=True)
    red_fill = PatternFill(start_color="FFCCCC", end_color="FFCCCC", fill_type="solid")

    # Columnas de dias empiezan en col 4 (D) hasta la penultima (antes de TOTAL)
    num_day_cols = len([c for c in pivot.columns if c not in ["Fabrica", "Modelo", "Suela", "TOTAL"]])
    day_col_start = 4  # columna D (1-indexed)

    for row_idx in range(2, len(pivot) + 2):  # filas de datos (row 2 en adelante, row 1 es header)
        for col_offset in range(num_day_cols):
            cell = ws.cell(row=row_idx, column=day_col_start + col_offset)
            if cell.value and isinstance(cell.value, (int, float)) and cell.value > 0:
                if int(cell.value) % 100 != 0:
                    cell.font = red_font
                    cell.fill = red_fill

    # Escribir tabla de HC debajo
    start_row = len(pivot) + 3
    hc_pivot = hc_pivot.reset_index()
    hc_pivot.to_excel(
        writer, sheet_name="Programacion", index=False,
        startrow=start_row, header=True,
    )


def _write_balance(summary: dict, writer: pd.ExcelWriter):
    """Hoja de balance diario: headcount necesario vs disponible."""
    rows = []
    for ds in summary["days"]:
        tipo = "EXTRA" if ds["is_saturday"] else "Normal"
        rows.append({
            "Dia": ds["dia"],
            "Tipo": tipo,
            "Pares": ds["pares"],
            "HC_Necesario": ds["hc_necesario"],
            "HC_Disponible": ds["hc_disponible"],
            "Diferencia": ds["diferencia"],
            "Utilizacion_%": ds["utilizacion_pct"],
            "Overtime_hrs": ds.get("overtime_hrs", 0),
        })

    # Agregar fila de totales
    total_pares = sum(r["Pares"] for r in rows)
    total_hc_n = sum(r["HC_Necesario"] for r in rows)
    total_hc_d = sum(r["HC_Disponible"] for r in rows)
    rows.append({
        "Dia": "TOTAL",
        "Tipo": "",
        "Pares": total_pares,
        "HC_Necesario": round(total_hc_n, 1),
        "HC_Disponible": total_hc_d,
        "Diferencia": round(total_hc_d - total_hc_n, 1),
        "Utilizacion_%": "",
    })

    df = pd.DataFrame(rows)
    df.to_excel(writer, sheet_name="Balance_Diario", index=False)


def _write_detalle(summary: dict, writer: pd.ExcelWriter):
    """Hoja de detalle por modelo."""
    rows = []
    for ms in summary["models"]:
        status = "OK" if ms["tardiness"] == 0 else "INCOMPLETO"
        rows.append({
            "Fabrica": ms["fabrica"],
            "Modelo": ms["codigo"],
            "Vol_Semana": ms["volumen"],
            "Producido": ms["producido"],
            "Pendiente": ms["tardiness"],
            "Completado_%": ms["pct_completado"],
            "Estado": status,
        })

    df = pd.DataFrame(rows)
    df.to_excel(writer, sheet_name="Detalle_Modelos", index=False)


def _write_daily_program(day_name: str, day_data: dict, writer: pd.ExcelWriter):
    """Hoja de programa hora por hora para un dia (formato PROGRAMA SEM XX DIA)."""
    schedule = day_data["schedule"]
    summary = day_data["summary"]
    block_labels = summary["block_labels"]

    if not schedule:
        return

    sheet_name = f"PROG_{day_name.upper()[:3]}"

    # Construir filas del dataframe
    rows = []
    for entry in schedule:
        row = {
            "MODELO": entry["modelo"],
            "FRACC": entry["fraccion"],
            "OPERACION": entry["operacion"],
            "RECURSO": entry["recurso"],
            "RATE": entry["rate"],
            "HC": entry["hc"],
        }
        # Agregar columnas de bloques horarios
        for b_idx, label in enumerate(block_labels):
            row[label] = entry["block_pares"][b_idx] if b_idx < len(entry["block_pares"]) else 0
        row["TOTAL"] = entry["total_pares"]
        rows.append(row)

    df = pd.DataFrame(rows)
    df.to_excel(writer, sheet_name=sheet_name, index=False)

    # Agregar fila de TOTAL PARES por bloque
    ws = writer.sheets[sheet_name]
    total_row = len(df) + 2  # +1 header, +1 data rows

    ws.cell(row=total_row, column=1, value="TOTAL PARES")
    for b_idx, label in enumerate(block_labels):
        col = 7 + b_idx  # columnas de bloques empiezan en col 7
        total_val = summary["block_pares"][b_idx] if b_idx < len(summary["block_pares"]) else 0
        ws.cell(row=total_row, column=col, value=total_val)

    # Agregar fila de HC TOTAL por bloque
    hc_row = total_row + 1
    ws.cell(row=hc_row, column=1, value="HC TOTAL")
    for b_idx, label in enumerate(block_labels):
        col = 7 + b_idx
        hc_val = summary["block_hc"][b_idx] if b_idx < len(summary["block_hc"]) else 0
        ws.cell(row=hc_row, column=col, value=hc_val)

    ws.cell(row=hc_row + 1, column=1, value=f"PLANTILLA: {summary['plantilla']}")

    # Formateo: colores por recurso
    thin_border = Border(
        left=Side(style="thin"),
        right=Side(style="thin"),
        top=Side(style="thin"),
        bottom=Side(style="thin"),
    )

    for row_idx in range(2, len(df) + 2):
        recurso_cell = ws.cell(row=row_idx, column=4)  # columna D = RECURSO
        recurso = str(recurso_cell.value or "")
        color = RESOURCE_COLORS.get(recurso, RESOURCE_COLORS.get("GENERAL", "D5DBDB"))
        fill = PatternFill(start_color=color, end_color=color, fill_type="solid")

        for col in range(1, 7 + len(block_labels) + 1):
            cell = ws.cell(row=row_idx, column=col)
            cell.fill = fill
            cell.border = thin_border

    # Header en negrita
    header_fill = PatternFill(start_color="2C3E50", end_color="2C3E50", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True)
    for col in range(1, 7 + len(block_labels) + 1):
        cell = ws.cell(row=1, column=col)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center")

    # Totales en negrita
    bold_font = Font(bold=True)
    for row_idx in [total_row, hc_row]:
        for col in range(1, 7 + len(block_labels) + 1):
            cell = ws.cell(row=row_idx, column=col)
            cell.font = bold_font
