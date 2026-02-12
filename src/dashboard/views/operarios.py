"""
operarios.py - Gestion de operarios: habilidades, disponibilidad y eficiencia.

Permite registrar operarios, asignar recursos y robots que saben operar,
definir dias disponibles y eficiencia individual.
"""

import streamlit as st
import pandas as pd

from dashboard.components.tables import json_copy_btn
from dashboard.data_manager import (
    load_operarios, save_operarios, save_operario, delete_operario,
    compute_headcount_by_resource,
    VALID_RESOURCES,
)
from config_manager import get_fabricas, get_physical_robots, load_config


def _to_upper(key):
    """Callback: convierte a mayusculas el valor de un widget."""
    if key in st.session_state and isinstance(st.session_state[key], str):
        st.session_state[key] = st.session_state[key].upper()


def _get_day_names() -> list:
    """Obtiene nombres de dias desde config."""
    config = load_config()
    return [d["name"] for d in config["days"]]


def render():
    """Renderiza la pagina de gestion de operarios."""
    st.subheader("Gestion de Operarios")
    st.caption("Registro de personal, habilidades y disponibilidad semanal")

    operarios = load_operarios()

    _render_summary(operarios)
    st.divider()
    _render_add_form(operarios)
    st.divider()
    _render_table(operarios)

    if operarios:
        st.divider()
        _render_individual_edit(operarios)
        st.divider()
        _render_headcount_validation(operarios)


# ===========================================================================
# SECCION 1: Resumen
# ===========================================================================

def _render_summary(operarios):
    """Metricas resumen de operarios."""
    if not operarios:
        st.info("No hay operarios registrados. Agregue operarios con el formulario.")
        return

    activos = [op for op in operarios if op.get("activo", True)]
    inactivos = len(operarios) - len(activos)

    c1, c2, c3 = st.columns(3)
    c1.metric("Total Operarios", len(operarios))
    c2.metric("Activos", len(activos))
    c3.metric("Inactivos", inactivos)

    # Por fabrica
    fab_counts = {}
    for op in activos:
        fab = op.get("fabrica", "SIN FABRICA")
        fab_counts[fab] = fab_counts.get(fab, 0) + 1
    if fab_counts:
        cols = st.columns(len(fab_counts))
        for i, (fab, count) in enumerate(sorted(fab_counts.items())):
            cols[i].metric(fab, count)

    # Por recurso
    res_counts = {}
    for op in activos:
        for r in op.get("recursos_habilitados", []):
            res_counts[r] = res_counts.get(r, 0) + 1
    if res_counts:
        n = min(len(res_counts), 6)
        cols = st.columns(n)
        for i, (res, count) in enumerate(sorted(res_counts.items())):
            cols[i % n].metric(res, count)


# ===========================================================================
# SECCION 2: Agregar Operario
# ===========================================================================

def _render_add_form(operarios):
    """Formulario para agregar un nuevo operario."""
    st.subheader("Agregar Operario")

    if "_op_form_ver" not in st.session_state:
        st.session_state._op_form_ver = 0
    fv = st.session_state._op_form_ver

    day_names = _get_day_names()
    fabricas = get_fabricas()
    robots = get_physical_robots()
    recursos = sorted(VALID_RESOURCES)

    col1, col2 = st.columns(2)
    with col1:
        nombre = st.text_input(
            "Nombre",
            key=f"op_nombre_{fv}",
            placeholder="Ej: ARACELI",
            on_change=_to_upper, args=(f"op_nombre_{fv}",),
        )
    with col2:
        fabrica = st.selectbox(
            "Fabrica",
            options=fabricas,
            key=f"op_fabrica_{fv}",
        )

    col3, col4 = st.columns(2)
    with col3:
        recursos_sel = st.multiselect(
            "Recursos Habilitados",
            options=recursos,
            key=f"op_recursos_{fv}",
            help="Tipos de estacion que sabe operar",
        )
    with col4:
        robots_sel = st.multiselect(
            "Robots Habilitados",
            options=robots,
            key=f"op_robots_{fv}",
            help="Robots en los que esta certificado",
        )

    col5, col6 = st.columns(2)
    with col5:
        weekdays = [d for d in day_names if d != "Sab"]
        dias_sel = st.multiselect(
            "Dias Disponibles",
            options=day_names,
            default=weekdays,
            key=f"op_dias_{fv}",
        )
    with col6:
        eficiencia = st.slider(
            "Eficiencia",
            min_value=0.5, max_value=1.5, value=1.0, step=0.05,
            key=f"op_eficiencia_{fv}",
            help="1.0 = velocidad estandar. >1 mas rapido, <1 mas lento",
        )

    # Validacion
    nombre_clean = nombre.strip().upper() if nombre else ""
    can_add = bool(nombre_clean) and len(recursos_sel) > 0

    existing_names = {(op["nombre"], op["fabrica"]) for op in operarios}
    is_duplicate = (nombre_clean, fabrica) in existing_names if nombre_clean else False
    if is_duplicate:
        st.warning(f"Ya existe un operario '{nombre_clean}' en {fabrica}")

    if st.button("Agregar Operario", type="primary", disabled=(not can_add or is_duplicate)):
        new_op = {
            "nombre": nombre_clean,
            "fabrica": fabrica,
            "recursos_habilitados": recursos_sel,
            "robots_habilitados": robots_sel,
            "eficiencia": round(eficiencia, 2),
            "dias_disponibles": dias_sel,
            "activo": True,
        }
        saved = save_operario(new_op)
        st.toast(f"Operario {nombre_clean} agregado (ID: {saved['id']})")
        st.session_state._op_form_ver += 1
        st.session_state.operarios = load_operarios()
        st.rerun()


