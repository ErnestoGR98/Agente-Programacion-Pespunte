"""
Endpoint de capacidad instalada.

Calcula el techo teorico de produccion usando solo restricciones fisicas
(robots, maquinas, precedencias). Sin operarios, sin skills, sin HC.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from capacity_planner import plan_capacity
from routes.optimize import (
    _load_params, _load_catalogo, _load_pedido, _match_models,
    _load_restricciones, _save_resultado, SUPABASE_URL, SUPABASE_KEY,
    _sb_get,
)
from constraint_compiler import compile_constraints
from copy import deepcopy

router = APIRouter()


class CapacityRequest(BaseModel):
    pedido_nombre: str
    semana: str = ""
    nota: str = ""


class CapacityResponse(BaseModel):
    status: str
    total_pares: int
    tardiness: int
    wall_time: float
    saved_as: str
    daily_total: int
    daily_tardiness: int


@router.post("/capacity-plan", response_model=CapacityResponse)
def run_capacity_plan(req: CapacityRequest):
    """Calcula la capacidad instalada teorica de la planta."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise HTTPException(500, "Supabase no configurado")

    # 1. Cargar datos (mismo que optimize)
    params = _load_params()
    catalogo = _load_catalogo()
    pedido = _load_pedido(req.pedido_nombre)
    if not pedido:
        raise HTTPException(404, f"Pedido '{req.pedido_nombre}' no encontrado")

    # 2. Match models
    matched = _match_models(catalogo, pedido)
    if not matched:
        raise HTTPException(400, "Ningun modelo del pedido tiene catalogo")

    # 3. Compilar restricciones (solo permanentes, no temporales de HC)
    restricciones = _load_restricciones(req.semana or None)
    compiled = compile_constraints(
        restricciones, {}, matched, params["days"],
    )

    # 4. Ajustar volumenes por maquila
    models_for_cap = deepcopy(matched)
    for m in models_for_cap:
        mn = m.get("modelo_num", "")
        if mn in compiled.maquila:
            m["total_producir"] = max(0, m["total_producir"] - compiled.maquila[mn])
        if mn in compiled.volume_overrides:
            m["total_producir"] = compiled.volume_overrides[mn]

    # Redondear a multiplos de lot_step
    step = params.get("lot_step", 100)
    for m in models_for_cap:
        tp = m["total_producir"]
        remainder = tp % step
        if remainder > 0:
            m["total_producir"] = tp + (step - remainder)

    models_for_cap = [m for m in models_for_cap if m["total_producir"] > 0]

    # 5. Correr capacity planner
    weekly_schedule, weekly_summary, daily_results = plan_capacity(
        models_for_cap, params, compiled
    )

    # 6. Guardar resultado
    base_name = f"cap_{req.semana or req.pedido_nombre}"
    saved_as = _save_resultado(
        base_name, weekly_schedule, weekly_summary,
        daily_results, pedido, params, req.nota or "Capacidad Instalada",
    )

    return CapacityResponse(
        status=weekly_summary.get("status", "UNKNOWN"),
        total_pares=weekly_summary.get("total_pares", 0),
        tardiness=weekly_summary.get("total_tardiness", 0),
        wall_time=weekly_summary.get("wall_time_s", 0),
        saved_as=saved_as,
        daily_total=weekly_summary.get("daily_total_pares", 0),
        daily_tardiness=weekly_summary.get("daily_total_tardiness", 0),
    )
