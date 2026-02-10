"""
configuracion.py - Tab de configuracion del sistema.

Permite editar desde el dashboard:
  - Robots fisicos y aliases
  - Capacidades por tipo de recurso
  - Lista de fabricas
  - Dias de la semana (plantilla, overtime)
"""

import streamlit as st
import pandas as pd

from config_manager import load_config, save_config, get_default_config


def render():
    """Renderiza la pagina de configuracion."""
    st.subheader("Configuracion del Sistema")
    st.caption("Estos valores se guardan en data/config.json y persisten entre sesiones")

    config = load_config()

    tab_robots, tab_recursos, tab_fabricas, tab_dias = st.tabs([
        "Robots", "Capacidad Recursos", "Fabricas", "Dias / Plantilla",
    ])

    with tab_robots:
        _render_robots(config)

    with tab_recursos:
        _render_recursos(config)

    with tab_fabricas:
        _render_fabricas(config)

    with tab_dias:
        _render_dias(config)

    st.divider()

    col1, col2 = st.columns(2)
    with col1:
        if st.button("Restaurar Valores por Defecto", type="secondary"):
            save_config(get_default_config())
            st.success("Configuracion restaurada a valores por defecto")
            st.rerun()
    with col2:
        st.caption("Los cambios en cada seccion se guardan con su boton individual")


def _render_robots(config):
    """Editar robots fisicos y aliases."""
    st.markdown("**Robots Fisicos**")
    st.caption("Maquinas disponibles en planta. Cada una tiene capacidad 1 por bloque horario.")

    robots = config["robots"]["physical"]

    # Tabla editable de robots
    df_robots = pd.DataFrame({"ROBOT": robots})
    edited = st.data_editor(
        df_robots,
        use_container_width=True,
        hide_index=True,
        num_rows="dynamic",
        height=min(400, 35 * (len(df_robots) + 2) + 38),
        key="config_robots_editor",
        column_config={
            "ROBOT": st.column_config.TextColumn("Nombre del Robot", width="large"),
        },
    )

    st.markdown("**Aliases de Robots**")
    st.caption("Variantes de nombres que aparecen en el catalogo Excel")

    aliases = config["robots"]["aliases"]
    df_aliases = pd.DataFrame([
        {"NOMBRE_EXCEL": k, "NOMBRE_REAL": v}
        for k, v in aliases.items()
    ]) if aliases else pd.DataFrame({"NOMBRE_EXCEL": pd.Series(dtype="str"),
                                      "NOMBRE_REAL": pd.Series(dtype="str")})

    edited_aliases = st.data_editor(
        df_aliases,
        use_container_width=True,
        hide_index=True,
        num_rows="dynamic",
        height=min(250, 35 * (len(df_aliases) + 2) + 38),
        key="config_aliases_editor",
        column_config={
            "NOMBRE_EXCEL": st.column_config.TextColumn("Como aparece en Excel", width="medium"),
            "NOMBRE_REAL": st.column_config.TextColumn("Nombre real del robot", width="medium"),
        },
    )

    if st.button("Guardar Robots", type="primary", key="save_robots"):
        new_robots = [
            str(r).strip()
            for r in edited["ROBOT"].dropna().tolist()
            if str(r).strip()
        ]
        new_aliases = {}
        for _, row in edited_aliases.iterrows():
            k = str(row.get("NOMBRE_EXCEL", "")).strip()
            v = str(row.get("NOMBRE_REAL", "")).strip()
            if k and v:
                new_aliases[k] = v

        config["robots"]["physical"] = new_robots
        config["robots"]["aliases"] = new_aliases
        save_config(config)
        st.success(f"Guardado: {len(new_robots)} robots, {len(new_aliases)} aliases")


