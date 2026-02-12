"""
restricciones.py - Gestion de restricciones dinamicas y avance de produccion.

Permite agregar/editar/eliminar restricciones que afectan la optimizacion:
prioridad, maquila, retraso de material, fijar dia, secuencia, ajuste volumen.

El avance registra pares ya producidos por modelo y dia, congelando esos dias
al re-optimizar.
"""

import streamlit as st
import pandas as pd

from dashboard.components.tables import json_copy_btn
from dashboard.data_manager import (
    load_restricciones, save_restricciones, save_restriccion, delete_restriccion,
    load_avance, save_avance, load_catalog,
)
from config_manager import load_config, get_physical_robots


# Tipos de restriccion organizados por categoria
CONSTRAINT_TYPES_FRECUENTES = {
    "PRIORIDAD": "Prioridad del modelo (afecta orden)",
    "RETRASO_MATERIAL": "Material no disponible hasta cierto dia/hora",
    "MAQUILA": "Enviar pares a produccion externa",
    "ROBOT_NO_DISPONIBLE": "Robot descompuesto o en mantenimiento",
    "AUSENCIA_OPERARIO": "Operario ausente (reduce capacidad)",
    "CAPACIDAD_DIA": "Dia con capacidad reducida (junta, medio dia)",
}
CONSTRAINT_TYPES_MENOS_FRECUENTES = {
    "FIJAR_DIA": "Permitir o excluir dias para un modelo",
    "FECHA_LIMITE": "Modelo debe terminarse antes de cierto dia",
    "SECUENCIA": "Un modelo debe completarse antes que otro",
    "AGRUPAR_MODELOS": "Dos modelos deben producirse el mismo dia",
    "AJUSTE_VOLUMEN": "Modificar el volumen a producir",
    "LOTE_MINIMO_CUSTOM": "Lote minimo diferente para un modelo",
}
# Combinado para lookups
CONSTRAINT_TYPES = {**CONSTRAINT_TYPES_FRECUENTES, **CONSTRAINT_TYPES_MENOS_FRECUENTES}

# Tipos que no requieren un modelo especifico (aplican a la linea)
GLOBAL_TYPES = {"SECUENCIA", "ROBOT_NO_DISPONIBLE", "AUSENCIA_OPERARIO",
                "CAPACIDAD_DIA", "AGRUPAR_MODELOS"}


def _get_day_names() -> list:
    config = load_config()
    return [d["name"] for d in config["days"]]


def _get_modelo_options() -> list:
    """Retorna lista de modelos del pedido actual o del catalogo."""
    pedido = st.session_state.get("pedido_rows", [])
    if pedido:
        return sorted({item["modelo"] for item in pedido})
    catalog = load_catalog() or {}
    return sorted(catalog.keys())


def render():
    """Renderiza la pagina de restricciones y avance."""
    st.subheader("Restricciones y Avance")

    tab_rest, tab_avance = st.tabs(["Restricciones", "Avance de Produccion"])

    with tab_rest:
        _render_restricciones_tab()
    with tab_avance:
        _render_avance_tab()


# ===========================================================================
# TAB 1: Restricciones
# ===========================================================================

def _render_restricciones_tab():
    restricciones = load_restricciones()

    _render_summary(restricciones)
    st.divider()
    _render_add_form(restricciones)
    st.divider()
    _render_table(restricciones)

    if restricciones:
        st.divider()
        _render_impact_preview(restricciones)


def _render_summary(restricciones):
    if not restricciones:
        st.info("No hay restricciones definidas. Agregue restricciones con el formulario.")
        return

    activas = sum(1 for r in restricciones if r.get("activa", True))
    inactivas = len(restricciones) - activas
    modelos = len({r["modelo"] for r in restricciones if r.get("activa", True)})

    c1, c2, c3 = st.columns(3)
    c1.metric("Activas", activas)
    c2.metric("Inactivas", inactivas)
    c3.metric("Modelos Afectados", modelos)

    # Por tipo
    tipo_counts = {}
    for r in restricciones:
        if r.get("activa", True):
            tipo_counts[r["tipo"]] = tipo_counts.get(r["tipo"], 0) + 1
    if tipo_counts:
        n = min(len(tipo_counts), 6)
        cols = st.columns(n)
        for i, (tipo, count) in enumerate(sorted(tipo_counts.items())):
            cols[i % n].metric(tipo, count)


