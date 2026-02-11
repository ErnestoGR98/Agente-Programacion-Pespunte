"""
app.py - Entry point del dashboard Streamlit para el sistema de programacion.

Ejecutar con:
  cd pespunte-agent
  streamlit run src/dashboard/app.py
"""

import sys
from pathlib import Path

# Asegurar que src/ y src/dashboard/ estan en el path
SRC_DIR = str(Path(__file__).parent.parent)
if SRC_DIR not in sys.path:
    sys.path.insert(0, SRC_DIR)

DASHBOARD_DIR = str(Path(__file__).parent)
if DASHBOARD_DIR not in sys.path:
    sys.path.insert(0, DASHBOARD_DIR)

import streamlit as st

st.set_page_config(
    page_title="Pespunte - Programacion",
    page_icon=":athletic_shoe:",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Fix scroll Chrome: forzar overflow en contenedores internos de Streamlit
st.markdown("""
<style>
    /* Root app container */
    [data-testid="stAppViewContainer"] {
        overflow-y: auto !important;
        overflow-x: hidden !important;
    }
    /* Main content area */
    section.main {
        overflow-y: auto !important;
        overflow-x: hidden !important;
    }
    .main .block-container {
        overflow: visible !important;
        max-height: none !important;
    }
    /* Sidebar */
    section[data-testid="stSidebar"] > div {
        overflow-y: auto !important;
    }
    /* Contener data_editor para que no robe el scroll */
    [data-testid="stDataEditor"] > div {
        max-height: inherit;
    }
    iframe[title="streamlit_dataframe.dataframe"] {
        max-height: 400px;
    }
    /* Bordes visibles en tablas dataframe */
    [data-testid="stDataFrame"] table th {
        border-bottom: 2px solid #666 !important;
        border-right: 1px solid #555 !important;
        font-weight: bold !important;
    }
    [data-testid="stDataFrame"] table td {
        border-bottom: 1px solid #444 !important;
        border-right: 1px solid #3a3a3a !important;
    }
</style>
""", unsafe_allow_html=True)

from dashboard.state import init_state
from dashboard.components.sidebar import render_sidebar
from dashboard.views.datos import render as render_datos
from dashboard.views.resumen_semanal import render as render_resumen
from dashboard.views.programa_diario import render as render_programa
from dashboard.views.utilizacion import render as render_utilizacion
from dashboard.views.robots import render as render_robots
from dashboard.views.cuellos_botella import render as render_cuellos
from dashboard.views.configuracion import render as render_config
from dashboard.views.operarios import render as render_operarios
from dashboard.views.restricciones import render as render_restricciones
from dashboard.views.asistente import render as render_asistente

# Inicializar estado
init_state()

# Sidebar (siempre visible)
render_sidebar()

# Area principal - siempre mostrar tabs
st.title("Sistema de Programacion - Pespunte")

step = st.session_state.pipeline_step

if step >= 2:
    # Todos los tabs disponibles tras optimizacion
    tab_names = [
        "Datos", "Restricciones", "Resumen Semanal", "Programa Diario",
        "Utilizacion HC", "Robots", "Cuellos de Botella",
        "Asistente", "Operarios", "Configuracion",
    ]
    (tab_datos, tab_rest, tab1, tab2, tab3, tab4, tab5,
     tab_ai, tab_ops, tab_cfg) = st.tabs(tab_names)
    with tab1:
        render_resumen()
    with tab2:
        render_programa()
    with tab3:
        render_utilizacion()
    with tab4:
        render_robots()
    with tab5:
        render_cuellos()

elif step == 1:
    # Datos cargados, preview disponible
    tab_names = ["Datos", "Restricciones", "Preview", "Asistente", "Operarios", "Configuracion"]
    tab_datos, tab_rest, tab_preview, tab_ai, tab_ops, tab_cfg = st.tabs(tab_names)
    with tab_preview:
        st.subheader("Datos Cargados")
        st.info("Ajuste parametros en el panel izquierdo y presione **Optimizar**.")

        matched = st.session_state.matched_models
        if matched:
            st.markdown(f"**{len(matched)} Modelos Listos para Optimizar**")
            import pandas as pd
            rows = []
            for m in matched:
                rows.append({
                    "Modelo": m["codigo"],
                    "Fabrica": m["fabrica"],
                    "Volumen": m["total_producir"],
                    "Operaciones": m["num_ops"],
                    "Min/Par": round(m["total_sec_per_pair"] / 60, 1),
                })
            st.dataframe(pd.DataFrame(rows), width="stretch", hide_index=True)

        unmatched = st.session_state.unmatched_models
        if unmatched:
            st.warning(f"{len(unmatched)} modelos sin match en catalogo (excluidos):")
            for m in unmatched:
                st.text(f"  {m['codigo']} - Vol: {m['total_producir']}")

else:
    # Estado inicial: Datos + Restricciones + Asistente + Operarios + Configuracion
    tab_names = ["Datos", "Restricciones", "Asistente", "Operarios", "Configuracion"]
    tab_datos, tab_rest, tab_ai, tab_ops, tab_cfg = st.tabs(tab_names)

# Tabs comunes a todos los estados
with tab_datos:
    render_datos()
with tab_rest:
    render_restricciones()
with tab_ai:
    render_asistente()
with tab_ops:
    render_operarios()
with tab_cfg:
    render_config()