def _render_recursos(config):
    """Editar capacidades por tipo de recurso."""
    st.markdown("**Capacidad por Tipo de Recurso**")
    st.caption("Cuantas personas/maquinas pueden trabajar simultaneamente en cada tipo de recurso por bloque")

    cap = config["resource_capacity"]

    # Excluir GENERAL del editor, se maneja aparte
    resource_types = ["MESA", "ROBOT", "PLANA", "POSTE-LINEA", "MESA-LINEA", "PLANA-LINEA"]

    cols = st.columns(3)
    new_cap = {}
    for i, res in enumerate(resource_types):
        with cols[i % 3]:
            new_cap[res] = st.number_input(
                res,
                min_value=1,
                max_value=50,
                value=cap.get(res, 10),
                key=f"config_cap_{res}",
            )

    new_cap["GENERAL"] = st.number_input(
        "GENERAL (fallback)",
        min_value=1, max_value=50,
        value=cap.get("GENERAL", 10),
        key="config_cap_GENERAL",
    )

    if st.button("Guardar Capacidades", type="primary", key="save_capacities"):
        config["resource_capacity"] = new_cap
        save_config(config)
        st.success("Capacidades guardadas")


def _render_fabricas(config):
    """Editar lista de fabricas."""
    st.markdown("**Fabricas Disponibles**")
    st.caption("Fabricas que aparecen como opcion en el formulario de pedido")

    fabricas = config["fabricas"]
    df_fab = pd.DataFrame({"FABRICA": fabricas})

    edited = st.data_editor(
        df_fab,
        use_container_width=True,
        hide_index=True,
        num_rows="dynamic",
        height=min(250, 35 * (len(df_fab) + 2) + 38),
        key="config_fabricas_editor",
        column_config={
            "FABRICA": st.column_config.TextColumn("Nombre de Fabrica", width="large"),
        },
    )

    if st.button("Guardar Fabricas", type="primary", key="save_fabricas"):
        new_fabricas = [
            str(f).strip()
            for f in edited["FABRICA"].dropna().tolist()
            if str(f).strip()
        ]
        config["fabricas"] = new_fabricas
        save_config(config)
        st.success(f"Guardado: {len(new_fabricas)} fabricas")


def _render_dias(config):
    """Editar configuracion de dias."""
    st.markdown("**Dias de la Semana**")
    st.caption("Plantilla, minutos regulares y overtime por dia")

    days = config["days"]
    df_days = pd.DataFrame([
        {
            "DIA": d["name"],
            "MINUTOS": d["minutes"],
            "PLANTILLA": d["plantilla"],
            "MIN_OT": d["minutes_ot"],
            "PLANTILLA_OT": d["plantilla_ot"],
            "SABADO": d["is_saturday"],
        }
        for d in days
    ])

    edited = st.data_editor(
        df_days,
        use_container_width=True,
        hide_index=True,
        num_rows="dynamic",
        height=min(350, 35 * (len(df_days) + 2) + 38),
        key="config_days_editor",
        column_config={
            "DIA": st.column_config.TextColumn("Dia", width="small"),
            "MINUTOS": st.column_config.NumberColumn("Min Regular", min_value=0, step=30, width="small"),
            "PLANTILLA": st.column_config.NumberColumn("Plantilla", min_value=1, max_value=50, width="small"),
            "MIN_OT": st.column_config.NumberColumn("Min OT", min_value=0, step=30, width="small"),
            "PLANTILLA_OT": st.column_config.NumberColumn("Plant. OT", min_value=0, max_value=50, width="small"),
            "SABADO": st.column_config.CheckboxColumn("Sabado?", width="small"),
        },
    )

    if st.button("Guardar Dias", type="primary", key="save_days"):
        new_days = []
        for _, row in edited.iterrows():
            name = str(row.get("DIA", "")).strip()
            if not name:
                continue
            new_days.append({
                "name": name,
                "minutes": int(row["MINUTOS"]) if pd.notna(row.get("MINUTOS")) else 540,
                "plantilla": int(row["PLANTILLA"]) if pd.notna(row.get("PLANTILLA")) else 17,
                "minutes_ot": int(row["MIN_OT"]) if pd.notna(row.get("MIN_OT")) else 60,
                "plantilla_ot": int(row["PLANTILLA_OT"]) if pd.notna(row.get("PLANTILLA_OT")) else 17,
                "is_saturday": bool(row.get("SABADO", False)),
            })
        config["days"] = new_days
        save_config(config)
        st.success(f"Guardado: {len(new_days)} dias")
