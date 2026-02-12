"""
programa_diario.py - Tab: Programa hora por hora para cada dia.

Dos modos de visualizacion:
  - Por Operacion: tabla clasica con MODELO, FRACC, OPERACION, RECURSO, etc.
  - Por Operario (Cascada): fila por operario, muestra que hace en cada bloque.
"""

import streamlit as st
import pandas as pd
from dashboard.components.tables import (
    build_daily_df, build_daily_df_with_operators,
    build_cascade_df, style_by_resource, style_cascade_by_model,
    generate_daily_pdf, generate_week_pdf, RESOURCE_COLORS, json_copy_btn,
)


def render():
    """Renderiza la vista de programa diario."""
    daily_results = st.session_state.daily_results

    # Filtrar dias con produccion (mantener orden de params["days"])
    day_order = [d["name"] for d in st.session_state.params["days"]] if st.session_state.params else []
    active_days = [
        day for day in day_order
        if day in daily_results and daily_results[day]["summary"]["total_pares"] > 0
    ]
    # Fallback: dias no cubiertos por params (no deberia pasar)
    for day, data in daily_results.items():
        if day not in active_days and data["summary"]["total_pares"] > 0:
            active_days.append(day)

    if not active_days:
        st.info("No hay dias con produccion programada.")
        return

    # --- Selector de dia (con modelos programados) ---
    def _day_label(day_name):
        schedule = daily_results[day_name].get("schedule", [])
        modelos = sorted({e["modelo"] for e in schedule})
        return f"{day_name}  ({len(modelos)} modelos: {', '.join(modelos)})"

    col_sel, col_pdf_week = st.columns([5, 1])
    with col_sel:
        selected_day = st.selectbox(
            "Seleccionar Dia", active_days, format_func=_day_label,
        )
    with col_pdf_week:
        st.markdown("<br>", unsafe_allow_html=True)
        _render_week_pdf_download(daily_results, active_days)

    day_data = daily_results[selected_day]
    st.session_state._pdf_day = selected_day
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

    schedule = day_data["schedule"]
    if not schedule:
        st.info("No hay operaciones programadas para este dia.")
        return

    block_labels = summary["block_labels"]
    has_assignments = "assignments" in day_data and day_data["assignments"]

    # --- Toggle de vista ---
    if has_assignments:
        view_mode = st.radio(
            "Vista",
            ["Por Operacion", "Por Operario (Cascada)"],
            horizontal=True,
        )
    else:
        view_mode = "Por Operacion"

    # --- Warnings de operarios sin asignar ---
    if has_assignments:
        unassigned = day_data.get("unassigned_ops", [])
        if unassigned:
            total_ops = len(unassigned)
            parcial = sum(1 for u in unassigned if u.get("parcial"))
            total_sin = total_ops - parcial
            pares_sin = sum(u["total_pares"] for u in unassigned)
            parts = []
            if total_sin:
                parts.append(f"{total_sin} completa(s)")
            if parcial:
                parts.append(f"{parcial} parcial(es)")
            st.warning(
                f"{total_ops} operacion(es) sin operario asignado "
                f"({', '.join(parts)}, {pares_sin:,} pares)"
            )

    if view_mode == "Por Operacion":
        _render_operation_view(day_data, block_labels, has_assignments)
    else:
        _render_cascade_view(day_data, block_labels)

    # --- Leyenda de colores ---
    with st.expander("Leyenda de colores por recurso"):
        cols = st.columns(len(RESOURCE_COLORS))
        for i, (recurso, color) in enumerate(RESOURCE_COLORS.items()):
            cols[i].markdown(
                f'<div style="background-color:{color}; color:#fff; '
                f'padding:6px 10px; border-radius:4px; text-align:center; '
                f'font-size:0.85em; font-weight:bold">{recurso}</div>',
                unsafe_allow_html=True,
            )

    # --- Filas resumen (siempre visibles) ---
    st.divider()
    st.subheader("Resumen por Bloque")

    summary_rows = []
    row_pares = {"Concepto": "TOTAL PARES"}
    for b_idx, label in enumerate(block_labels):
        row_pares[label] = summary["block_pares"][b_idx] if b_idx < len(summary["block_pares"]) else 0
    row_pares["TOTAL"] = sum(summary["block_pares"])
    summary_rows.append(row_pares)

    row_hc = {"Concepto": "HC TOTAL"}
    for b_idx, label in enumerate(block_labels):
        row_hc[label] = summary["block_hc"][b_idx] if b_idx < len(summary["block_hc"]) else 0
    row_hc["TOTAL"] = ""
    summary_rows.append(row_hc)

    df_summary = pd.DataFrame(summary_rows)
    st.dataframe(df_summary, width="stretch", hide_index=True)
    json_copy_btn(df_summary, "day_summary")


