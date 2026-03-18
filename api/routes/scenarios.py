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

    # Load current Saturday config
    sat_config = _sb_get("dias_laborales", "select=*&nombre=eq.Sab")
    sat = sat_config[0] if sat_config else {}
    sat_plantilla = sat.get("plantilla", 0)
    sat_minutos = sat.get("minutos", 300)

    # Load current operator count
    operarios = _sb_get("operarios", "select=id&activo=eq.true")
    total_operarios = len(operarios)

    # --- Scenario 1: SABADO ---
    if gaps.total_hh_faltantes > 0:
        # Calculate Saturday needs
        target_pares = min(gaps.total_tardiness, 800)  # cap at reasonable amount
        plantilla_needed = min(total_operarios, max(6, int(gaps.total_hh_faltantes / 4) + 1))
        horas_needed = min(5, max(2, math.ceil(gaps.total_hh_faltantes / plantilla_needed)))
        minutos_sab = horas_needed * 60

        # Estimate pares producible
        pares_sab = int(plantilla_needed * horas_needed * 80 * 0.7)  # 80 pares/hr avg * efficiency
        pares_sab = min(pares_sab, gaps.total_tardiness + gaps.total_sin_asignar_pares)

        scenarios.append(Scenario(
            tipo="SABADO",
            descripcion=f"Trabajar sábado {horas_needed}hrs con {plantilla_needed} operarios",
            config={
                "plantilla": plantilla_needed,
                "minutos": minutos_sab,
                "horas": horas_needed,
            },
            pares_recuperables=pares_sab,
            pct_recuperable=round(100 * pares_sab / max(1, gaps.total_tardiness + gaps.total_sin_asignar_pares), 1),
            costo_relativo=2,
        ))

    # --- Scenario 2: OVERTIME (entre semana) ---
    # Find days with most tardiness
    days_with_tard = sorted(
        [(g.dia, g.tardiness) for g in gaps.by_day if g.tardiness > 0],
        key=lambda x: -x[1]
    )
    if days_with_tard:
        ot_days = [d[0] for d in days_with_tard[:3]]  # top 3 days
        minutos_extra = 60  # 1 hour extra
        plantilla_ot = 17  # full team

        pares_ot = int(len(ot_days) * plantilla_ot * (minutos_extra / 60) * 80 * 0.7)
        pares_ot = min(pares_ot, gaps.total_tardiness + gaps.total_sin_asignar_pares)

        scenarios.append(Scenario(
            tipo="OVERTIME",
            descripcion=f"+1 hora extra {', '.join(ot_days)}",
            config={
                "dias": ot_days,
                "minutos_extra": minutos_extra,
            },
            pares_recuperables=pares_ot,
            pct_recuperable=round(100 * pares_ot / max(1, gaps.total_tardiness + gaps.total_sin_asignar_pares), 1),
            costo_relativo=1,
        ))

    # --- Scenario 3: MAQUILA ---
    # Find models with robot bottlenecks that could be sent to maquila
    robot_bottleneck_models = [
        g for g in gaps.by_model
        if "ROBOT" in g.recurso_faltante.upper() or "robot" in g.motivo.lower()
    ]
    if robot_bottleneck_models:
        candidate = max(robot_bottleneck_models, key=lambda g: g.sin_asignar_pares + g.tardiness)
        pares_maq = candidate.tardiness + candidate.sin_asignar_pares

        scenarios.append(Scenario(
            tipo="MAQUILA",
            descripcion=f"Enviar {candidate.modelo} a maquila ({pares_maq}p)",
            config={
                "modelo": candidate.modelo,
                "pares": pares_maq,
            },
            pares_recuperables=pares_maq,
            pct_recuperable=round(100 * pares_maq / max(1, gaps.total_tardiness + gaps.total_sin_asignar_pares), 1),
            costo_relativo=3,
        ))

    # --- Scenario 4: COMBINACION (Sábado + OT) ---
    if len(scenarios) >= 2:
        combo_pares = sum(s.pares_recuperables for s in scenarios[:2])
        combo_pares = min(combo_pares, gaps.total_tardiness + gaps.total_sin_asignar_pares)

        # Build combined config
        combo_config = {}
        combo_desc_parts = []
        for s in scenarios[:2]:
            combo_config[s.tipo.lower()] = s.config
            combo_desc_parts.append(s.descripcion)

        scenarios.append(Scenario(
            tipo="COMBINACION",
            descripcion=" + ".join(combo_desc_parts),
            config=combo_config,
            pares_recuperables=combo_pares,
            pct_recuperable=round(100 * combo_pares / max(1, gaps.total_tardiness + gaps.total_sin_asignar_pares), 1),
            costo_relativo=2,
        ))

    # Sort by cost-effectiveness (pares/costo)
    for s in scenarios:
        s.pares_recuperables = min(s.pares_recuperables, gaps.total_tardiness + gaps.total_sin_asignar_pares)

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

        # Update minutos_ot for specified days
        for dia in dias:
            try:
                _sb_patch("dias_laborales", f"nombre=eq.{dia}", {
                    "minutos_ot": minutos_extra,
                })
                changes_made.append(f"OT {dia}: +{minutos_extra}min")
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
