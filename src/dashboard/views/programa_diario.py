"""
programa_diario.py - Tab 2: Programa hora por hora para cada dia.
"""

import streamlit as st
import pandas as pd
from dashboard.components.tables import build_daily_df, style_by_resource


def render():
    """Renderiza la vista de programa diario."""
    daily_results = st.session_state.daily_results

    # Filtrar dias con produccion
    active_days = [
        day for day, data in daily_results.items()
        if data["summary"]["total_pares"] > 0
    ]

    if not active_days:
        st.info("No hay dias con produccion programada.")
        return

    # --- Selector de dia ---
    selected_day = st.selectbox("Seleccionar Dia", active_days)
    day_data = daily_results[selected_day]
    summary = day_data["summary"]

    # --- KPIs del dia ---
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Pares del Dia", f"{summary['total_pares']:,}")
    max_hc = max(summary["block_hc"]) if summary["block_hc"] else 0
    c2.metric("HC Maximo", f"{max_hc:.1f}")
    c3.metric("Plantilla", summary["plantilla"])
    tard = summary["total_tardiness"]
    status_str = summary["status"]
    if tard > 0:
        status_str += f" ({tard} pend.)"
    c4.metric("Estado", status_str)

    st.divider()

    # --- Filtros ---
    schedule = day_data["schedule"]
    if not schedule:
        st.info("No hay operaciones programadas para este dia.")
        return

    block_labels = summary["block_labels"]
    df = build_daily_df(schedule, block_labels)

    col_f1, col_f2 = st.columns(2)
    with col_f1:
        modelos = sorted(df["MODELO"].unique())
        sel_modelos = st.multiselect("Filtrar por Modelo", modelos, default=modelos)
    with col_f2:
        recursos = sorted(df["RECURSO"].unique())
        sel_recursos = st.multiselect("Filtrar por Recurso", recursos, default=recursos)

    # Aplicar filtros
    mask = df["MODELO"].isin(sel_modelos) & df["RECURSO"].isin(sel_recursos)
    df_filtered = df[mask].reset_index(drop=True)

    # --- Tabla principal con colores ---
    st.subheader("Programa de Operaciones")

    # Columnas a mostrar (excluir ROBOTS si esta vacio)
    show_cols = ["MODELO", "FRACC", "OPERACION", "RECURSO", "RATE", "HC"] + block_labels + ["TOTAL"]
    if df_filtered["ROBOTS"].any():
        show_cols.append("ROBOTS")

    df_show = df_filtered[show_cols]
    styled = df_show.style.apply(
        lambda _: style_by_resource(df_show), axis=None
    ).format(precision=1, subset=["HC"])

    # Formatear columnas numericas de bloques (sin decimales)
    for col in block_labels + ["TOTAL", "RATE"]:
        if col in df_show.columns:
            styled = styled.format(precision=0, subset=[col])

    st.dataframe(styled, use_container_width=True, height=500, hide_index=True)

    # --- Filas resumen ---
    st.divider()
    st.subheader("Resumen por Bloque")

    summary_rows = []
    # Total pares
    row_pares = {"Concepto": "TOTAL PARES"}
    for b_idx, label in enumerate(block_labels):
        row_pares[label] = summary["block_pares"][b_idx] if b_idx < len(summary["block_pares"]) else 0
    row_pares["TOTAL"] = sum(summary["block_pares"])
    summary_rows.append(row_pares)

    # HC total
    row_hc = {"Concepto": "HC TOTAL"}
    for b_idx, label in enumerate(block_labels):
        row_hc[label] = summary["block_hc"][b_idx] if b_idx < len(summary["block_hc"]) else 0
    row_hc["TOTAL"] = ""
    summary_rows.append(row_hc)

    df_summary = pd.DataFrame(summary_rows)
    st.dataframe(df_summary, use_container_width=True, hide_index=True)
