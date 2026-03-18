"""
Endpoints de analisis de gaps y propuesta de escenarios post-optimizacion.

Analiza los resultados de optimizacion para identificar tardiness y
operaciones sin asignar, y propone escenarios (sabado, OT, maquila,
reorganizacion) para completar los pares faltantes.
"""

import os
import math
import json
import requests
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "") or os.environ.get("SUPABASE_KEY", "")


def _sb_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _sb_get(table: str, query: str = "") -> list:
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}?{query}", headers=_sb_headers())
    if r.status_code == 400:
        return []
    r.raise_for_status()
    return r.json()


def _sb_patch(table: str, query: str, data: dict):
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{table}?{query}",
        headers=_sb_headers(),
        json=data,
    )
    r.raise_for_status()
    return r.json()


# ============================================================
# REQUEST / RESPONSE MODELS
# ============================================================

class GapRequest(BaseModel):
    result_name: str  # e.g. "sem_11_2026_v134"


class GapByModel(BaseModel):
    modelo: str
    tardiness: int = 0
    sin_asignar: int = 0
    sin_asignar_pares: int = 0
    recurso_faltante: str = ""
    motivo: str = ""


class GapByDay(BaseModel):
    dia: str
    tardiness: int = 0
    sin_asignar: int = 0
    pares_programados: int = 0
    plantilla: int = 0


class Bottleneck(BaseModel):
    recurso: str
    deficit_horas: float = 0
    detalle: str = ""


class GapAnalysis(BaseModel):
    total_tardiness: int = 0
    total_sin_asignar: int = 0
    total_sin_asignar_pares: int = 0
    by_model: list[GapByModel] = []
    by_day: list[GapByDay] = []
    bottlenecks: list[Bottleneck] = []
    total_hh_faltantes: float = 0
    weekly_pares: int = 0
    daily_pares: int = 0


class Scenario(BaseModel):
    tipo: str  # SABADO, OVERTIME, MAQUILA, REORGANIZAR, COMBINACION
    descripcion: str
    config: dict = {}
    pares_recuperables: int = 0
    pct_recuperable: float = 0
    costo_relativo: int = 1  # 1=bajo, 2=medio, 3=alto
    restricciones_auto: list[dict] = []


class ScenarioProposals(BaseModel):
    gaps: GapAnalysis
    scenarios: list[Scenario] = []


class ApplyScenarioRequest(BaseModel):
    result_name: str
    pedido_nombre: str
    semana: str
    scenario: Scenario


# ============================================================
# ANALYZE GAPS
# ============================================================

