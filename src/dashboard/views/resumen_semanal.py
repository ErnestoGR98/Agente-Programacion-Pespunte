"""
resumen_semanal.py - Tab 1: Vista general de la semana.

Incluye deteccion de desviaciones (avance vs plan) y comparador de versiones.
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

    # --- Seccion de desviaciones (solo si hay avance) ---
    _render_deviation_section(summary, schedule)

    # --- Comparador de versiones ---
    _render_version_comparison(summary)


# ---------------------------------------------------------------------------
# Deteccion de Desviaciones: avance real vs plan programado
# ---------------------------------------------------------------------------

def _render_deviation_section(summary, schedule):
    """Muestra desviaciones entre avance real y plan programado."""
    avance = st.session_state.get("avance") or {}
    avance_modelos = avance.get("modelos", {})
    if not avance_modelos or not schedule:
        return

    st.divider()
    st.subheader("Desviaciones: Avance vs Plan")

    # Pivotear plan: modelo_num -> {dia: pares}
    plan_by_model = {}
    for entry in schedule:
        modelo_code = entry["Modelo"]
        modelo_num = modelo_code.split()[0]  # "65568 NE" -> "65568"
        dia = entry["Dia"]
        plan_by_model.setdefault(modelo_num, {})[dia] = (
            plan_by_model.get(modelo_num, {}).get(dia, 0) + entry["Pares"]
        )

    # Obtener dias en orden
    day_order = [d["dia"] for d in summary["days"]]

    # Todos los modelos (union de plan y avance)
    all_models = sorted(set(plan_by_model.keys()) | set(avance_modelos.keys()))

    if not all_models:
        return

    # Construir tabla comparativa
    rows = []
    total_plan = 0
    total_real = 0
    models_with_deviation = 0

    for modelo in all_models:
        plan_days = plan_by_model.get(modelo, {})
        real_days = avance_modelos.get(modelo, {})
        row = {"MODELO": modelo}
        model_plan = 0
        model_real = 0

        for dia in day_order:
            p = plan_days.get(dia, 0)
            r = real_days.get(dia, 0)
            if p > 0 or r > 0:
                row[f"{dia[:3]}_Plan"] = p
                row[f"{dia[:3]}_Real"] = r
                diff = r - p
                row[f"{dia[:3]}_Desv"] = diff
            model_plan += p
            model_real += r

        row["TOTAL_Plan"] = model_plan
        row["TOTAL_Real"] = model_real
        if model_plan > 0:
            pct = (model_real / model_plan) * 100
            row["Cumpl_%"] = pct
            if abs(pct - 100) > 20:
                models_with_deviation += 1
        else:
            row["Cumpl_%"] = 0.0 if model_real == 0 else 999.0

        total_plan += model_plan
        total_real += model_real
        rows.append(row)

    df_dev = pd.DataFrame(rows)

    # KPIs de desviacion
    cumpl_global = (total_real / total_plan * 100) if total_plan > 0 else 0
    c1, c2, c3 = st.columns(3)
    c1.metric("Cumplimiento Global", f"{cumpl_global:.1f}%")
    c2.metric("Modelos con Desviacion >20%", models_with_deviation)
    c3.metric("Pendiente Real", f"{max(0, total_plan - total_real):,}p")

    if models_with_deviation > 0:
        st.warning(
            f"{models_with_deviation} modelo(s) con desviacion significativa. "
            "Considera re-optimizar con el avance actualizado."
        )

    # Estilo semaforo
    desv_cols = [c for c in df_dev.columns if c.endswith("_Desv")]
    cumpl_col = "Cumpl_%"

    def _style_deviation(df):
        styles = pd.DataFrame("", index=df.index, columns=df.columns)
        # Colorear columnas de desviacion
        for col in desv_cols:
            if col in df.columns:
                for idx in df.index:
                    val = df.at[idx, col]
                    plan_col = col.replace("_Desv", "_Plan")
                    plan_val = df.at[idx, plan_col] if plan_col in df.columns else 0
                    if plan_val == 0:
                        continue
                    pct_dev = abs(val / plan_val) * 100 if plan_val > 0 else 0
                    if pct_dev > 25:
                        styles.at[idx, col] = "background-color: #FFCDD2; color: #B71C1C"
                    elif pct_dev > 10:
                        styles.at[idx, col] = "background-color: #FFF9C4; color: #F57F17"
        # Colorear cumplimiento
        if cumpl_col in df.columns:
            for idx in df.index:
                val = df.at[idx, cumpl_col]
                if val < 75:
                    styles.at[idx, cumpl_col] = "background-color: #FFCDD2; color: #B71C1C"
                elif val < 90:
                    styles.at[idx, cumpl_col] = "background-color: #FFF9C4; color: #F57F17"
                elif val <= 110:
                    styles.at[idx, cumpl_col] = "background-color: #C8E6C9; color: #1B5E20"
        return styles

    styled = df_dev.style.apply(lambda _: _style_deviation(df_dev), axis=None)
    # Formatear porcentaje
    if cumpl_col in df_dev.columns:
        styled = styled.format({cumpl_col: "{:.1f}%"})
    # Formatear enteros
    int_cols = [c for c in df_dev.columns if c != "MODELO" and c != cumpl_col]
    for col in int_cols:
        if col in df_dev.columns:
            styled = styled.format({col: "{:.0f}"})

    st.dataframe(styled, width="stretch", hide_index=True)
    json_copy_btn(df_dev, "desviaciones")


# ---------------------------------------------------------------------------
# Comparador de Versiones
# ---------------------------------------------------------------------------

def _render_version_comparison(summary):
    """Compara la version actual con otra version guardada."""
    from dashboard.data_manager import (
        list_versions, load_optimization_results, parse_version_name,
    )

    current_name = st.session_state.get("current_result_name", "")
    if not current_name:
        return

    base_name, current_ver = parse_version_name(current_name)
    if current_ver == 0:
        return

    versions = list_versions(base_name)
    if len(versions) < 2:
        return

    st.divider()
    st.subheader("Comparar Versiones")

    # Selectbox con versiones disponibles (excluir la actual)
    other_versions = [v for v in versions if v["nombre"] != current_name]
    options = {
        f"v{v['version']} | {v['total_pares']:,}p | {v['fecha_optimizacion'][:10]} | {v.get('nota', '')}": v["nombre"]
        for v in other_versions
    }

    selected_label = st.selectbox(
        f"Comparar v{current_ver} (actual) con:",
        list(options.keys()),
        key="version_compare_select",
    )

    if not selected_label:
        return

    other_name = options[selected_label]
    other_data = load_optimization_results(other_name)
    if not other_data:
        st.error("No se pudo cargar la version seleccionada")
        return

    other_summary = other_data.get("weekly_summary", {})
    other_schedule = other_data.get("weekly_schedule", [])

    _, other_ver = parse_version_name(other_name)

    # Tabla de KPIs lado a lado
    st.markdown("**KPIs**")
    kpi_rows = []
    kpi_defs = [
        ("Total Pares", "total_pares", False),
        ("Pendientes (Tardiness)", "total_tardiness", True),
        ("Estado", "status", None),
        ("Tiempo Solver (s)", "wall_time_s", None),
    ]
    for label, key, lower_is_better in kpi_defs:
        val_a = summary.get(key, 0)
        val_b = other_summary.get(key, 0)
        row = {
            "Metrica": label,
            f"v{current_ver} (actual)": val_a,
            f"v{other_ver}": val_b,
        }
        if isinstance(val_a, (int, float)) and isinstance(val_b, (int, float)):
            delta = val_a - val_b
            row["Delta"] = delta
        else:
            row["Delta"] = ""
        kpi_rows.append(row)

    df_kpi = pd.DataFrame(kpi_rows)

    def _style_kpi(df):
        styles = pd.DataFrame("", index=df.index, columns=df.columns)
        for idx, row_data in enumerate(kpi_defs):
            label, key, lower_is_better = row_data
            if lower_is_better is None:
                continue
            delta_val = df.at[idx, "Delta"]
            if not isinstance(delta_val, (int, float)) or delta_val == 0:
                continue
            # Para tardiness: menor es mejor, para pares: mayor es mejor
            is_improvement = (delta_val < 0) if lower_is_better else (delta_val > 0)
            color = "background-color: #C8E6C9; color: #1B5E20" if is_improvement else "background-color: #FFCDD2; color: #B71C1C"
            styles.at[idx, "Delta"] = color
        return styles

    styled_kpi = df_kpi.style.apply(lambda _: _style_kpi(df_kpi), axis=None)
    st.dataframe(styled_kpi, width="stretch", hide_index=True)

    # Tabla de modelos: diferencias
    models_a = {m["codigo"]: m for m in summary.get("models", [])}
    models_b = {m["codigo"]: m for m in other_summary.get("models", [])}
    all_model_codes = sorted(set(models_a.keys()) | set(models_b.keys()))

    if all_model_codes:
        st.markdown("**Detalle por Modelo**")
        model_rows = []
        for code in all_model_codes:
            ma = models_a.get(code, {})
            mb = models_b.get(code, {})
            prod_a = ma.get("producido", 0)
            prod_b = mb.get("producido", 0)
            tard_a = ma.get("tardiness", 0)
            tard_b = mb.get("tardiness", 0)
            model_rows.append({
                "Modelo": code,
                f"Pares v{current_ver}": prod_a,
                f"Pares v{other_ver}": prod_b,
                "Delta Pares": prod_a - prod_b,
                f"Pend v{current_ver}": tard_a,
                f"Pend v{other_ver}": tard_b,
                "Delta Pend": tard_a - tard_b,
            })

        df_models_cmp = pd.DataFrame(model_rows)

        def _style_model_cmp(df):
            styles = pd.DataFrame("", index=df.index, columns=df.columns)
            for idx in df.index:
                # Delta pares: mas es mejor (verde)
                dp = df.at[idx, "Delta Pares"]
                if dp > 0:
                    styles.at[idx, "Delta Pares"] = "background-color: #C8E6C9; color: #1B5E20"
                elif dp < 0:
                    styles.at[idx, "Delta Pares"] = "background-color: #FFCDD2; color: #B71C1C"
                # Delta pendiente: menos es mejor (verde)
                dt = df.at[idx, "Delta Pend"]
                if dt < 0:
                    styles.at[idx, "Delta Pend"] = "background-color: #C8E6C9; color: #1B5E20"
                elif dt > 0:
                    styles.at[idx, "Delta Pend"] = "background-color: #FFCDD2; color: #B71C1C"
            return styles

        styled_models = df_models_cmp.style.apply(
            lambda _: _style_model_cmp(df_models_cmp), axis=None
        )
        st.dataframe(styled_models, width="stretch", hide_index=True)
        json_copy_btn(df_models_cmp, "version_comparison")
