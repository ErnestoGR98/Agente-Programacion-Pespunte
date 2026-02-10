"""
tables.py - Helpers para tablas estilizadas con colores por recurso.
"""

import pandas as pd

# Colores por tipo de recurso (hex CSS)
RESOURCE_COLORS = {
    "MESA": "#D4E6F1",
    "MESA-LINEA": "#A9CCE3",
    "ROBOT": "#F9E79F",
    "PLANA": "#A9DFBF",
    "PLANA-LINEA": "#7DCEA0",
    "POSTE-LINEA": "#F5CBA7",
    "GENERAL": "#D5DBDB",
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
    """Aplica color de fondo por fila segun el tipo de RECURSO."""
    styles = pd.DataFrame("", index=df.index, columns=df.columns)
    for idx, row in df.iterrows():
        recurso = row.get("RECURSO", "GENERAL")
        color = RESOURCE_COLORS.get(recurso, "#D5DBDB")
        styles.loc[idx] = f"background-color: {color}"
    return styles
