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
    "ROBOT": "#E2AC00",
    "PLANA": "#48A868",
    "POSTE": "#D98040",
    "MAQUILA": "#9B59B6",
    "GENERAL": "#808890",
}

# Colores por etapa de produccion (Preliminar / Robot / Post)
STAGE_COLORS = {
    "PRELIMINAR": "#D4AA00",   # Amarillo / Gold
    "ROBOT": "#3BA55D",        # Verde
    "POST": "#D44C84",         # Rosa / Pink
}


def _classify_stages(df):
    """Clasifica operaciones en PRELIMINAR / ROBOT / POST.

    La clasificacion se basa en la posicion de cada fraccion relativa a las
    operaciones de ROBOT del mismo modelo:
      - Antes de la primera fraccion ROBOT -> PRELIMINAR
      - Recurso ROBOT -> ROBOT
      - Despues de la ultima fraccion ROBOT -> POST
      - No-robot entre operaciones ROBOT -> PRELIMINAR (alimentan siguiente robot)
      - Modelos sin operaciones ROBOT -> POST
    """
    etapas = pd.Series("POST", index=df.index)
    if df.empty:
        return etapas

    for modelo in df["MODELO"].unique():
        mask = df["MODELO"] == modelo
        model_df = df[mask]
        fracs = pd.to_numeric(model_df["FRACC"], errors="coerce")
        robot_fracs = fracs[model_df["RECURSO"] == "ROBOT"].dropna()

        if robot_fracs.empty:
            continue  # Sin ops robot: todo POST (default)

        min_robot = robot_fracs.min()
        max_robot = robot_fracs.max()

        for idx in model_df.index:
            recurso = model_df.at[idx, "RECURSO"]
            frac = fracs.get(idx)
            if recurso == "ROBOT":
                etapas[idx] = "ROBOT"
            elif pd.notna(frac) and frac < min_robot:
                etapas[idx] = "PRELIMINAR"
            elif pd.notna(frac) and frac > max_robot:
                etapas[idx] = "POST"
            else:
                etapas[idx] = "PRELIMINAR"

    return etapas


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
    df = pd.DataFrame(rows)
    df["ETAPA"] = _classify_stages(df)
    return df


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
    df = pd.DataFrame(rows)
    df["ETAPA"] = _classify_stages(df)
    return df


def build_cascade_df(operator_timelines, block_labels):
    """Construye DataFrame con vista cascada: fila por operario, columna por bloque.

    Retorna (df, stage_matrix) donde stage_matrix tiene la etapa por celda.
    """
    if not operator_timelines:
        return pd.DataFrame(), pd.DataFrame()

    # Primero, determinar fracciones ROBOT por modelo para clasificar etapas
    model_robot_range = {}  # modelo -> (min_frac_robot, max_frac_robot)
    for timeline in operator_timelines.values():
        for entry in timeline:
            modelo = entry["modelo"]
            recurso = entry.get("recurso", "")
            if recurso == "ROBOT":
                try:
                    frac = float(entry.get("fraccion", 0))
                except (ValueError, TypeError):
                    continue
                if modelo not in model_robot_range:
                    model_robot_range[modelo] = (frac, frac)
                else:
                    lo, hi = model_robot_range[modelo]
                    model_robot_range[modelo] = (min(lo, frac), max(hi, frac))

    rows = []
    stage_rows = []
    for op_name in sorted(operator_timelines.keys()):
        row = {"OPERARIO": op_name}
        stage_row = {"OPERARIO": ""}
        timeline = operator_timelines[op_name]
        for b_idx, label in enumerate(block_labels):
            entry = next((e for e in timeline if e["block"] == b_idx), None)
            if entry:
                op_short = entry["operacion"][:18]
                row[label] = f"{entry['modelo']} {op_short} ({entry['pares']}p)"
                stage_row[label] = _classify_single_entry(entry, model_robot_range)
            else:
                row[label] = ""
                stage_row[label] = ""
        rows.append(row)
        stage_rows.append(stage_row)
    return pd.DataFrame(rows), pd.DataFrame(stage_rows)


def _classify_single_entry(entry, model_robot_range):
    """Clasifica una entrada de timeline en PRELIMINAR/ROBOT/POST."""
    recurso = entry.get("recurso", "")
    if recurso == "ROBOT":
        return "ROBOT"

    modelo = entry["modelo"]
    if modelo not in model_robot_range:
        return "POST"  # Modelo sin robot -> POST

    try:
        frac = float(entry.get("fraccion", 0))
    except (ValueError, TypeError):
        return "PRELIMINAR"

    min_robot, max_robot = model_robot_range[modelo]
    if frac < min_robot:
        return "PRELIMINAR"
    elif frac > max_robot:
        return "POST"
    else:
        return "PRELIMINAR"  # Entre robots -> alimenta siguiente


