"""
tables.py - Helpers para tablas estilizadas con colores por recurso.
"""

import json
import streamlit as st
import pandas as pd


def json_copy_btn(data, key="json"):
    """Popover con JSON copiable de un DataFrame, lista o dict."""
    if isinstance(data, pd.DataFrame):
        records = data.to_dict(orient="records")
    elif isinstance(data, dict):
        records = data
    else:
        records = list(data) if data else []

    json_str = json.dumps(records, ensure_ascii=False, indent=2, default=str)
    with st.popover("JSON"):
        st.code(json_str, language="json")

# Colores por tipo de recurso (saturados para dark mode)
RESOURCE_COLORS = {
    "MESA": "#5B9BD5",
    "MESA-LINEA": "#2E75B6",
    "ROBOT": "#E2AC00",
    "PLANA": "#48A868",
    "PLANA-LINEA": "#2D8B4E",
    "POSTE-LINEA": "#D98040",
    "GENERAL": "#808890",
}


def build_daily_df(day_schedule, block_labels):
    """Construye un DataFrame del programa diario."""
    rows = []
    for entry in day_schedule:
        row = {
            "MODELO": entry["modelo"],
            "FRACC": entry["fraccion"],
            "OPERACION": entry["operacion"],
            "RECURSO": entry["recurso"],
            "RATE": entry["rate"],
            "HC": entry["hc"],
        }
        for b_idx, label in enumerate(block_labels):
            row[label] = entry["block_pares"][b_idx] if b_idx < len(entry["block_pares"]) else 0
        row["TOTAL"] = entry["total_pares"]
        if entry.get("robots_used"):
            row["ROBOTS"] = ", ".join(entry["robots_used"])
        else:
            row["ROBOTS"] = ""
        rows.append(row)
    return pd.DataFrame(rows)


def build_daily_df_with_operators(assignments, block_labels):
    """Construye DataFrame del programa diario con columna OPERARIO y PENDIENTE."""
    rows = []
    for entry in assignments:
        row = {
            "MODELO": entry["modelo"],
            "FRACC": entry.get("fraccion", ""),
            "OPERACION": entry.get("operacion", ""),
            "RECURSO": entry.get("recurso", ""),
            "OPERARIO": entry.get("operario", ""),
            "RATE": entry.get("rate", 0),
            "HC": entry.get("hc", 0),
        }
        block_pares = entry.get("block_pares", [])
        for b_idx, label in enumerate(block_labels):
            row[label] = block_pares[b_idx] if b_idx < len(block_pares) else 0
        row["TOTAL"] = entry.get("total_pares", 0)
        robot = entry.get("robot_asignado", "")
        if not robot and entry.get("robots_used"):
            robot = ", ".join(entry["robots_used"])
        row["ROBOT"] = robot
        row["PENDIENTE"] = entry.get("pendiente", 0)
        rows.append(row)
    return pd.DataFrame(rows)


def build_cascade_df(operator_timelines, block_labels):
    """Construye DataFrame con vista cascada: fila por operario, columna por bloque."""
    if not operator_timelines:
        return pd.DataFrame()

    rows = []
    for op_name in sorted(operator_timelines.keys()):
        row = {"OPERARIO": op_name}
        timeline = operator_timelines[op_name]
        for b_idx, label in enumerate(block_labels):
            entry = next((e for e in timeline if e["block"] == b_idx), None)
            if entry:
                op_short = entry["operacion"][:18]
                row[label] = f"{entry['modelo']} {op_short} ({entry['pares']}p)"
            else:
                row[label] = ""
        rows.append(row)
    return pd.DataFrame(rows)


def style_cascade_by_model(df, block_labels):
    """Aplica colores por modelo en la vista cascada para ver cambios de modelo."""
    # Colores rotativos para modelos distintos
    model_colors = [
        "#2E4057", "#4A6F8C", "#6B4E3D", "#3E6B48",
        "#5C3566", "#8B6914", "#2B5B84", "#704214",
    ]
    styles = pd.DataFrame("", index=df.index, columns=df.columns)

    # Recopilar todos los modelos unicos de las celdas
    model_list = []
    for _, row in df.iterrows():
        for label in block_labels:
            val = str(row.get(label, ""))
            if val:
                model_code = val.split()[0] if val else ""
                if model_code and model_code not in model_list:
                    model_list.append(model_code)

    model_color_map = {}
    for i, m in enumerate(model_list):
        model_color_map[m] = model_colors[i % len(model_colors)]

    for idx, row in df.iterrows():
        # Columna OPERARIO: estilo neutro
        styles.loc[idx, "OPERARIO"] = (
            "background-color: #1A1F2B; color: #E0E0E0; font-weight: bold; "
            "border-bottom: 1px solid #444"
        )
        for label in block_labels:
            val = str(row.get(label, ""))
            if val:
                model_code = val.split()[0] if val else ""
                color = model_color_map.get(model_code, "#1A1F2B")
                styles.loc[idx, label] = (
                    f"background-color: {color}; color: #ffffff; "
                    f"border-bottom: 1px solid #444; border-right: 1px solid #555; "
                    f"font-size: 0.85em"
                )
            else:
                styles.loc[idx, label] = (
                    "background-color: #0E1117; color: #666; "
                    "border-bottom: 1px solid #333"
                )
    return styles


