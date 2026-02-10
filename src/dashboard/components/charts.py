"""
charts.py - Constructores de graficas Plotly para el dashboard.
"""

import plotly.graph_objects as go
import pandas as pd

from dashboard.components.tables import RESOURCE_COLORS


def build_balance_chart(weekly_summary):
    """Grafica de barras: HC Necesario vs HC Disponible por dia."""
    days_data = weekly_summary["days"]
    dias = [d["dia"] for d in days_data]
    hc_nec = [d["hc_necesario"] for d in days_data]
    hc_disp = [d["hc_disponible"] for d in days_data]

    colors_nec = [
        "#E74C3C" if n > d else "#27AE60"
        for n, d in zip(hc_nec, hc_disp)
    ]

    fig = go.Figure()
    fig.add_trace(go.Bar(
        name="HC Necesario", x=dias, y=hc_nec,
        marker_color=colors_nec,
    ))
    fig.add_trace(go.Bar(
        name="HC Disponible", x=dias, y=hc_disp,
        marker_color="#3498DB", opacity=0.4,
    ))

    # Anotaciones de utilizacion
    for d in days_data:
        fig.add_annotation(
            x=d["dia"],
            y=max(d["hc_necesario"], d["hc_disponible"]) + 0.5,
            text=f"{d['utilizacion_pct']}%",
            showarrow=False, font=dict(size=11),
        )

    fig.update_layout(
        title="Balance de Headcount por Dia",
        barmode="group",
        yaxis_title="Personas",
        xaxis_title="Dia",
        height=400,
        margin=dict(t=40, b=40),
    )
    return fig


def build_hc_block_chart(day_data, day_name):
    """Barras apiladas de HC por bloque horario, desglosado por modelo."""
    schedule = day_data["schedule"]
    summary = day_data["summary"]
    block_labels = summary["block_labels"]
    plantilla = summary["plantilla"]
    num_blocks = len(block_labels)

    # Agrupar HC por modelo y bloque
    model_hc = {}
    for entry in schedule:
        modelo = entry["modelo"]
        if modelo not in model_hc:
            model_hc[modelo] = [0.0] * num_blocks
        for b in range(num_blocks):
            pares = entry["block_pares"][b] if b < len(entry["block_pares"]) else 0
            sec = pares * (3600.0 / entry["rate"] if entry["rate"] > 0 else 0)
            block_min = 60 if b not in (4, 5) else 70  # bloques 4,5 son de 70 min
            block_sec = block_min * 60
            if block_sec > 0:
                model_hc[modelo][b] += sec / block_sec

    fig = go.Figure()
    for modelo, hc_values in model_hc.items():
        fig.add_trace(go.Bar(
            name=modelo,
            x=block_labels,
            y=[round(v, 1) for v in hc_values],
        ))

    fig.add_hline(
        y=plantilla, line_dash="dash", line_color="red",
        annotation_text=f"Plantilla: {plantilla}",
    )

    fig.update_layout(
        title=f"HC por Bloque - {day_name}",
        barmode="stack",
        yaxis_title="Personas (HC)",
        xaxis_title="Bloque Horario",
        height=450,
        margin=dict(t=40, b=40),
    )
    return fig


def build_heatmap(daily_results):
    """Heatmap semanal: Dias x Bloques, coloreado por utilizacion HC."""
    days = []
    matrix = []
    for day_name, day_data in daily_results.items():
        s = day_data["summary"]
        if s["total_pares"] == 0:
            continue
        days.append(day_name)
        plantilla = s["plantilla"]
        row = []
        for hc in s["block_hc"]:
            pct = (hc / plantilla * 100) if plantilla > 0 else 0
            row.append(round(pct, 0))
        matrix.append(row)

    if not days:
        return None

    block_labels = list(daily_results.values())[0]["summary"]["block_labels"]

    fig = go.Figure(data=go.Heatmap(
        z=matrix,
        x=block_labels,
        y=days,
        colorscale="RdYlGn_r",
        zmin=0, zmax=120,
        text=[[f"{v:.0f}%" for v in row] for row in matrix],
        texttemplate="%{text}",
        colorbar_title="Uso %",
    ))
    fig.update_layout(
        title="Mapa de Calor: Utilizacion HC por Bloque y Dia",
        xaxis_title="Bloque Horario",
        yaxis_title="Dia",
        height=350,
        margin=dict(t=40, b=40),
    )
    return fig


