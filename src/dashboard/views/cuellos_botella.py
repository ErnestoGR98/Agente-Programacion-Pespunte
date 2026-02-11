"""
cuellos_botella.py - Tab 5: Analisis de cuellos de botella y alertas.
"""

import streamlit as st
import pandas as pd


def render():
    """Renderiza la vista de cuellos de botella."""
    daily_results = st.session_state.daily_results
    weekly_summary = st.session_state.weekly_summary
    params = st.session_state.params

    # --- Alertas automaticas ---
    st.subheader("Alertas")
    alerts = _generate_alerts(daily_results, weekly_summary)
    if alerts:
        for alert in alerts:
            if alert["level"] == "error":
                st.error(alert["msg"])
            else:
                st.warning(alert["msg"])
    else:
        st.success("No se detectaron cuellos de botella criticos.")

    st.divider()

    # --- Restricciones activas ---
    st.subheader("Restricciones Mas Activas")
    constraints = _find_active_constraints(daily_results, params)
    if constraints:
        df = pd.DataFrame(constraints)
        df = df.sort_values("Uso %", ascending=False).head(20)

        def _highlight_high(row):
            pct = row["Uso %"]
            if pct >= 100:
                return ["background-color: #FADBD8"] * len(row)
            elif pct >= 85:
                return ["background-color: #FCF3CF"] * len(row)
            return [""] * len(row)

        styled = df.style.apply(_highlight_high, axis=1).format({"Uso %": "{:.1f}"})
        st.dataframe(styled, width="stretch", hide_index=True)
    else:
        st.info("No hay datos de restricciones.")

    st.divider()

    # --- Ranking de modelos por carga ---
    st.subheader("Modelos por Carga de Trabajo")
    matched = st.session_state.matched_models
    if matched:
        rows = []
        for m in matched:
            total_work = m["total_sec_per_pair"] * m["total_producir"]
            rows.append({
                "Modelo": m["codigo"],
                "Volumen": m["total_producir"],
                "Sec/Par": m["total_sec_per_pair"],
                "Min Total": round(total_work / 60, 0),
                "HC-Horas": round(total_work / 3600, 1),
                "Num Ops": m["num_ops"],
            })
        df_models = pd.DataFrame(rows).sort_values("HC-Horas", ascending=False)
        st.dataframe(df_models, width="stretch", hide_index=True)

        # Mini grafica
        st.bar_chart(df_models.set_index("Modelo")["HC-Horas"])


def _generate_alerts(daily_results, weekly_summary):
    """Genera alertas automaticas basadas en los resultados."""
    alerts = []

    # Modelos incompletos
    for ms in weekly_summary["models"]:
        if ms["tardiness"] > 0:
            alerts.append({
                "level": "error",
                "msg": f"Modelo {ms['codigo']}: {ms['tardiness']} pares sin programar "
                       f"({ms['pct_completado']}% completado)",
            })

    # Dias con tardiness diario
    for day_name, day_data in daily_results.items():
        s = day_data["summary"]
        if s["total_tardiness"] > 0:
            alerts.append({
                "level": "warning",
                "msg": f"{day_name}: {s['total_tardiness']} pares no pudieron asignarse "
                       f"a bloques horarios (bottleneck de recursos/robots)",
            })

    # HC sobre plantilla
    for day_name, day_data in daily_results.items():
        s = day_data["summary"]
        if s["total_pares"] == 0:
            continue
        max_hc = max(s["block_hc"]) if s["block_hc"] else 0
        if max_hc > s["plantilla"]:
            alerts.append({
                "level": "warning",
                "msg": f"{day_name}: HC maximo ({max_hc:.1f}) excede plantilla ({s['plantilla']})",
            })

    return alerts


def _find_active_constraints(daily_results, params):
    """Encuentra las restricciones mas apretadas por dia/bloque."""
    constraints = []
    resource_cap = params["resource_capacity"]

    for day_name, day_data in daily_results.items():
        summary = day_data["summary"]
        if summary["total_pares"] == 0:
            continue

        block_labels = summary["block_labels"]
        plantilla = summary["plantilla"]

        # HC por bloque
        for b_idx, hc in enumerate(summary["block_hc"]):
            if plantilla > 0:
                pct = hc / plantilla * 100
                if pct > 70:
                    constraints.append({
                        "Dia": day_name,
                        "Bloque": block_labels[b_idx],
                        "Restriccion": "HEADCOUNT",
                        "Capacidad": plantilla,
                        "Carga": round(hc, 1),
                        "Uso %": round(pct, 1),
                    })

        # Recursos por bloque (estimacion agregada)
        schedule = day_data["schedule"]
        for b_idx, label in enumerate(block_labels):
            block_min = 60 if b_idx not in (4, 5) else 70
            block_sec = block_min * 60
            resource_load = {}
            for entry in schedule:
                recurso = entry["recurso"]
                pares = entry["block_pares"][b_idx] if b_idx < len(entry["block_pares"]) else 0
                if pares > 0:
                    sec = pares * (3600.0 / entry["rate"] if entry["rate"] > 0 else 0)
                    resource_load[recurso] = resource_load.get(recurso, 0) + sec

            for recurso, load_sec in resource_load.items():
                cap = resource_cap.get(recurso, resource_cap.get("GENERAL", 4))
                max_sec = cap * block_sec
                if max_sec > 0:
                    pct = load_sec / max_sec * 100
                    if pct > 70:
                        constraints.append({
                            "Dia": day_name,
                            "Bloque": label,
                            "Restriccion": recurso,
                            "Capacidad": cap,
                            "Carga": round(load_sec / block_sec, 1),
                            "Uso %": round(pct, 1),
                        })

    return constraints
