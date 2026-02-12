"""
tables.py - Helpers para tablas estilizadas con colores por recurso.
"""

import pandas as pd

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
