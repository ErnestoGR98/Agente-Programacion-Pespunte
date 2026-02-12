"""
resumen_semanal.py - Tab 1: Vista general de la semana.
"""

import streamlit as st
import pandas as pd
from dashboard.components.charts import build_balance_chart
from dashboard.components.tables import json_copy_btn


def render():
    """Renderiza la vista de resumen semanal."""
    summary = st.session_state.weekly_summary
    schedule = st.session_state.weekly_schedule

    # --- KPIs ---
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Total Pares", f"{summary['total_pares']:,}")
    c2.metric("Estado", summary["status"])
    tard = summary["total_tardiness"]
    c3.metric("Pendientes", f"{tard:,}",
              delta=f"-{tard}" if tard > 0 else None,
              delta_color="inverse")
    c4.metric("Tiempo Solver", f"{summary['wall_time_s']}s")

    st.divider()

    # --- Tabla pivot de produccion ---
    st.subheader("Produccion por Modelo y Dia")
    if schedule:
        df = pd.DataFrame(schedule)
        pivot = df.pivot_table(
            index=["Fabrica", "Modelo"],
            columns="Dia",
            values="Pares",
            aggfunc="sum",
            fill_value=0,
        )
        # Agregar columna TOTAL
        pivot["TOTAL"] = pivot.sum(axis=1)
        # Ordenar columnas por dia
        day_order = [d["dia"] for d in summary["days"]]
        cols = [c for c in day_order if c in pivot.columns] + ["TOTAL"]
        pivot = pivot[[c for c in cols if c in pivot.columns]]
        st.dataframe(pivot, width="stretch")
        json_copy_btn(pivot.reset_index(), "weekly_pivot")

    st.divider()

    # --- Grafica de balance HC ---
    st.subheader("Balance de Headcount")
    fig = build_balance_chart(summary)
    st.plotly_chart(fig, width="stretch")

    st.divider()

    # --- Tabla de modelos ---
    st.subheader("Detalle por Modelo")
    rows = []
    for ms in summary["models"]:
        rows.append({
            "Fabrica": ms["fabrica"],
            "Modelo": ms["codigo"],
            "Volumen": ms["volumen"],
            "Producido": ms["producido"],
            "Pendiente": ms["tardiness"],
            "Completado %": ms["pct_completado"],
            "Estado": "OK" if ms["tardiness"] == 0 else "INCOMPLETO",
        })
    df_models = pd.DataFrame(rows)
    st.dataframe(
        df_models,
        column_config={
            "Completado %": st.column_config.ProgressColumn(
                "Completado %", min_value=0, max_value=100, format="%.1f%%",
            ),
        },
        width="stretch",
        hide_index=True,
    )
    json_copy_btn(df_models, "weekly_models")