@router.post("/analyze-gaps", response_model=GapAnalysis)
def analyze_gaps(req: GapRequest):
    """Analiza un resultado de optimizacion e identifica gaps."""

    # Load result from Supabase
    results = _sb_get("resultados", f"select=*&nombre=eq.{req.result_name}")
    if not results:
        raise HTTPException(404, f"Resultado '{req.result_name}' no encontrado")
    res = results[0]

    weekly_summary = res.get("weekly_summary") or {}
    daily_results = res.get("daily_results") or {}

    # --- Tardiness by model (from weekly summary) ---
    model_gaps = {}  # {modelo: GapByModel}
    for ms in weekly_summary.get("models", []):
        code = ms.get("codigo", "")
        tard = ms.get("tardiness", 0)
        if code:
            model_gaps[code] = {
                "modelo": code,
                "tardiness": tard,
                "sin_asignar": 0,
                "sin_asignar_pares": 0,
                "recurso_faltante": "",
                "motivo": "",
            }

    # --- SIN ASIGNAR analysis (from daily results) ---
    day_gaps = {}
    total_sin_asignar = 0
    total_sin_asignar_pares = 0
    resource_deficit = {}  # {recurso: total_pares_sin_asignar}

    for day_name, dr in daily_results.items():
        day_tard = dr.get("total_tardiness", 0)
        day_sin = 0
        day_sin_pares = 0

        for s in dr.get("schedule", []):
            if s.get("operario") == "SIN ASIGNAR":
                day_sin += 1
                pares = s.get("total", 0)
                day_sin_pares += pares
                total_sin_asignar += 1
                total_sin_asignar_pares += pares

                recurso = s.get("recurso", "?")
                motivo = s.get("motivo_sin_asignar", "")
                resource_deficit[recurso] = resource_deficit.get(recurso, 0) + pares

                modelo = s.get("modelo", "?")
                if modelo in model_gaps:
                    model_gaps[modelo]["sin_asignar"] += 1
                    model_gaps[modelo]["sin_asignar_pares"] += pares
                    if not model_gaps[modelo]["recurso_faltante"]:
                        model_gaps[modelo]["recurso_faltante"] = recurso
                        model_gaps[modelo]["motivo"] = motivo

        day_gaps[day_name] = {
            "dia": day_name,
            "tardiness": day_tard,
            "sin_asignar": day_sin,
            "pares_programados": dr.get("total_pares", 0),
            "plantilla": dr.get("plantilla", 0),
        }

    # --- Bottlenecks ---
    bottlenecks = []
    for recurso, deficit_pares in sorted(resource_deficit.items(), key=lambda x: -x[1]):
        # Estimate hours deficit: pares / avg_rate
        avg_rate = 80  # rough estimate pares/hour
        deficit_hrs = deficit_pares / avg_rate
        bottlenecks.append({
            "recurso": recurso,
            "deficit_horas": round(deficit_hrs, 1),
            "detalle": f"{deficit_pares}p sin asignar en {recurso}",
        })

    # --- Total HH faltantes ---
    total_tard = weekly_summary.get("total_tardiness", 0)
    # Add daily tardiness from SIN ASIGNAR
    daily_total_tard = sum(dr.get("total_tardiness", 0) for dr in daily_results.values())
    # Estimate: avg model needs ~40 sec/pair across all ops
    avg_sec_per_pair = 40
    total_hh = (max(total_tard, daily_total_tard) * avg_sec_per_pair) / 3600

    # Weekly vs daily pares
    weekly_pares = weekly_summary.get("total_pares", 0)
    daily_pares = sum(dr.get("total_pares", 0) for dr in daily_results.values())

    return GapAnalysis(
        total_tardiness=max(total_tard, daily_total_tard),
        total_sin_asignar=total_sin_asignar,
        total_sin_asignar_pares=total_sin_asignar_pares,
        by_model=[GapByModel(**g) for g in model_gaps.values() if g["tardiness"] > 0 or g["sin_asignar"] > 0],
        by_day=[GapByDay(**g) for g in day_gaps.values()],
        bottlenecks=[Bottleneck(**b) for b in bottlenecks],
        total_hh_faltantes=round(total_hh, 1),
        weekly_pares=weekly_pares,
        daily_pares=daily_pares,
    )


# ============================================================
# PROPOSE SCENARIOS
# ============================================================