def _render_operation_view(day_data, block_labels, has_assignments):
    """Vista clasica por operacion, con columna OPERARIO si hay asignaciones."""
    if has_assignments:
        df = build_daily_df_with_operators(day_data["assignments"], block_labels)
    else:
        df = build_daily_df(day_data["schedule"], block_labels)

    # Filtros
    col_f1, col_f2 = st.columns(2)
    with col_f1:
        modelos = sorted(df["MODELO"].unique())
        sel_modelos = st.multiselect("Filtrar por Modelo", modelos, default=modelos)
    with col_f2:
        recursos = sorted(df["RECURSO"].unique())
        sel_recursos = st.multiselect("Filtrar por Recurso", recursos, default=recursos)

    mask = df["MODELO"].isin(sel_modelos) & df["RECURSO"].isin(sel_recursos)
    df_filtered = df[mask].reset_index(drop=True)

    st.subheader("Programa de Operaciones")

    # Columnas a mostrar
    if has_assignments:
        show_cols = ["MODELO", "FRACC", "OPERACION", "RECURSO", "OPERARIO",
                     "RATE", "HC"] + block_labels + ["TOTAL"]
        if df_filtered["ROBOT"].any():
            show_cols.append("ROBOT")
        show_cols.append("PENDIENTE")
    else:
        show_cols = ["MODELO", "FRACC", "OPERACION", "RECURSO",
                     "RATE", "HC"] + block_labels + ["TOTAL"]
        if "ROBOTS" in df_filtered.columns and df_filtered["ROBOTS"].any():
            show_cols.append("ROBOTS")

    df_show = df_filtered[[c for c in show_cols if c in df_filtered.columns]]
    styled = df_show.style.apply(
        lambda _: style_by_resource(df_show, block_labels), axis=None
    ).format(precision=1, subset=["HC"])

    # Formatear columnas numericas sin decimales
    int_cols = block_labels + ["TOTAL", "RATE"]
    if "PENDIENTE" in df_show.columns:
        int_cols.append("PENDIENTE")
    for col in int_cols:
        if col in df_show.columns:
            styled = styled.format(precision=0, subset=[col])

    st.dataframe(styled, width="stretch", height=500, hide_index=True)

    # --- Botones: JSON + PDF ---
    col_j, col_p, _ = st.columns([1, 1, 6])
    with col_j:
        json_copy_btn(df_show, "day_ops")
    with col_p:
        _render_pdf_download(df_show, block_labels)


def _get_week_label():
    """Obtiene label de semana desde session_state."""
    year = st.session_state.get("pedido_year", "")
    week = st.session_state.get("pedido_week", "")
    result_name = st.session_state.get("current_result_name", "")
    if year and week:
        return f"Semana {int(week)}, {int(year)}"
    elif result_name:
        return result_name.replace("_", " ").title()
    return ""


def _render_pdf_download(df, block_labels):
    """Boton de descarga PDF del programa diario (un dia)."""
    day_name = st.session_state.get("_pdf_day", "")
    week_label = _get_week_label()

    try:
        pdf_bytes = generate_daily_pdf(day_name, week_label, df, block_labels)
        safe_day = day_name.replace(" ", "_") if day_name else "dia"
        st.download_button(
            "PDF Dia",
            data=pdf_bytes,
            file_name=f"programa_{safe_day}.pdf",
            mime="application/pdf",
        )
    except Exception as e:
        st.error(f"Error PDF: {e}")


def _render_week_pdf_download(daily_results, active_days):
    """Boton de descarga PDF con todos los dias de la semana."""
    week_label = _get_week_label()
    try:
        pdf_bytes = generate_week_pdf(daily_results, active_days, week_label)
        st.download_button(
            "PDF Semana",
            data=pdf_bytes,
            file_name="programa_semana.pdf",
            mime="application/pdf",
        )
    except Exception as e:
        st.error(f"Error PDF: {e}")


def _render_cascade_view(day_data, block_labels):
    """Vista cascada: fila por operario, columna por bloque."""
    timelines = day_data.get("operator_timelines", {})
    if not timelines:
        st.info("No hay timelines de operarios disponibles.")
        return

    st.subheader("Programa por Operario (Cascada)")
    st.caption("Cada fila muestra que hace cada operario en cada bloque horario. "
               "Los cambios de modelo/color indican cascada entre modelos.")

    df = build_cascade_df(timelines, block_labels)

    if df.empty:
        st.info("Sin asignaciones de operarios.")
        return

    styled = df.style.apply(
        lambda _: style_cascade_by_model(df, block_labels), axis=None
    )

    st.dataframe(styled, width="stretch", height=600, hide_index=True)
    json_copy_btn(df, "cascade")

    # Detalle de operaciones sin asignar
    unassigned = day_data.get("unassigned_ops", [])
    if unassigned:
        with st.expander(f"Operaciones sin asignar ({len(unassigned)})"):
            for item in unassigned:
                tag = " [parcial]" if item.get("parcial") else ""
                st.text(f"  {item['modelo']} F{item['fraccion']} "
                        f"{item['operacion']} ({item['total_pares']}p) "
                        f"- Recurso: {item['recurso']}{tag}")