def _render_add_form(restricciones):
    st.subheader("Agregar Restriccion")

    if "_rest_form_ver" not in st.session_state:
        st.session_state._rest_form_ver = 0
    fv = st.session_state._rest_form_ver

    # Selector de categoria + tipo
    categoria = st.radio(
        "Categoria",
        ["Operativas", "Planificacion"],
        horizontal=True,
        key=f"rest_cat_{fv}",
        help="**Operativas**: restricciones del dia a dia. **Planificacion**: reglas de negocio menos frecuentes.",
    )
    if categoria == "Operativas":
        type_options = list(CONSTRAINT_TYPES_FRECUENTES.keys())
        type_descs = CONSTRAINT_TYPES_FRECUENTES
    else:
        type_options = list(CONSTRAINT_TYPES_MENOS_FRECUENTES.keys())
        type_descs = CONSTRAINT_TYPES_MENOS_FRECUENTES

    col1, col2 = st.columns(2)
    with col1:
        tipo = st.selectbox(
            "Tipo de Restriccion",
            options=type_options,
            format_func=lambda t: f"{t} - {type_descs[t]}",
            key=f"rest_tipo_{categoria}_{fv}",
        )
    with col2:
        modelos = _get_modelo_options()
        if tipo in GLOBAL_TYPES:
            if tipo in ("SECUENCIA", "AGRUPAR_MODELOS"):
                st.caption("Seleccione dos modelos en los campos de abajo")
            else:
                st.caption("Aplica a toda la linea (no requiere modelo)")
            modelo = "*"
        else:
            modelo = st.selectbox(
                "Modelo",
                options=modelos,
                key=f"rest_modelo_{fv}",
            ) if modelos else ""

    # Parametros dinamicos segun tipo
    params = _render_parametros_form(tipo, fv, modelos)

    nota = st.text_input("Nota (opcional)", key=f"rest_nota_{fv}",
                         placeholder="Ej: Cliente VIP, material retrasado...")

    can_add = bool(tipo)
    if tipo not in GLOBAL_TYPES and not modelo:
        can_add = False
    if tipo == "SECUENCIA" and (not params.get("modelo_antes") or not params.get("modelo_despues")):
        can_add = False
    if tipo == "AGRUPAR_MODELOS" and (not params.get("modelo_a") or not params.get("modelo_b")):
        can_add = False
    if tipo == "ROBOT_NO_DISPONIBLE" and not params.get("robot"):
        can_add = False

    if st.button("Agregar Restriccion", type="primary", disabled=(not can_add)):
        from datetime import datetime
        new_r = {
            "tipo": tipo,
            "modelo": modelo,
            "parametros": params,
            "activa": True,
            "nota": nota,
            "created_at": datetime.now().isoformat(),
        }
        saved = save_restriccion(new_r)
        st.toast(f"Restriccion {saved['id']} agregada ({tipo})")
        st.session_state._rest_form_ver += 1
        st.session_state.restricciones = load_restricciones()
        st.rerun()


