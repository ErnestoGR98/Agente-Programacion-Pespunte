"""
utilizacion.py - Tab 3: Graficas de utilizacion de HC y recursos.
"""

import streamlit as st
from dashboard.components.charts import (
    build_hc_block_chart,
    build_heatmap,
    build_resource_load_chart,
)


def render():
    """Renderiza las graficas de utilizacion."""
    daily_results = st.session_state.daily_results
    params = st.session_state.params

    # --- Heatmap semanal (la vista estrella) ---
    st.subheader("Mapa de Calor Semanal")
    fig_heat = build_heatmap(daily_results)
    if fig_heat:
        st.plotly_chart(fig_heat, width="stretch")
    else:
        st.info("No hay datos para el heatmap.")

    st.divider()

    # --- HC por bloque (por dia seleccionado) ---
    active_days = [
        day for day, data in daily_results.items()
        if data["summary"]["total_pares"] > 0
    ]
    if not active_days:
        return

    st.subheader("HC por Bloque Horario")
    selected_day = st.selectbox("Dia", active_days, key="util_day_select")
    day_data = daily_results[selected_day]

    fig_hc = build_hc_block_chart(day_data, selected_day)
    st.plotly_chart(fig_hc, width="stretch")

    st.divider()

    # --- Carga por recurso ---
    st.subheader("Carga por Tipo de Recurso")
    fig_res = build_resource_load_chart(day_data, params)
    st.plotly_chart(fig_res, width="stretch")
