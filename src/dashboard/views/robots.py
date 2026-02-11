"""
robots.py - Tab 4: Vista de utilizacion de robots fisicos.
"""

import streamlit as st
import pandas as pd
import plotly.graph_objects as go
from dashboard.components.charts import build_robot_utilization_chart


def render():
    """Renderiza la vista de robots."""
    daily_results = st.session_state.daily_results

    # --- Utilizacion semanal ---
    st.subheader("Utilizacion de Robots (Semanal)")
    fig = build_robot_utilization_chart(daily_results)
    if fig:
        st.plotly_chart(fig, width="stretch")
    else:
        st.info("No hay datos de robots.")
        return

    st.divider()

    # --- Tarjetas de estado por robot ---
    st.subheader("Estado por Robot")
    robot_info = _collect_robot_info(daily_results)

    # Grid 4x2
    robots = sorted(robot_info.keys())
    for row_start in range(0, len(robots), 4):
        cols = st.columns(4)
        for i, col in enumerate(cols):
            idx = row_start + i
            if idx >= len(robots):
                break
            robot = robots[idx]
            info = robot_info[robot]
            with col:
                st.markdown(f"**{robot}**")
                st.caption(f"{info['total_ops']} operaciones | {info['total_pares']:,} pares")
                if info["modelos"]:
                    st.markdown(f"Modelos: {', '.join(sorted(info['modelos']))}")
                if info["dias"]:
                    st.markdown(f"Dias: {', '.join(sorted(info['dias']))}")

    st.divider()

    # --- Timeline por dia ---
    st.subheader("Timeline de Robots por Dia")
    active_days = [
        day for day, data in daily_results.items()
        if data["summary"]["total_pares"] > 0
    ]
    if not active_days:
        return

    selected_day = st.selectbox("Dia", active_days, key="robot_day_select")
    day_data = daily_results[selected_day]
    fig_timeline = _build_robot_timeline(day_data, selected_day)
    if fig_timeline:
        st.plotly_chart(fig_timeline, width="stretch")
    else:
        st.info("No hay operaciones de robot en este dia.")


def _collect_robot_info(daily_results):
    """Recolecta info de uso por robot a traves de la semana."""
    info = {}
    for day_name, day_data in daily_results.items():
        for entry in day_data["schedule"]:
            for robot in entry.get("robots_used", []):
                if robot not in info:
                    info[robot] = {"total_ops": 0, "total_pares": 0,
                                   "modelos": set(), "dias": set()}
                info[robot]["total_ops"] += 1
                info[robot]["total_pares"] += entry["total_pares"]
                info[robot]["modelos"].add(entry["modelo"])
                info[robot]["dias"].add(day_name)
    return info


def _build_robot_timeline(day_data, day_name):
    """Construye un Gantt horizontal de robots por bloque."""
    schedule = day_data["schedule"]
    block_labels = day_data["summary"]["block_labels"]
    num_blocks = len(block_labels)

    # Recolectar: para cada robot, en que bloques esta activo y con que modelo
    robot_blocks = {}
    for entry in schedule:
        for robot in entry.get("robots_used", []):
            if robot not in robot_blocks:
                robot_blocks[robot] = []
            for b in range(num_blocks):
                pares = entry["block_pares"][b] if b < len(entry["block_pares"]) else 0
                if pares > 0:
                    robot_blocks[robot].append({
                        "bloque": block_labels[b],
                        "bloque_idx": b,
                        "modelo": entry["modelo"],
                        "fraccion": entry["fraccion"],
                        "pares": pares,
                    })

    if not robot_blocks:
        return None

    # Construir barras horizontales
    fig = go.Figure()
    robots = sorted(robot_blocks.keys())

    for entry_info in robot_blocks.values():
        for block_info in entry_info:
            robot_name = [r for r in robots if r in robot_blocks and
                         block_info in robot_blocks[r]][0] if True else ""

    # Usar barras simples: cada robot es un eje Y, bloques son eje X
    for robot in robots:
        blocks = robot_blocks[robot]
        x_vals = []
        colors = []
        texts = []
        for b_info in blocks:
            x_vals.append(b_info["bloque"])
            texts.append(f"{b_info['modelo']} F{b_info['fraccion']}<br>{b_info['pares']}p")

        fig.add_trace(go.Bar(
            y=[robot] * len(x_vals),
            x=[1] * len(x_vals),
            orientation="h",
            name=robot,
            text=texts,
            textposition="inside",
            hoverinfo="text",
            showlegend=False,
        ))

    # Alternativa mas simple: heatmap-like table
    fig = go.Figure()

    # Crear matrix robots x bloques
    matrix = []
    hover_text = []
    for robot in robots:
        row = [0] * num_blocks
        row_text = [""] * num_blocks
        for b_info in robot_blocks[robot]:
            b_idx = b_info["bloque_idx"]
            row[b_idx] += b_info["pares"]
            txt = f"{b_info['modelo']} F{b_info['fraccion']}: {b_info['pares']}p"
            if row_text[b_idx]:
                row_text[b_idx] += "<br>" + txt
            else:
                row_text[b_idx] = txt
        matrix.append(row)
        hover_text.append(row_text)

    fig = go.Figure(data=go.Heatmap(
        z=matrix,
        x=block_labels,
        y=robots,
        colorscale="YlOrRd",
        text=hover_text,
        hovertemplate="%{y}<br>%{x}<br>%{text}<extra></extra>",
        colorbar_title="Pares",
    ))
    fig.update_layout(
        title=f"Uso de Robots - {day_name}",
        xaxis_title="Bloque Horario",
        yaxis_title="Robot",
        height=max(300, len(robots) * 50),
        margin=dict(t=40, b=40),
    )
    return fig