def style_cascade_by_stage(df, block_labels, stage_matrix):
    """Aplica colores por etapa (PRELIMINAR/ROBOT/POST) en la vista cascada."""
    border = "border-bottom: 1px solid #444; border-right: 1px solid #555"
    styles = pd.DataFrame("", index=df.index, columns=df.columns)

    for idx, row in df.iterrows():
        styles.loc[idx, "OPERARIO"] = (
            f"background-color: #1A1F2B; color: #E0E0E0; font-weight: bold; {border}"
        )
        for label in block_labels:
            val = str(row.get(label, ""))
            if val:
                stage = stage_matrix.loc[idx, label] if label in stage_matrix.columns else "POST"
                color = STAGE_COLORS.get(stage, "#808890")
                styles.loc[idx, label] = (
                    f"background-color: {color}; color: #ffffff; "
                    f"font-weight: bold; font-size: 0.85em; {border}"
                )
            else:
                styles.loc[idx, label] = (
                    f"background-color: #0E1117; color: #666; "
                    f"border-bottom: 1px solid #333"
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


def _render_table_rows(pdf, df, cols, col_w, row_h, block_labels, etapas=None):
    """Renderiza filas de datos con colores por etapa de produccion."""
    pdf.set_font("Helvetica", "", 5.5)
    block_set = set(block_labels)
    colored_cols = block_set | {"TOTAL"}

    for idx, row in df.iterrows():
        etapa = etapas[idx] if etapas is not None else "POST"
        r, g, b = _hex_to_rgb(STAGE_COLORS.get(etapa, "#808890"))

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


def _sort_cascade(df, block_labels, etapas=None):
    """Ordena DataFrame por primer bloque activo (orden cascada).

    Retorna (df_sorted, etapas_sorted) con indices reseteados.
    """
    def _first_active(row):
        for i, bl in enumerate(block_labels):
            if bl in row.index:
                try:
                    if float(row[bl]) > 0:
                        return i
                except (ValueError, TypeError):
                    pass
        return len(block_labels)

    sort_keys = df.apply(_first_active, axis=1)
    order = sort_keys.sort_values().index
    df_sorted = df.loc[order].reset_index(drop=True)
    etapas_sorted = etapas.loc[order].reset_index(drop=True) if etapas is not None else None
    return df_sorted, etapas_sorted


def generate_daily_pdf(day_name, week_label, df, block_labels, etapas=None):
    """Genera PDF landscape del programa diario con colores por etapa.

    Returns bytes listos para st.download_button.
    """
    from fpdf import FPDF

    # Ordenar en cascada (por primer bloque activo)
    df, etapas = _sort_cascade(df, block_labels, etapas)

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
    _render_table_rows(pdf, df, cols, col_w, row_h, block_labels, etapas)

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

        # Extraer etapas antes de filtrar columnas
        etapas = df["ETAPA"] if "ETAPA" in df.columns else None
        df = df[[c for c in show_cols if c in df.columns]]
        # Ordenar en cascada (por primer bloque activo)
        df, etapas = _sort_cascade(df, block_labels, etapas)
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
        _render_table_rows(pdf, df, cols, col_w, row_h, block_labels, etapas)

    if pdf.page == 0:
        pdf.add_page()
        pdf.set_font("Helvetica", "", 12)
        pdf.cell(0, 10, "Sin datos de programa disponibles.", align="C")

    return bytes(pdf.output())


def _compute_cascade_col_widths(cols, block_labels):
    """Calcula anchos de columna para PDF cascada A3 landscape."""
    page_usable = 404
    op_w = 25
    block_count = sum(1 for c in cols if c in set(block_labels))
    block_w = (page_usable - op_w) / max(block_count, 1)

    col_w = {}
    for c in cols:
        if c == "OPERARIO":
            col_w[c] = op_w
        else:
            col_w[c] = block_w
    return col_w


def _render_cascade_rows(pdf, df, cols, col_w, row_h, block_labels, stage_matrix=None):
    """Renderiza filas de cascada con colores por etapa."""
    pdf.set_font("Helvetica", "", 5)
    block_set = set(block_labels)

    for idx, row in df.iterrows():
        if pdf.get_y() + row_h > pdf.h - 12:
            pdf.add_page()
            _render_table_header(pdf, cols, col_w, row_h)
            pdf.set_font("Helvetica", "", 5)

        for c in cols:
            val = str(row.get(c, ""))
            w = col_w[c]

            if c in block_set and val:
                stage = "POST"
                if stage_matrix is not None and c in stage_matrix.columns:
                    stage = stage_matrix.loc[idx, c] or "POST"
                hex_color = STAGE_COLORS.get(stage, "#808890")
                r, g, b = _hex_to_rgb(hex_color)
                pdf.set_fill_color(r, g, b)
                pdf.set_text_color(255, 255, 255)
                max_chars = int(w / 1.2)
                text = val[:max_chars] if len(val) > max_chars else val
                pdf.cell(w, row_h, text, border=1, fill=True, align="L")
            elif c == "OPERARIO":
                pdf.set_fill_color(30, 35, 50)
                pdf.set_text_color(255, 255, 255)
                pdf.cell(w, row_h, val, border=1, fill=True, align="L")
            else:
                pdf.set_fill_color(245, 245, 245)
                pdf.set_text_color(180, 180, 180)
                pdf.cell(w, row_h, "", border=1, fill=True, align="C")
        pdf.ln()


def generate_daily_cascade_pdf(day_name, week_label, day_data):
    """Genera PDF landscape de la cascada por operario para un solo dia.

    Returns bytes listos para st.download_button.
    """
    from fpdf import FPDF

    timelines = day_data.get("operator_timelines", {})
    block_labels = day_data["summary"]["block_labels"]

    pdf = FPDF(orientation="L", unit="mm", format="A3")
    pdf.set_auto_page_break(auto=True, margin=12)
    row_h = 5.5

    df, stage_matrix = build_cascade_df(timelines, block_labels)
    if df.empty:
        pdf.add_page()
        pdf.set_font("Helvetica", "", 12)
        pdf.cell(0, 10, "Sin datos de cascada disponibles.", align="C")
        return bytes(pdf.output())

    cols = list(df.columns)
    col_w = _compute_cascade_col_widths(cols, block_labels)

    pdf.add_page()

    # Titulo
    pdf.set_font("Helvetica", "B", 16)
    pares = day_data["summary"]["total_pares"]
    num_ops = len(timelines)
    title = f"Cascada por Operario - {day_name}  ({num_ops} operarios)"
    pdf.cell(0, 10, title, new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.set_font("Helvetica", "", 11)
    subtitle = f"{week_label}  |  {pares:,} pares"
    pdf.cell(0, 7, subtitle, new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.ln(4)

    _render_table_header(pdf, cols, col_w, row_h)
    _render_cascade_rows(pdf, df, cols, col_w, row_h, block_labels, stage_matrix)

    return bytes(pdf.output())


def generate_week_cascade_pdf(daily_results, active_days, week_label):
    """Genera PDF semanal con vista cascada (por operario).

    Returns bytes listos para st.download_button.
    """
    from fpdf import FPDF

    pdf = FPDF(orientation="L", unit="mm", format="A3")
    pdf.set_auto_page_break(auto=True, margin=12)
    row_h = 5.5

    for day_name in active_days:
        day_data = daily_results[day_name]
        timelines = day_data.get("operator_timelines", {})
        if not timelines:
            continue

        block_labels = day_data["summary"]["block_labels"]
        df, stage_matrix = build_cascade_df(timelines, block_labels)
        if df.empty:
            continue

        cols = list(df.columns)
        col_w = _compute_cascade_col_widths(cols, block_labels)

        pdf.add_page()

        # Titulo del dia
        pdf.set_font("Helvetica", "B", 16)
        pares = day_data["summary"]["total_pares"]
        num_ops = len(timelines)
        title = f"Cascada por Operario - {day_name}  ({num_ops} operarios)"
        pdf.cell(0, 10, title, new_x="LMARGIN", new_y="NEXT", align="C")
        pdf.set_font("Helvetica", "", 11)
        subtitle = f"{week_label}  |  {pares:,} pares"
        pdf.cell(0, 7, subtitle, new_x="LMARGIN", new_y="NEXT", align="C")
        pdf.ln(4)

        _render_table_header(pdf, cols, col_w, row_h)
        _render_cascade_rows(pdf, df, cols, col_w, row_h, block_labels, stage_matrix)

    # Safety: fpdf2 requiere al menos 1 pagina
    if pdf.page == 0:
        pdf.add_page()
        pdf.set_font("Helvetica", "", 12)
        pdf.cell(0, 10, "Sin datos de cascada disponibles.", align="C")

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


def style_by_stage(df, block_labels=None, etapas=None):
    """Aplica color por etapa de produccion (PRELIMINAR/ROBOT/POST) a celdas con actividad."""
    border = "border-bottom: 1px solid #444; border-right: 1px solid #555"
    neutral = f"color: #E0E0E0; {border}"
    colored_cols = set(block_labels or [])
    if "TOTAL" in df.columns:
        colored_cols.add("TOTAL")

    styles = pd.DataFrame("", index=df.index, columns=df.columns)
    for idx, row in df.iterrows():
        etapa = etapas[idx] if etapas is not None else "POST"
        color = STAGE_COLORS.get(etapa, "#808890")
        colored = f"background-color: {color}; color: #ffffff; font-weight: bold; {border}"

        for col in df.columns:
            if col in colored_cols:
                val = row.get(col, 0)
                try:
                    active = float(val) > 0
                except (ValueError, TypeError):
                    active = False
                styles.loc[idx, col] = colored if active else neutral
            elif col == "RECURSO":
                styles.loc[idx, col] = colored
            else:
                styles.loc[idx, col] = neutral
    return styles