def _render_parametros_form(tipo, fv, modelos):
    """Renderiza campos de parametros segun el tipo. Retorna dict de params."""
    params = {}

    if tipo == "PRIORIDAD":
        params["peso"] = st.selectbox(
            "Nivel de Prioridad",
            options=[1, 2, 3],
            format_func=lambda x: {1: "1 - Normal", 2: "2 - Alta", 3: "3 - Urgente"}[x],
            key=f"rp_peso_{fv}",
        )

    elif tipo == "MAQUILA":
        col1, col2 = st.columns(2)
        with col1:
            params["pares_maquila"] = st.number_input(
                "Pares a Maquila", min_value=50, step=50, value=100,
                key=f"rp_maquila_{fv}",
            )
        with col2:
            params["proveedor"] = st.text_input(
                "Proveedor", key=f"rp_proveedor_{fv}",
                placeholder="Ej: Taller Lopez",
            )

    elif tipo == "RETRASO_MATERIAL":
        day_names = _get_day_names()
        col1, col2 = st.columns(2)
        with col1:
            params["disponible_desde"] = st.selectbox(
                "Material Disponible Desde",
                options=day_names,
                index=2,  # default Mie
                key=f"rp_desde_{fv}",
                help="El modelo NO se producira en dias anteriores a este",
            )
        with col2:
            HOUR_OPTIONS = [
                "", "8:00", "9:00", "10:00", "11:00", "12:00",
                "13:50", "15:00", "16:00", "17:00", "18:00",
            ]
            hora = st.selectbox(
                "Hora Disponible (opcional)",
                options=HOUR_OPTIONS,
                format_func=lambda x: "No especificada" if x == "" else x,
                key=f"rp_hora_{fv}",
                help="Si el material llega a cierta hora, solo se bloquean los bloques anteriores ese dia",
            )
            if hora:
                params["hora_disponible"] = hora

    elif tipo == "FIJAR_DIA":
        day_names = _get_day_names()
        col1, col2 = st.columns(2)
        with col1:
            params["modo"] = st.radio(
                "Modo", ["PERMITIR", "EXCLUIR"],
                horizontal=True, key=f"rp_modo_{fv}",
                help="PERMITIR: solo estos dias. EXCLUIR: todos menos estos",
            )
        with col2:
            params["dias"] = st.multiselect(
                "Dias", options=day_names, key=f"rp_dias_{fv}",
            )

    elif tipo == "SECUENCIA":
        col1, col2 = st.columns(2)
        with col1:
            params["modelo_antes"] = st.selectbox(
                "Modelo que va PRIMERO",
                options=modelos,
                key=f"rp_antes_{fv}",
            ) if modelos else ""
        with col2:
            params["modelo_despues"] = st.selectbox(
                "Modelo que va DESPUES",
                options=modelos,
                key=f"rp_despues_{fv}",
            ) if modelos else ""

    elif tipo == "AJUSTE_VOLUMEN":
        col1, col2 = st.columns(2)
        with col1:
            params["nuevo_volumen"] = st.number_input(
                "Nuevo Volumen (pares)", min_value=0, step=50, value=500,
                key=f"rp_nuevo_vol_{fv}",
            )
        with col2:
            params["motivo"] = st.text_input(
                "Motivo", key=f"rp_motivo_{fv}",
                placeholder="Ej: Pedido reducido por cliente",
            )

    # --- Nuevos tipos ---

    elif tipo == "ROBOT_NO_DISPONIBLE":
        robots = get_physical_robots()
        day_names = _get_day_names()
        col1, col2 = st.columns(2)
        with col1:
            params["robot"] = st.selectbox(
                "Robot",
                options=robots,
                key=f"rp_robot_{fv}",
            ) if robots else ""
        with col2:
            params["dias"] = st.multiselect(
                "Dias (vacio = toda la semana)",
                options=day_names,
                key=f"rp_robot_dias_{fv}",
            )
        params["motivo"] = st.text_input(
            "Motivo", key=f"rp_robot_motivo_{fv}",
            placeholder="Ej: En mantenimiento, descompuesto",
        )

    elif tipo == "AUSENCIA_OPERARIO":
        day_names = _get_day_names()
        col1, col2, col3 = st.columns(3)
        with col1:
            params["operario"] = st.text_input(
                "Nombre Operario", key=f"rp_operario_{fv}",
                placeholder="Ej: Juan Lopez",
            )
        with col2:
            params["dia"] = st.selectbox(
                "Dia de Ausencia",
                options=day_names,
                key=f"rp_ausencia_dia_{fv}",
            )
        with col3:
            params["cantidad"] = st.number_input(
                "Personas ausentes", min_value=1, max_value=10, value=1,
                key=f"rp_ausencia_cant_{fv}",
            )

    elif tipo == "CAPACIDAD_DIA":
        day_names = _get_day_names()
        col1, col2, col3 = st.columns(3)
        with col1:
            params["dia"] = st.selectbox(
                "Dia",
                options=day_names,
                key=f"rp_cap_dia_{fv}",
            )
        with col2:
            params["nueva_plantilla"] = st.number_input(
                "Plantilla Efectiva", min_value=1, max_value=50, value=10,
                key=f"rp_cap_plantilla_{fv}",
                help="Numero de personas disponibles ese dia",
            )
        with col3:
            params["motivo"] = st.text_input(
                "Motivo", key=f"rp_cap_motivo_{fv}",
                placeholder="Ej: Junta, medio dia, capacitacion",
            )

    elif tipo == "FECHA_LIMITE":
        day_names = _get_day_names()
        params["dia_limite"] = st.selectbox(
            "Debe Completarse Antes De",
            options=day_names,
            index=len(day_names) - 2 if len(day_names) > 1 else 0,
            key=f"rp_deadline_{fv}",
            help="El modelo DEBE estar terminado para este dia. Penaliza fuertemente si no se cumple.",
        )

    elif tipo == "AGRUPAR_MODELOS":
        col1, col2 = st.columns(2)
        with col1:
            params["modelo_a"] = st.selectbox(
                "Modelo A",
                options=modelos,
                key=f"rp_grupo_a_{fv}",
            ) if modelos else ""
        with col2:
            params["modelo_b"] = st.selectbox(
                "Modelo B",
                options=modelos,
                key=f"rp_grupo_b_{fv}",
            ) if modelos else ""

    elif tipo == "LOTE_MINIMO_CUSTOM":
        params["lote_minimo"] = st.number_input(
            "Lote Minimo (pares)", min_value=10, max_value=500, value=50, step=10,
            key=f"rp_lote_min_{fv}",
            help="Override del lote minimo (default: 100). Util para pedidos urgentes pequenos.",
        )

    return params