@router.post("/propose-scenarios", response_model=ScenarioProposals)
def propose_scenarios(req: GapRequest):
    """Analiza gaps y propone escenarios para completar pares faltantes."""

    gaps = analyze_gaps(req)

    if gaps.total_tardiness == 0 and gaps.total_sin_asignar == 0:
        return ScenarioProposals(gaps=gaps, scenarios=[])

    scenarios = []
    total_deficit = gaps.total_tardiness + gaps.total_sin_asignar_pares

    # Load config
    operarios = _sb_get("operarios", "select=id&activo=eq.true")
    total_operarios = len(operarios)

    # --- Classify the ROOT CAUSE of gaps ---
    # Count pares sin asignar by cause category
    robot_pares = sum(b.deficit_horas * 80 for b in gaps.bottlenecks
                      if "ROBOT" in b.recurso.upper() or "3020" in b.recurso or "6040" in b.recurso
                      or "CHACHE" in b.recurso.upper())
    plana_pares = sum(b.deficit_horas * 80 for b in gaps.bottlenecks
                      if "PLANA" in b.recurso.upper())
    poste_pares = sum(b.deficit_horas * 80 for b in gaps.bottlenecks
                      if "POSTE" in b.recurso.upper())
    skill_limited = robot_pares + plana_pares + poste_pares
    time_limited = max(0, total_deficit - skill_limited)

    # Check weekly utilization — if < 85%, the problem is NOT time
    weekly_util = 0
    result = _sb_get("resultados", f"select=weekly_summary&nombre=eq.{req.result_name}")
    if result:
        ws = result[0].get("weekly_summary", {})
        days_data = ws.get("days", [])
        if days_data:
            weekly_util = sum(d.get("utilizacion_pct", 0) for d in days_data) / len(days_data)

    is_time_problem = weekly_util > 85  # Solo si la utilizacion es alta
    is_robot_problem = robot_pares > total_deficit * 0.2
    is_skill_problem = (plana_pares + poste_pares) > total_deficit * 0.2

    print(f"[SCENARIOS] Clasificacion: util={weekly_util:.0f}%, "
          f"robot={robot_pares:.0f}p, plana={plana_pares:.0f}p, "
          f"time_limited={time_limited:.0f}p, "
          f"is_time={is_time_problem}, is_robot={is_robot_problem}, is_skill={is_skill_problem}")

    # --- Scenario: OVERTIME (solo si el problema es tiempo, no recursos) ---
    if is_time_problem and time_limited > 50:
        days_with_tard = sorted(
            [(g.dia, g.tardiness) for g in gaps.by_day if g.tardiness > 0],
            key=lambda x: -x[1]
        )
        if days_with_tard:
            ot_days = [d[0] for d in days_with_tard[:3]]
            minutos_extra = 60
            pares_ot = int(time_limited * 0.8)  # only time-limited portion
            pares_ot = min(pares_ot, total_deficit)

            scenarios.append(Scenario(
                tipo="OVERTIME",
                descripcion=f"+1 hora extra {', '.join(ot_days)}",
                config={"dias": ot_days, "minutos_extra": minutos_extra},
                pares_recuperables=pares_ot,
                pct_recuperable=round(100 * pares_ot / max(1, total_deficit), 1),
                costo_relativo=1,
            ))

    # --- Scenario: SABADO (solo si hay deficit real de tiempo o para robots en dia nuevo) ---
    if total_deficit > 100:
        plantilla_needed = min(total_operarios, max(4, int(total_deficit / 200) + 1))
        horas_needed = min(5, max(2, math.ceil(gaps.total_hh_faltantes / max(1, plantilla_needed))))
        minutos_sab = horas_needed * 60

        # Saturday helps with robots because they're free that day
        robot_bonus = min(int(robot_pares * 0.5), 400) if is_robot_problem else 0
        pares_sab = int(plantilla_needed * horas_needed * 60 * 0.7) + robot_bonus
        pares_sab = min(pares_sab, total_deficit)

        reason = []
        if is_robot_problem:
            reason.append("robots libres")
        if is_skill_problem:
            reason.append("operarios PLANA disponibles")
        if is_time_problem:
            reason.append("capacidad extra")
        reason_str = f" ({', '.join(reason)})" if reason else ""

        scenarios.append(Scenario(
            tipo="SABADO",
            descripcion=f"Sábado {horas_needed}hrs, {plantilla_needed} operarios{reason_str}",
            config={"plantilla": plantilla_needed, "minutos": minutos_sab, "horas": horas_needed},
            pares_recuperables=pares_sab,
            pct_recuperable=round(100 * pares_sab / max(1, total_deficit), 1),
            costo_relativo=2,
        ))

    # --- Scenario: MAQUILA (cuando robots son el cuello de botella) ---
    if is_robot_problem:
        robot_models = [g for g in gaps.by_model
                        if "ROBOT" in g.recurso_faltante.upper() or "robot" in g.motivo.lower()
                        or "3020" in g.recurso_faltante or "6040" in g.recurso_faltante
                        or "CHACHE" in g.recurso_faltante.upper()]
        if robot_models:
            candidate = max(robot_models, key=lambda g: g.sin_asignar_pares + g.tardiness)
            pares_maq = candidate.tardiness + candidate.sin_asignar_pares
            # Maquila also frees robot capacity for OTHER models
            freed_pares = min(int(pares_maq * 1.5), total_deficit)

            scenarios.append(Scenario(
                tipo="MAQUILA",
                descripcion=f"Maquila {candidate.modelo} ({pares_maq}p) — libera robot para otros modelos",
                config={"modelo": candidate.modelo, "pares": pares_maq},
                pares_recuperables=freed_pares,
                pct_recuperable=round(100 * freed_pares / max(1, total_deficit), 1),
                costo_relativo=3,
            ))

    # --- Scenario: CAPACITAR OPERARIOS (cuando PLANA/POSTE son cuello de botella) ---
    if is_skill_problem:
        skill_bottlenecks = [b for b in gaps.bottlenecks
                             if "PLANA" in b.recurso.upper() or "POSTE" in b.recurso.upper()]
        if skill_bottlenecks:
            recurso_top = skill_bottlenecks[0].recurso
            deficit = skill_bottlenecks[0].deficit_horas
            # Count current operators with this skill
            pares_gain = int(deficit * 80 * 0.7)
            pares_gain = min(pares_gain, total_deficit)

            scenarios.append(Scenario(
                tipo="REORGANIZAR",
                descripcion=f"Capacitar 2-3 operarios en {recurso_top} ({deficit:.0f}h deficit)",
                config={"recurso": recurso_top, "deficit_horas": deficit},
                pares_recuperables=pares_gain,
                pct_recuperable=round(100 * pares_gain / max(1, total_deficit), 1),
                costo_relativo=1,
            ))

    # --- Scenario: REDISTRIBUIR (cuando modelos compiten por robots en mismo dia) ---
    if is_robot_problem and len(gaps.by_model) >= 2:
        robot_competing = [g for g in gaps.by_model if g.sin_asignar > 0 and
                           ("ROBOT" in g.recurso_faltante.upper() or "3020" in g.recurso_faltante
                            or "6040" in g.recurso_faltante or "CHACHE" in g.recurso_faltante.upper())]
        if len(robot_competing) >= 2:
            models_str = ", ".join(g.modelo for g in robot_competing[:3])
            pares_freed = sum(g.sin_asignar_pares for g in robot_competing)
            pares_freed = min(pares_freed, total_deficit)

            scenarios.append(Scenario(
                tipo="REORGANIZAR",
                descripcion=f"Separar {models_str} en dias distintos (comparten robot)",
                config={"modelos": [g.modelo for g in robot_competing[:3]], "accion": "FIJAR_DIA"},
                pares_recuperables=pares_freed,
                pct_recuperable=round(100 * pares_freed / max(1, total_deficit), 1),
                costo_relativo=1,
            ))

    # --- Combination if multiple scenarios ---
    viable = [s for s in scenarios if s.pares_recuperables > 0]
    if len(viable) >= 2:
        # Pick best 2 non-overlapping
        best = viable[:2]
        combo_pares = min(sum(s.pares_recuperables for s in best), total_deficit)
        combo_desc = " + ".join(s.descripcion for s in best)
        combo_config = {s.tipo.lower(): s.config for s in best}

        scenarios.append(Scenario(
            tipo="COMBINACION",
            descripcion=combo_desc,
            config=combo_config,
            pares_recuperables=combo_pares,
            pct_recuperable=round(100 * combo_pares / max(1, total_deficit), 1),
            costo_relativo=2,
        ))

    # Sort: most effective first
    scenarios.sort(key=lambda s: (-s.pct_recuperable, s.costo_relativo))

    return ScenarioProposals(gaps=gaps, scenarios=scenarios)


