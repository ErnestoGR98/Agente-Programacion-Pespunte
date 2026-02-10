"""
state.py - Manejo de session_state y pipeline de datos para el dashboard.

Importa los modulos existentes del sistema de programacion y expone
funciones para cargar datos, optimizar, y exportar desde Streamlit.
"""

import sys
import os
import io
import tempfile
from pathlib import Path
from copy import deepcopy

import streamlit as st

# Agregar src/ al path para importar modulos existentes
SRC_DIR = str(Path(__file__).parent.parent)
if SRC_DIR not in sys.path:
    sys.path.insert(0, SRC_DIR)

from loader import load_sabana, match_models
from catalog_loader import load_catalog_v2
from fuzzy_match import build_operator_registry
from rules import get_default_params
from optimizer_weekly import optimize
from optimizer_v2 import schedule_week
from exporter import export_schedule


def init_state():
    """Inicializa session_state con valores por defecto."""
    defaults = {
        "pipeline_step": 0,       # 0=sin datos, 1=cargado, 2=optimizado
        "sabana_path": None,
        "catalog_path": None,
        "sabana_models": None,
        "days_info": None,
        "catalog": None,
        "matched_models": None,
        "unmatched_models": None,
        "operator_registry": None,
        "params": None,
        "weekly_schedule": None,
        "weekly_summary": None,
        "daily_results": None,
        "pedido_rows": [],        # Lista de pedido actual (formulario)
    }
    for key, val in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = val

    # Auto-cargar catalogo persistido al iniciar
    from dashboard.data_manager import load_catalog as dm_load_catalog
    if st.session_state.catalog is None:
        saved_catalog = dm_load_catalog()
        if saved_catalog:
            st.session_state.catalog = saved_catalog


def _save_uploaded_file(uploaded_file):
    """Guarda un UploadedFile de Streamlit a un archivo temporal."""
    suffix = os.path.splitext(uploaded_file.name)[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(uploaded_file.getbuffer())
        return tmp.name


def load_data(sabana_file, catalog_file):
    """
    Carga y parsea los archivos de entrada.
    Almacena resultados en session_state.

    Returns:
        dict con resumen del resultado
    """
    # Guardar archivos temporales
    sabana_path = _save_uploaded_file(sabana_file)
    catalog_path = _save_uploaded_file(catalog_file)
    st.session_state.sabana_path = sabana_path
    st.session_state.catalog_path = catalog_path

    # Cargar sabana
    sabana_models, days_info = load_sabana(sabana_path)
    st.session_state.sabana_models = sabana_models
    st.session_state.days_info = days_info

    # Cargar catalogo
    catalog = load_catalog_v2(catalog_path)
    st.session_state.catalog = catalog

    # Registro de operarios
    operator_registry = build_operator_registry(sabana_path)
    st.session_state.operator_registry = operator_registry

    # Cruzar datos
    matched, unmatched = match_models(sabana_models, catalog)
    st.session_state.matched_models = matched
    st.session_state.unmatched_models = unmatched

    # Inicializar parametros
    params = get_default_params()
    # Ajustar nombres de dias segun sabana
    for day_cfg in params["days"]:
        for day_info in days_info:
            if day_info["name"].startswith(day_cfg["name"]):
                day_cfg["name"] = day_info["name"]
                break
    st.session_state.params = params

    # Marcar paso completado
    st.session_state.pipeline_step = 1
    # Limpiar resultados anteriores
    st.session_state.weekly_schedule = None
    st.session_state.weekly_summary = None
    st.session_state.daily_results = None

    return {
        "modelos": len(sabana_models),
        "matched": len(matched),
        "unmatched": len(unmatched),
        "operarios": len(operator_registry),
        "dias": [d["name"] for d in days_info],
        "total_pares": sum(m["total_producir"] for m in matched),
    }


def run_optimization(params):
    """
    Ejecuta la optimizacion semanal + diaria con los parametros dados.
    Almacena resultados en session_state.

    Returns:
        dict con resumen del resultado
    """
    matched = st.session_state.matched_models
    if not matched:
        return {"error": "No hay modelos cargados"}

    # Optimizacion semanal
    weekly_schedule, weekly_summary = optimize(matched, params)
    st.session_state.weekly_schedule = weekly_schedule
    st.session_state.weekly_summary = weekly_summary

    # Scheduling diario
    daily_results = schedule_week(weekly_schedule, matched, params)
    st.session_state.daily_results = daily_results

    # Actualizar params en state
    st.session_state.params = params

    st.session_state.pipeline_step = 2

    return {
        "status": weekly_summary["status"],
        "total_pares": weekly_summary["total_pares"],
        "tardiness": weekly_summary["total_tardiness"],
        "wall_time": weekly_summary["wall_time_s"],
    }


def generate_excel_bytes():
    """Genera el archivo Excel en memoria para descarga."""
    buffer = io.BytesIO()
    export_schedule(
        st.session_state.weekly_schedule,
        st.session_state.weekly_summary,
        buffer,
        daily_results=st.session_state.daily_results,
    )
    buffer.seek(0)
    return buffer.getvalue()