def _compute_col_widths(cols, block_labels):
    """Calcula anchos de columna para PDF A3 landscape."""
    fixed_w = {
        "MODELO": 20, "FRACC": 8, "RECURSO": 18, "OPERARIO": 18,
        "RATE": 10, "HC": 8, "TOTAL": 11, "ROBOT": 24, "PENDIENTE": 15,
        "ROBOTS": 24,
    }
    page_usable = 404
    fixed_sum = sum(fixed_w.get(c, 0) for c in cols if c not in block_labels and c != "OPERACION")
    block_count = sum(1 for c in cols if c in block_labels)
    op_in = "OPERACION" in cols

    remaining = page_usable - fixed_sum
    if op_in and block_count:
        block_w = 11
        op_w = max(30, remaining - block_count * block_w)
    elif op_in:
        op_w = remaining
        block_w = 0
    else:
        op_w = 0
        block_w = remaining / max(block_count, 1)

    col_w = {}
    for c in cols:
        if c == "OPERACION":
            col_w[c] = op_w
        elif c in block_labels:
            col_w[c] = block_w
        else:
            col_w[c] = fixed_w.get(c, 12)
    return col_w


def _render_table_header(pdf, cols, col_w, row_h):
    """Renderiza encabezado de tabla en el PDF."""
    pdf.set_font("Helvetica", "B", 6)
    pdf.set_fill_color(30, 35, 50)
    pdf.set_text_color(255, 255, 255)
    for c in cols:
        label = c[:int(col_w[c] / 1.4)] if len(c) > int(col_w[c] / 1.4) else c
        pdf.cell(col_w[c], row_h, label, border=1, fill=True, align="C")
    pdf.ln()


def _render_table_rows(pdf, df, cols, col_w, row_h, block_labels):
    """Renderiza filas de datos con colores por recurso."""
    pdf.set_font("Helvetica", "", 5.5)
    block_set = set(block_labels)
    colored_cols = block_set | {"TOTAL"}

    for _, row in df.iterrows():
        recurso = str(row.get("RECURSO", "GENERAL"))
        r, g, b = _hex_to_rgb(RESOURCE_COLORS.get(recurso, "#808890"))

        # Salto de pagina con encabezado repetido
        if pdf.get_y() + row_h > pdf.h - 12:
            pdf.add_page()
            _render_table_header(pdf, cols, col_w, row_h)
            pdf.set_font("Helvetica", "", 5.5)

        for c in cols:
            val = row.get(c, "")
            w = col_w[c]

            if c in colored_cols:
                try:
                    num = float(val) if val != "" and pd.notna(val) else 0
                except (ValueError, TypeError):
                    num = 0
                if num > 0:
                    pdf.set_fill_color(r, g, b)
                    pdf.set_text_color(255, 255, 255)
                    pdf.cell(w, row_h, str(int(num)), border=1, fill=True, align="C")
                else:
                    pdf.set_fill_color(245, 245, 245)
                    pdf.set_text_color(180, 180, 180)
                    pdf.cell(w, row_h, "0", border=1, fill=True, align="C")
            elif c == "RECURSO":
                pdf.set_fill_color(r, g, b)
                pdf.set_text_color(255, 255, 255)
                pdf.cell(w, row_h, str(val), border=1, fill=True, align="C")
            else:
                pdf.set_fill_color(255, 255, 255)
                pdf.set_text_color(30, 30, 30)
                text = str(val) if pd.notna(val) else ""
                max_chars = int(w / 1.4)
                if len(text) > max_chars:
                    text = text[:max_chars - 1] + "."
                align = "C" if c in ("FRACC", "RATE", "HC", "PENDIENTE") else "L"
                pdf.cell(w, row_h, text, border=1, align=align)
        pdf.ln()


