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
        "current_result_name": None,
        "operarios": None,
        "restricciones": None,
        "avance": None,
    }
    for key, val in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = val

    from dashboard.data_manager import (
        load_catalog as dm_load_catalog, load_pedido_draft,
        load_operarios, load_restricciones, load_avance,
    )

    # Auto-cargar catalogo persistido al iniciar
    if st.session_state.catalog is None:
        saved_catalog = dm_load_catalog()
        if saved_catalog:
            st.session_state.catalog = saved_catalog

    # Auto-cargar borrador del pedido al iniciar
    if "pedido_rows" not in st.session_state:
        st.session_state.pedido_rows = load_pedido_draft()

    # Auto-cargar operarios persistidos al iniciar
    if st.session_state.operarios is None:
        st.session_state.operarios = load_operarios()

    # Auto-cargar restricciones y avance al iniciar
    if st.session_state.restricciones is None:
        st.session_state.restricciones = load_restricciones()
    if st.session_state.avance is None:
        st.session_state.avance = load_avance()


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
    Almacena resultados en session_state y guarda a disco para acceso remoto.

    Returns:
        dict con resumen del resultado
    """
    matched = st.session_state.matched_models
    if not matched:
        return {"error": "No hay modelos cargados"}

    # Compilar restricciones dinamicas + avance
    from constraint_compiler import compile_constraints
    restricciones = st.session_state.get("restricciones") or []
    avance_data = st.session_state.get("avance") or {}
    compiled = compile_constraints(restricciones, avance_data, matched, params["days"])

    # Ajustar volumenes en copia de los modelos (no modificar originales)
    models_for_opt = deepcopy(matched)
    for m in models_for_opt:
        modelo_num = m.get("modelo_num", "")
        # Maquila: restar pares enviados afuera
        if modelo_num in compiled.maquila:
            m["total_producir"] = max(0, m["total_producir"] - compiled.maquila[modelo_num])
        # Override de volumen
        if modelo_num in compiled.volume_overrides:
            m["total_producir"] = compiled.volume_overrides[modelo_num]
        # Avance: restar lo ya producido
        if modelo_num in compiled.avance:
            already = sum(compiled.avance[modelo_num].values())
            m["total_producir"] = max(0, m["total_producir"] - already)

    # Ajustar plantilla por dia segun restricciones (AUSENCIA/CAPACIDAD)
    # Deepcopy para no modificar session_state
    params = deepcopy(params)
    if compiled:
        for day_cfg in params["days"]:
            dn = day_cfg["name"]
            if dn in compiled.plantilla_overrides:
                day_cfg["plantilla"] = compiled.plantilla_overrides[dn]
            elif dn in compiled.plantilla_adjustments:
                day_cfg["plantilla"] = max(1, day_cfg["plantilla"] + compiled.plantilla_adjustments[dn])

    # Optimizacion semanal (con restricciones)
    weekly_schedule, weekly_summary = optimize(models_for_opt, params, compiled)
    st.session_state.weekly_schedule = weekly_schedule
    st.session_state.weekly_summary = weekly_summary

    # Scheduling diario (con restricciones)
    daily_results = schedule_week(weekly_schedule, models_for_opt, params, compiled)
    st.session_state.daily_results = daily_results

    # Actualizar params en state
    st.session_state.params = params

    st.session_state.pipeline_step = 2

    # Auto-guardar resultados a disco (accesible desde otras computadoras via OneDrive)
    from dashboard.data_manager import save_optimization_results
    # Usar semana del selector de pedido si existe, sino generar automaticamente
    result_name = _get_result_name()
    save_optimization_results(
        name=result_name,
        weekly_schedule=weekly_schedule,
        weekly_summary=weekly_summary,
        daily_results=daily_results,
        pedido=st.session_state.get("pedido_rows"),
        params=params,
    )
    st.session_state.current_result_name = result_name

    return {
        "status": weekly_summary["status"],
        "total_pares": weekly_summary["total_pares"],
        "tardiness": weekly_summary["total_tardiness"],
        "wall_time": weekly_summary["wall_time_s"],
        "saved_as": result_name,
    }


def _get_result_name() -> str:
    """Obtiene nombre para resultado: del selector ISO si existe, sino semana actual."""
    # Intentar usar semana del selector de pedido
    year = st.session_state.get("pedido_year")
    week = st.session_state.get("pedido_week")
    if year and week:
        return f"sem_{int(week)}_{int(year)}"
    # Fallback: semana ISO actual
    from datetime import date
    today = date.today()
    iso = today.isocalendar()
    return f"sem_{iso[1]}_{iso[0]}"


def load_saved_results(name: str) -> bool:
    """
    Carga resultados de optimizacion guardados al session_state.

    Returns:
        True si se cargaron correctamente, False si no existe.
    """
    from dashboard.data_manager import load_optimization_results, build_matched_models, load_catalog

    data = load_optimization_results(name)
    if not data:
        return False

    st.session_state.weekly_schedule = data["weekly_schedule"]
    st.session_state.weekly_summary = data["weekly_summary"]
    st.session_state.daily_results = data["daily_results"]
    st.session_state.current_result_name = name

    # Restaurar pedido si estaba guardado
    if "pedido" in data and data["pedido"]:
        st.session_state.pedido_rows = data["pedido"]

    # Restaurar parametros si estaban guardados
    if "params" in data and data["params"]:
        if st.session_state.params:
            st.session_state.params.update(data["params"])
        else:
            st.session_state.params = get_default_params()
            st.session_state.params.update(data["params"])

    # Reconstruir matched_models desde pedido + catalogo
    if "pedido" in data and data["pedido"]:
        catalog = load_catalog()
        if catalog:
            matched, unmatched = build_matched_models(data["pedido"], catalog)
            st.session_state.matched_models = matched
            st.session_state.unmatched_models = unmatched
            st.session_state.catalog = catalog

    st.session_state.pipeline_step = 2
    return True


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