# ===========================================================================
# SECCION 3: Tabla de Operarios
# ===========================================================================

def _render_table(operarios):
    """Tabla de operarios con toggle de activo."""
    if not operarios:
        return

    st.subheader(f"Operarios Registrados ({len(operarios)})")

    rows = []
    for op in operarios:
        rows.append({
            "ID": op.get("id", ""),
            "NOMBRE": op.get("nombre", ""),
            "FABRICA": op.get("fabrica", ""),
            "RECURSOS": ", ".join(op.get("recursos_habilitados", [])),
            "ROBOTS": ", ".join(op.get("robots_habilitados", [])),
            "EFICIENCIA": op.get("eficiencia", 1.0),
            "DIAS": ", ".join(op.get("dias_disponibles", [])),
            "ACTIVO": op.get("activo", True),
        })

    df = pd.DataFrame(rows)

    edited = st.data_editor(
        df,
        width="stretch",
        hide_index=True,
        disabled=["ID", "NOMBRE", "FABRICA", "RECURSOS", "ROBOTS", "EFICIENCIA", "DIAS"],
        height=min(500, 35 * (len(df) + 2) + 38),
        key="operarios_table_editor",
        column_config={
            "ID": st.column_config.TextColumn("ID", width="small"),
            "NOMBRE": st.column_config.TextColumn("Nombre", width="medium"),
            "FABRICA": st.column_config.TextColumn("Fabrica", width="small"),
            "RECURSOS": st.column_config.TextColumn("Recursos", width="medium"),
            "ROBOTS": st.column_config.TextColumn("Robots", width="medium"),
            "EFICIENCIA": st.column_config.NumberColumn("Efic.", format="%.2f", width="small"),
            "DIAS": st.column_config.TextColumn("Dias", width="medium"),
            "ACTIVO": st.column_config.CheckboxColumn("Activo", width="small"),
        },
    )

    json_copy_btn(df, "operarios_table")

    # Sincronizar cambios en activo
    changed = False
    for i, (_, row) in enumerate(edited.iterrows()):
        if i < len(operarios):
            new_activo = bool(row["ACTIVO"])
            if operarios[i].get("activo", True) != new_activo:
                operarios[i]["activo"] = new_activo
                changed = True
    if changed:
        save_operarios(operarios)
        st.session_state.operarios = operarios


# ===========================================================================
# SECCION 4: Editar Operario Individual
# ===========================================================================

