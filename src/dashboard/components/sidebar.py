"""
sidebar.py - Panel lateral con parametros, optimizacion y exportacion.

La carga de datos ahora se hace desde la pagina principal (datos.py).
El sidebar se enfoca en parametros y acciones.
"""

import json
import streamlit as st
from dashboard.state import load_data, run_optimization, generate_excel_bytes, load_saved_results


def render_sidebar():
    """Renderiza el sidebar completo."""
    with st.sidebar:
        st.title("Pespunte")
        st.caption("Sistema de Programacion")

        # Status del pipeline
        step = st.session_state.pipeline_step
        if step == 0:
            st.info("Ingrese datos en la pagina principal")
        elif step == 1:
            st.success("Datos cargados - Listo para optimizar")
        elif step >= 2:
            result_name = st.session_state.get("current_result_name", "")
            if result_name:
                st.success(f"Optimizacion: {result_name}")
            else:
                st.success("Optimizacion completada")

        st.divider()

        # Resultados guardados (siempre visible)
        _render_saved_results()

        # Carga legacy (mantener por retrocompatibilidad)
        with st.expander("Carga Legacy (archivos originales)", expanded=False):
            _render_file_upload()

        if st.session_state.pipeline_step >= 1:
            _render_parameters()
            _render_optimize_button()

        if st.session_state.pipeline_step >= 2:
            _render_export()


def _render_file_upload():
    """Seccion de carga de archivos (legacy, para sabana original)."""
    sabana = st.file_uploader("Sabana Semanal", type=["xlsx"], key="legacy_sabana_upload")
    catalog = st.file_uploader("Catalogo de Fracciones", type=["xlsx"], key="legacy_catalog_upload")

    if st.button("Cargar (Legacy)", type="secondary",
                 disabled=(not sabana or not catalog),
                 width="stretch"):
        with st.spinner("Cargando archivos..."):
            try:
                result = load_data(sabana, catalog)
                st.success(
                    f"{result['matched']} modelos | "
                    f"{result['total_pares']:,} pares"
                )
                if result["unmatched"] > 0:
                    st.warning(f"{result['unmatched']} sin match")
            except Exception as e:
                st.error(f"Error: {e}")


def _render_parameters():
    """Seccion de parametros editables."""
    st.header("Parametros")
    params = st.session_state.params

    with st.expander("Plantilla por Dia", expanded=False):
        for day_cfg in params["days"]:
            day_cfg["plantilla"] = st.number_input(
                day_cfg["name"],
                min_value=1, max_value=50,
                value=day_cfg["plantilla"],
                key=f"plantilla_{day_cfg['name']}",
            )

    with st.expander("Capacidad de Recursos", expanded=False):
        cap = params["resource_capacity"]
        for res_type in ["MESA", "ROBOT", "PLANA", "POSTE-LINEA", "MESA-LINEA", "PLANA-LINEA"]:
            cap[res_type] = st.number_input(
                res_type,
                min_value=1, max_value=30,
                value=cap[res_type],
                key=f"cap_{res_type}",
            )


def _render_saved_results():
    """Seccion para cargar resultados guardados con versionado."""
    from dashboard.data_manager import list_optimization_results, delete_optimization_result
    from collections import OrderedDict

    with st.expander("Resultados Guardados", expanded=False):
        saved = list_optimization_results()
        if not saved:
            st.caption("No hay resultados guardados")
            return

        # Agrupar por base_name (ya vienen ordenados por base_name desc, version desc)
        groups = OrderedDict()
        for item in saved:
            bn = item["base_name"]
            if bn not in groups:
                groups[bn] = []
            groups[bn].append(item)

        current = st.session_state.get("current_result_name", "")

        for base_name, versions in groups.items():
            # Header de semana con total de versiones
            sem_label = base_name.replace("sem_", "Sem ").replace("_", " / ")
            st.markdown(f"**{sem_label}** ({len(versions)} ver.)")

            for item in versions:
                ver = item["version"]
                fecha = item["fecha_optimizacion"][5:16].replace("T", " ") if item["fecha_optimizacion"] else ""
                nota = item.get("nota", "")
                is_current = item["nombre"] == current

                # Indicador de version actual
                marker = "● " if is_current else "  "
                pares_str = f"{item['total_pares']:,}p"
                nota_str = f" - {nota}" if nota else ""
                label = f"{marker}v{ver} | {pares_str} | {fecha}{nota_str}"

                col1, col2 = st.columns([5, 1])
                with col1:
                    if st.button(label, key=f"load_result_{item['nombre']}",
                                 use_container_width=True,
                                 disabled=is_current):
                        if load_saved_results(item["nombre"]):
                            st.rerun()
                        else:
                            st.error("Error al cargar resultado")
                with col2:
                    if st.button("X", key=f"del_result_{item['nombre']}"):
                        delete_optimization_result(item["nombre"])
                        st.rerun()

            st.divider()


def _render_optimize_button():
    """Boton de optimizacion."""
    # Info de restricciones activas
    restricciones = st.session_state.get("restricciones") or []
    active_r = sum(1 for r in restricciones if r.get("activa", True))
    if active_r > 0:
        st.info(f"{active_r} restricciones activas")

    # Info de avance
    avance = st.session_state.get("avance") or {}
    if avance.get("modelos"):
        total_done = sum(
            sum(d.values()) for d in avance["modelos"].values()
        )
        if total_done > 0:
            st.info(f"Avance: {total_done:,} pares producidos")

    st.text_input("Nota de version (opcional)", key="optimization_note",
                   placeholder="Ej: Ajuste por retraso material")

    if st.button("Optimizar", type="primary", width="stretch"):
        with st.spinner("Ejecutando CP-SAT... (1-3 minutos)"):
            try:
                result = run_optimization(st.session_state.params)
                st.success(
                    f"Estado: {result['status']} | "
                    f"{result['total_pares']:,} pares | "
                    f"{result['wall_time']}s"
                )
                if result.get("saved_as"):
                    st.info(f"Guardado como: {result['saved_as']}")
                if result["tardiness"] > 0:
                    st.warning(f"{result['tardiness']:,} pares pendientes")
            except Exception as e:
                st.error(f"Error en optimizacion: {e}")


def _render_export():
    """Seccion de exportacion."""
    st.header("Exportar")
    try:
        excel_bytes = generate_excel_bytes()
        st.download_button(
            "Descargar Excel",
            data=excel_bytes,
            file_name="programacion_optimizada.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            width="stretch",
        )
    except Exception as e:
        st.error(f"Error al generar Excel: {e}")

    # Exportar resultados como JSON
    try:
        data = {}
        if st.session_state.weekly_schedule:
            data["weekly_schedule"] = st.session_state.weekly_schedule
        if st.session_state.weekly_summary:
            data["weekly_summary"] = st.session_state.weekly_summary
        if st.session_state.daily_results:
            data["daily_results"] = st.session_state.daily_results
        if data:
            json_bytes = json.dumps(data, ensure_ascii=False, indent=2, default=str).encode("utf-8")
            st.download_button(
                "Descargar JSON",
                data=json_bytes,
                file_name="programacion_optimizada.json",
                mime="application/json",
                width="stretch",
            )
    except Exception:
        pass