def generate_daily_pdf(day_name, week_label, df, block_labels):
    """Genera PDF landscape del programa diario con colores por recurso.

    Returns bytes listos para st.download_button.
    """
    from fpdf import FPDF

    cols = list(df.columns)
    col_w = _compute_col_widths(cols, block_labels)
    row_h = 5.5

    pdf = FPDF(orientation="L", unit="mm", format="A3")
    pdf.set_auto_page_break(auto=True, margin=12)
    pdf.add_page()

    # Titulo
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, f"Programa de Operaciones - {day_name}", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 7, week_label, new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.ln(4)

    _render_table_header(pdf, cols, col_w, row_h)
    _render_table_rows(pdf, df, cols, col_w, row_h, block_labels)

    return bytes(pdf.output())


def generate_week_pdf(daily_results, active_days, week_label):
    """Genera PDF con todos los dias de la semana, cada dia en pagina(s) nuevas.

    Returns bytes listos para st.download_button.
    """
    from fpdf import FPDF

    pdf = FPDF(orientation="L", unit="mm", format="A3")
    pdf.set_auto_page_break(auto=True, margin=12)
    row_h = 5.5

    for day_name in active_days:
        day_data = daily_results[day_name]
        schedule = day_data.get("schedule", [])
        if not schedule:
            continue

        block_labels = day_data["summary"]["block_labels"]
        has_assignments = "assignments" in day_data and day_data["assignments"]

        # Construir DataFrame igual que en la vista
        if has_assignments:
            df = build_daily_df_with_operators(day_data["assignments"], block_labels)
            show_cols = ["MODELO", "FRACC", "OPERACION", "RECURSO", "OPERARIO",
                         "RATE", "HC"] + block_labels + ["TOTAL"]
            if df["ROBOT"].any():
                show_cols.append("ROBOT")
            show_cols.append("PENDIENTE")
        else:
            df = build_daily_df(schedule, block_labels)
            show_cols = ["MODELO", "FRACC", "OPERACION", "RECURSO",
                         "RATE", "HC"] + block_labels + ["TOTAL"]
            if "ROBOTS" in df.columns and df["ROBOTS"].any():
                show_cols.append("ROBOTS")

        df = df[[c for c in show_cols if c in df.columns]]
        cols = list(df.columns)
        col_w = _compute_col_widths(cols, block_labels)

        # Nueva pagina para este dia
        pdf.add_page()

        # Titulo del dia
        pdf.set_font("Helvetica", "B", 16)
        modelos = sorted({e["modelo"] for e in schedule})
        title = f"Programa de Operaciones - {day_name}  ({len(modelos)} modelos)"
        pdf.cell(0, 10, title, new_x="LMARGIN", new_y="NEXT", align="C")
        pdf.set_font("Helvetica", "", 11)
        pares = day_data["summary"]["total_pares"]
        subtitle = f"{week_label}  |  {pares:,} pares"
        pdf.cell(0, 7, subtitle, new_x="LMARGIN", new_y="NEXT", align="C")
        pdf.ln(4)

        _render_table_header(pdf, cols, col_w, row_h)
        _render_table_rows(pdf, df, cols, col_w, row_h, block_labels)

    return bytes(pdf.output())


def _hex_to_rgb(hex_color):
    """Convierte color hex (#RRGGBB) a tupla (r, g, b)."""
    h = hex_color.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def style_by_resource(df, block_labels=None):
    """Aplica color solo a celdas de bloques horarios con actividad; resto neutral con bordes."""
    border = "border-bottom: 1px solid #444; border-right: 1px solid #555"
    neutral = f"color: #E0E0E0; {border}"
    recurso_cols = set(block_labels or [])
    # Incluir TOTAL como celda coloreada
    if "TOTAL" in df.columns:
        recurso_cols.add("TOTAL")

    styles = pd.DataFrame("", index=df.index, columns=df.columns)
    for idx, row in df.iterrows():
        recurso = row.get("RECURSO", "GENERAL")
        color = RESOURCE_COLORS.get(recurso, "#808890")
        colored = f"background-color: {color}; color: #ffffff; font-weight: bold; {border}"

        for col in df.columns:
            if col in recurso_cols:
                val = row.get(col, 0)
                try:
                    active = float(val) > 0
                except (ValueError, TypeError):
                    active = False
                styles.loc[idx, col] = colored if active else neutral
            elif col == "RECURSO":
                # Pequeno indicador de color en la celda RECURSO
                styles.loc[idx, col] = (
                    f"background-color: {color}; color: #ffffff; "
                    f"font-weight: bold; {border}"
                )
            else:
                styles.loc[idx, col] = neutral
    return styles