def build_resource_load_chart(day_data, params):
    """Barras de utilizacion por tipo de recurso."""
    schedule = day_data["schedule"]
    summary = day_data["summary"]
    block_labels = summary["block_labels"]
    num_blocks = len(block_labels)
    resource_cap = params["resource_capacity"]

    # Calcular carga total por recurso (promedio de bloques activos)
    resource_load = {}
    for entry in schedule:
        recurso = entry["recurso"]
        if recurso not in resource_load:
            resource_load[recurso] = 0.0
        total_sec = entry["total_pares"] * (3600.0 / entry["rate"] if entry["rate"] > 0 else 0)
        resource_load[recurso] += total_sec

    # Total segundos disponibles en el dia (sum de todos los bloques)
    total_day_sec = sum(
        (60 if b not in (4, 5) else 70) * 60
        for b in range(num_blocks)
    )

    recursos = []
    pcts = []
    colors = []
    for recurso, load_sec in sorted(resource_load.items()):
        cap = resource_cap.get(recurso, resource_cap.get("GENERAL", 4))
        max_sec = cap * total_day_sec
        pct = (load_sec / max_sec * 100) if max_sec > 0 else 0
        recursos.append(recurso)
        pcts.append(round(pct, 1))
        colors.append(RESOURCE_COLORS.get(recurso, "#D5DBDB"))

    fig = go.Figure(go.Bar(
        x=recursos, y=pcts,
        marker_color=colors,
        text=[f"{p:.0f}%" for p in pcts],
        textposition="outside",
    ))
    fig.add_hline(y=100, line_dash="dash", line_color="red",
                  annotation_text="100% Capacidad")
    fig.update_layout(
        title="Utilizacion por Tipo de Recurso",
        yaxis_title="Utilizacion %",
        height=400,
        margin=dict(t=40, b=40),
    )
    return fig


def build_robot_utilization_chart(daily_results):
    """Barras de utilizacion por robot fisico (promedio semanal)."""
    robot_usage = {}  # robot -> total_sec
    robot_available = {}  # robot -> total_sec disponible

    for day_name, day_data in daily_results.items():
        summary = day_data["summary"]
        if summary["total_pares"] == 0:
            continue
        block_labels = summary["block_labels"]
        day_sec = sum(
            (60 if b not in (4, 5) else 70) * 60
            for b in range(len(block_labels))
        )

        for entry in day_data["schedule"]:
            for robot in entry.get("robots_used", []):
                if robot not in robot_usage:
                    robot_usage[robot] = 0.0
                    robot_available[robot] = 0.0
                total_sec = entry["total_pares"] * (3600.0 / entry["rate"] if entry["rate"] > 0 else 0)
                robot_usage[robot] += total_sec
                robot_available[robot] = max(robot_available[robot], day_sec)

    if not robot_usage:
        return None

    robots = sorted(robot_usage.keys())
    pcts = []
    for r in robots:
        avail = robot_available.get(r, 1)
        pcts.append(round(robot_usage[r] / avail * 100, 1) if avail > 0 else 0)

    fig = go.Figure(go.Bar(
        x=robots, y=pcts,
        marker_color="#F9E79F",
        text=[f"{p:.0f}%" for p in pcts],
        textposition="outside",
    ))
    fig.add_hline(y=100, line_dash="dash", line_color="red")
    fig.update_layout(
        title="Utilizacion por Robot Fisico (Semanal)",
        yaxis_title="Utilizacion %",
        height=400,
        margin=dict(t=40, b=40),
    )
    return fig