def _render_table(restricciones):
    if not restricciones:
        return

    st.subheader(f"Restricciones ({len(restricciones)})")

    rows = []
    for r in restricciones:
        rows.append({
            "ID": r.get("id", ""),
            "TIPO": r.get("tipo", ""),
            "MODELO": r.get("modelo", ""),
            "DETALLE": _format_detail(r),
            "NOTA": r.get("nota", ""),
            "ACTIVA": r.get("activa", True),
        })

    df = pd.DataFrame(rows)

    edited = st.data_editor(
        df,
        width="stretch",
        hide_index=True,
        disabled=["ID", "TIPO", "MODELO", "DETALLE", "NOTA"],
        height=min(400, 35 * (len(df) + 2) + 38),
        key="restricciones_table_editor",
        column_config={
            "ID": st.column_config.TextColumn("ID", width="small"),
            "TIPO": st.column_config.TextColumn("Tipo", width="medium"),
            "MODELO": st.column_config.TextColumn("Modelo", width="small"),
            "DETALLE": st.column_config.TextColumn("Detalle", width="large"),
            "NOTA": st.column_config.TextColumn("Nota", width="medium"),
            "ACTIVA": st.column_config.CheckboxColumn("Activa", width="small"),
        },
    )

    json_copy_btn(df, "restricciones_table")

    # Sincronizar toggle de activa
    changed = False
    for i, (_, row) in enumerate(edited.iterrows()):
        if i < len(restricciones):
            new_activa = bool(row["ACTIVA"])
            if restricciones[i].get("activa", True) != new_activa:
                restricciones[i]["activa"] = new_activa
                changed = True
    if changed:
        save_restricciones(restricciones)
        st.session_state.restricciones = restricciones

    # Botones de eliminar
    cols = st.columns(min(len(restricciones), 4))
    for i, r in enumerate(restricciones):
        with cols[i % len(cols)]:
            if st.button(f"Eliminar {r['id']}", key=f"del_rest_{r['id']}"):
                delete_restriccion(r["id"])
                st.session_state.restricciones = load_restricciones()
                st.rerun()