# ============================================================
# APPLY SCENARIO
# ============================================================

@router.post("/apply-scenario")
def apply_scenario(req: ApplyScenarioRequest):
    """Aplica un escenario: modifica configuracion en Supabase y retorna instrucciones."""

    scenario = req.scenario
    changes_made = []

    if scenario.tipo == "SABADO" or (scenario.tipo == "COMBINACION" and "sabado" in scenario.config):
        sat_cfg = scenario.config if scenario.tipo == "SABADO" else scenario.config.get("sabado", {})
        plantilla = sat_cfg.get("plantilla", 8)
        minutos = sat_cfg.get("minutos", 240)

        # Update Saturday in dias_laborales
        try:
            _sb_patch("dias_laborales", "nombre=eq.Sab", {
                "plantilla": plantilla,
                "minutos": minutos,
            })
            changes_made.append(f"Sábado activado: {plantilla} operarios, {minutos // 60}hrs")
        except Exception as e:
            changes_made.append(f"Error activando sábado: {e}")

    if scenario.tipo == "OVERTIME" or (scenario.tipo == "COMBINACION" and "overtime" in scenario.config):
        ot_cfg = scenario.config if scenario.tipo == "OVERTIME" else scenario.config.get("overtime", {})
        dias = ot_cfg.get("dias", [])
        minutos_extra = ot_cfg.get("minutos_extra", 60)

        # Add minutos_extra to current minutos_ot (not replace)
        for dia in dias:
            try:
                current = _sb_get("dias_laborales", f"select=minutos_ot&nombre=eq.{dia}")
                current_ot = current[0].get("minutos_ot", 0) if current else 0
                new_ot = current_ot + minutos_extra
                _sb_patch("dias_laborales", f"nombre=eq.{dia}", {
                    "minutos_ot": new_ot,
                })
                changes_made.append(f"OT {dia}: {current_ot}min -> {new_ot}min (+{minutos_extra}min)")
            except Exception as e:
                changes_made.append(f"Error OT {dia}: {e}")

    if scenario.tipo == "MAQUILA":
        modelo = scenario.config.get("modelo", "")
        pares = scenario.config.get("pares", 0)
        changes_made.append(
            f"Maquila sugerida: {modelo} {pares}p — "
            f"crear asignacion en la pantalla de Datos > Maquila"
        )

    return {
        "status": "applied",
        "changes": changes_made,
        "next_step": "Re-optimizar para ver el efecto del escenario",
        "pedido_nombre": req.pedido_nombre,
        "semana": req.semana,
    }