def _render_individual_edit(operarios):
    """Formulario de edicion individual de operario."""
    st.subheader("Editar Operario")

    options = {f"{op['id']} - {op['nombre']} ({op['fabrica']})": op for op in operarios}
    selected_label = st.selectbox(
        "Seleccionar operario",
        options=[""] + list(options.keys()),
        key="op_edit_select",
    )

    if not selected_label:
        return

    op = options[selected_label]
    op_id = op["id"]
    day_names = _get_day_names()
    fabricas = get_fabricas()
    robots = get_physical_robots()
    recursos = sorted(VALID_RESOURCES)

    col1, col2 = st.columns(2)
    with col1:
        nombre_key = f"op_edit_nombre_{op_id}"
        edited_nombre = st.text_input(
            "Nombre", value=op["nombre"],
            key=nombre_key,
            on_change=_to_upper, args=(nombre_key,),
        )
    with col2:
        fab_idx = fabricas.index(op["fabrica"]) if op["fabrica"] in fabricas else 0
        edited_fabrica = st.selectbox(
            "Fabrica", options=fabricas,
            index=fab_idx,
            key=f"op_edit_fabrica_{op_id}",
        )

    col3, col4 = st.columns(2)
    with col3:
        default_recursos = [r for r in op.get("recursos_habilitados", []) if r in recursos]
        edited_recursos = st.multiselect(
            "Recursos Habilitados",
            options=recursos,
            default=default_recursos,
            key=f"op_edit_recursos_{op_id}",
        )
    with col4:
        default_robots = [r for r in op.get("robots_habilitados", []) if r in robots]
        edited_robots = st.multiselect(
            "Robots Habilitados",
            options=robots,
            default=default_robots,
            key=f"op_edit_robots_{op_id}",
        )

    col5, col6 = st.columns(2)
    with col5:
        default_dias = [d for d in op.get("dias_disponibles", []) if d in day_names]
        edited_dias = st.multiselect(
            "Dias Disponibles",
            options=day_names,
            default=default_dias,
            key=f"op_edit_dias_{op_id}",
        )
    with col6:
        edited_eficiencia = st.slider(
            "Eficiencia",
            min_value=0.5, max_value=1.5,
            value=float(op.get("eficiencia", 1.0)),
            step=0.05,
            key=f"op_edit_eficiencia_{op_id}",
        )

    edited_activo = st.checkbox(
        "Activo",
        value=op.get("activo", True),
        key=f"op_edit_activo_{op_id}",
    )

    col_save, col_del = st.columns(2)
    with col_save:
        if st.button("Guardar Cambios", type="primary", key=f"save_op_{op_id}"):
            updated = {
                "id": op_id,
                "nombre": edited_nombre.strip().upper(),
                "fabrica": edited_fabrica,
                "recursos_habilitados": edited_recursos,
                "robots_habilitados": edited_robots,
                "eficiencia": round(edited_eficiencia, 2),
                "dias_disponibles": edited_dias,
                "activo": edited_activo,
            }
            save_operario(updated)
            st.session_state.operarios = load_operarios()
            st.success(f"Operario {updated['nombre']} actualizado")
    with col_del:
        if st.button("Eliminar Operario", key=f"del_op_{op_id}"):
            delete_operario(op_id)
            st.session_state.operarios = load_operarios()
            st.success(f"Operario {op['nombre']} eliminado")
            st.rerun()


# ===========================================================================
# SECCION 5: Validacion Plantilla vs Headcount Real
# ===========================================================================

def _render_headcount_validation(operarios):
    """Comparacion: plantilla configurada vs headcount real por recurso."""
    st.subheader("Validacion: Plantilla vs Operarios")
    st.caption(
        "Compara la plantilla configurada por dia contra los operarios "
        "activos que pueden trabajar en cada recurso"
    )

    config = load_config()
    days = config["days"]

    rows = []
    warnings = []
    for day_cfg in days:
        day_name = day_cfg["name"]
        plantilla = day_cfg["plantilla"]

        available = [
            op for op in operarios
            if op.get("activo", True) and day_name in op.get("dias_disponibles", [])
        ]
        total_available = len(available)

        hc_by_resource = compute_headcount_by_resource(operarios, day_name)

        row = {
            "DIA": day_name,
            "PLANTILLA": plantilla,
            "DISPONIBLES": total_available,
        }
        for res in sorted(VALID_RESOURCES):
            row[res] = hc_by_resource.get(res, 0)
        rows.append(row)

        if total_available < plantilla:
            warnings.append(
                f"{day_name}: plantilla={plantilla} pero solo "
                f"{total_available} operarios disponibles"
            )

    df = pd.DataFrame(rows)
    st.dataframe(df, width="stretch", hide_index=True)
    json_copy_btn(df, "hc_validation")

    for w in warnings:
        st.warning(w)

    if not warnings and operarios:
        st.success("Todos los dias tienen suficientes operarios para cubrir la plantilla")