def _format_detail(r):
    """Formatea los parametros de una restriccion en texto legible."""
    tipo = r.get("tipo", "")
    p = r.get("parametros", {})

    if tipo == "PRIORIDAD":
        labels = {1: "Normal", 2: "Alta", 3: "Urgente"}
        return f"Peso: {labels.get(p.get('peso', 1), p.get('peso', 1))}"
    elif tipo == "MAQUILA":
        prov = p.get("proveedor", "")
        return f"{p.get('pares_maquila', 0)} pares → {prov}" if prov else f"{p.get('pares_maquila', 0)} pares"
    elif tipo == "RETRASO_MATERIAL":
        desde = p.get("disponible_desde", "?")
        hora = p.get("hora_disponible", "")
        if hora:
            return f"Disponible desde {desde} a las {hora}"
        return f"Disponible desde {desde}"
    elif tipo == "FIJAR_DIA":
        modo = p.get("modo", "PERMITIR")
        dias = ", ".join(p.get("dias", []))
        return f"{modo}: {dias}"
    elif tipo == "SECUENCIA":
        return f"{p.get('modelo_antes', '?')} → {p.get('modelo_despues', '?')}"
    elif tipo == "AJUSTE_VOLUMEN":
        motivo = p.get("motivo", "")
        return f"Vol: {p.get('nuevo_volumen', 0)}" + (f" ({motivo})" if motivo else "")
    elif tipo == "ROBOT_NO_DISPONIBLE":
        robot = p.get("robot", "?")
        dias = p.get("dias", [])
        motivo = p.get("motivo", "")
        dias_str = ", ".join(dias) if dias else "toda la semana"
        return f"{robot} - {dias_str}" + (f" ({motivo})" if motivo else "")
    elif tipo == "AUSENCIA_OPERARIO":
        operario = p.get("operario", "?")
        dia = p.get("dia", "?")
        cant = p.get("cantidad", 1)
        return f"{operario} - {dia}" + (f" ({cant} personas)" if cant > 1 else "")
    elif tipo == "CAPACIDAD_DIA":
        dia = p.get("dia", "?")
        plantilla = p.get("nueva_plantilla", 0)
        motivo = p.get("motivo", "")
        return f"{dia}: {plantilla} personas" + (f" ({motivo})" if motivo else "")
    elif tipo == "FECHA_LIMITE":
        return f"Completar antes de {p.get('dia_limite', '?')}"
    elif tipo == "AGRUPAR_MODELOS":
        return f"{p.get('modelo_a', '?')} + {p.get('modelo_b', '?')} mismo dia"
    elif tipo == "LOTE_MINIMO_CUSTOM":
        return f"Min: {p.get('lote_minimo', 50)} pares"
    return str(p)


def _render_impact_preview(restricciones):
    """Muestra preview del impacto de restricciones activas."""
    st.subheader("Impacto en Optimizacion")

    activas = [r for r in restricciones if r.get("activa", True)]
    if not activas:
        st.info("No hay restricciones activas.")
        return

    for r in activas:
        tipo = r["tipo"]
        modelo = r["modelo"]
        detalle = _format_detail(r)
        icon = {
            "PRIORIDAD": "🔴" if r["parametros"].get("peso", 1) >= 3 else "🟡",
            "MAQUILA": "📦",
            "RETRASO_MATERIAL": "⏳",
            "FIJAR_DIA": "📅",
            "SECUENCIA": "🔗",
            "AJUSTE_VOLUMEN": "📊",
            "ROBOT_NO_DISPONIBLE": "🤖",
            "AUSENCIA_OPERARIO": "👤",
            "CAPACIDAD_DIA": "📉",
            "FECHA_LIMITE": "⏰",
            "AGRUPAR_MODELOS": "🔀",
            "LOTE_MINIMO_CUSTOM": "📏",
        }.get(tipo, "📌")
        st.markdown(f"{icon} **{modelo}** ({tipo}): {detalle}")


