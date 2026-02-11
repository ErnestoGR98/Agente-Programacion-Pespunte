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


def style_by_resource(df):
    """Aplica color de fondo por fila segun el tipo de RECURSO, con texto blanco y bordes."""
    styles = pd.DataFrame("", index=df.index, columns=df.columns)
    for idx, row in df.iterrows():
        recurso = row.get("RECURSO", "GENERAL")
        color = RESOURCE_COLORS.get(recurso, "#808890")
        styles.loc[idx] = (
            f"background-color: {color}; color: #ffffff; "
            f"border-bottom: 1px solid #444; border-right: 1px solid #555"
        )
    return styles
