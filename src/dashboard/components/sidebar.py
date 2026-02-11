"""
sidebar.py - Panel lateral con parametros, optimizacion y exportacion.

La carga de datos ahora se hace desde la pagina principal (datos.py).
El sidebar se enfoca en parametros y acciones.
"""

import streamlit as st
from dashboard.state import load_data, run_optimization, generate_excel_bytes


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
            st.success("Optimizacion completada")

        st.divider()

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


def _render_optimize_button():
    """Boton de optimizacion."""
    if st.button("Optimizar", type="primary", width="stretch"):
        with st.spinner("Ejecutando CP-SAT... (1-3 minutos)"):
            try:
                result = run_optimization(st.session_state.params)
                st.success(
                    f"Estado: {result['status']} | "
                    f"{result['total_pares']:,} pares | "
                    f"{result['wall_time']}s"
                )
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