# ===========================================================================
# TAB 2: Avance de Produccion
# ===========================================================================

def _render_avance_tab():
    st.subheader("Avance de Produccion")
    st.caption(
        "Registre los pares ya producidos por modelo y dia. "
        "Al re-optimizar, estos dias quedan congelados."
    )

    # Necesitamos pedido para saber que modelos mostrar
    pedido = st.session_state.get("pedido_rows", [])
    if not pedido:
        st.info("Cargue un pedido primero para registrar avance.")
        return

    day_names = _get_day_names()
    avance = load_avance()
    avance_modelos = avance.get("modelos", {})

    # Obtener semana
    year = st.session_state.get("pedido_year", "")
    week = st.session_state.get("pedido_week", "")
    semana = f"sem_{int(week)}_{int(year)}" if year and week else avance.get("semana", "")

    if semana:
        st.markdown(f"**Semana**: {semana}")

    # Construir dataframe editable
    modelos_unicos = sorted({item["modelo"] for item in pedido})
    vol_by_modelo = {}
    for item in pedido:
        vol_by_modelo[item["modelo"]] = vol_by_modelo.get(item["modelo"], 0) + item["volumen"]

    rows = []
    for modelo in modelos_unicos:
        row = {"MODELO": modelo, "VOLUMEN": vol_by_modelo.get(modelo, 0)}
        total_avance = 0
        for day in day_names:
            val = avance_modelos.get(modelo, {}).get(day, 0)
            row[day] = val
            total_avance += val
        row["RESTA"] = max(0, row["VOLUMEN"] - total_avance)
        rows.append(row)

    df = pd.DataFrame(rows)

    # Columnas editables: solo los dias
    disabled_cols = ["MODELO", "VOLUMEN", "RESTA"]

    col_config = {
        "MODELO": st.column_config.TextColumn("Modelo", width="small"),
        "VOLUMEN": st.column_config.NumberColumn("Vol. Total", width="small"),
        "RESTA": st.column_config.NumberColumn("Resta", width="small"),
    }
    for day in day_names:
        col_config[day] = st.column_config.NumberColumn(
            day, min_value=0, step=50, width="small",
        )

    edited = st.data_editor(
        df,
        width="stretch",
        hide_index=True,
        disabled=disabled_cols,
        height=min(500, 35 * (len(df) + 2) + 38),
        key="avance_editor",
        column_config=col_config,
    )

    json_copy_btn(df, "avance_table")

    # Boton guardar
    if st.button("Guardar Avance", type="primary"):
        new_avance = {
            "semana": semana,
            "updated_at": "",
            "modelos": {},
        }
        from datetime import datetime
        new_avance["updated_at"] = datetime.now().isoformat()

        for _, row in edited.iterrows():
            modelo = row["MODELO"]
            day_data = {}
            for day in day_names:
                val = int(row.get(day, 0))
                if val > 0:
                    day_data[day] = val
            if day_data:
                new_avance["modelos"][modelo] = day_data

        save_avance(new_avance)
        st.session_state.avance = new_avance
        st.success("Avance guardado")

    # Resumen
    total_vol = sum(r["VOLUMEN"] for r in rows)
    total_done = sum(
        sum(avance_modelos.get(m, {}).get(d, 0) for d in day_names)
        for m in modelos_unicos
    )
    total_resta = total_vol - total_done

    c1, c2, c3 = st.columns(3)
    c1.metric("Volumen Total", f"{total_vol:,}")
    c2.metric("Producido", f"{total_done:,}")
    c3.metric("Pendiente", f"{total_resta:,}")
