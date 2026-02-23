"""
Endpoint de optimizacion — el core del backend.

Recibe datos desde Supabase (via frontend), corre el pipeline
completo de OR-Tools, y guarda resultados de vuelta en Supabase.
"""

import os
import requests
from copy import deepcopy
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from optimizer_weekly import optimize
from optimizer_v2 import schedule_week
from operator_assignment import assign_operators_week
from constraint_compiler import compile_constraints
from rules import TIME_BLOCKS

router = APIRouter()

# Supabase config desde env vars
# Usar service_role key para bypasear RLS (el backend necesita acceso a todos los datos)
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
    """GET a Supabase REST API."""
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}?{query}",
        headers=_sb_headers(),
    )
    r.raise_for_status()
    return r.json()


def _sb_post(table: str, data: dict) -> dict:
    """POST a Supabase REST API."""
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=_sb_headers(),
        json=data,
    )
    r.raise_for_status()
    result = r.json()
    return result[0] if isinstance(result, list) and result else result


# --- Helpers para cargar datos de Supabase ---

def _load_params() -> dict:
    """Carga parametros de optimizacion desde Supabase."""
    # Dias laborales
    dias = _sb_get("dias_laborales", "select=*&order=orden")
    days = [
        {
            "name": d["nombre"],
            "minutes": d["minutos"],
            "plantilla": d["plantilla"],
            "minutes_ot": d["minutos_ot"],
            "plantilla_ot": d["plantilla_ot"],
            "is_saturday": d["es_sabado"],
        }
        for d in dias
    ]

    # Capacidades
    caps = _sb_get("capacidades_recurso", "select=tipo,pares_hora")
    resource_capacity = {c["tipo"]: c["pares_hora"] for c in caps}

    # Parametros optimizador
    opt_params = _sb_get("parametros_optimizacion", "select=nombre,valor")
    opt = {p["nombre"]: float(p["valor"]) for p in opt_params}

    # Pesos
    pesos = _sb_get("pesos_priorizacion", "select=nombre,valor")
    weights = {p["nombre"]: p["valor"] for p in pesos}

    return {
        "min_lot_size": int(opt.get("lote_minimo", 50)),
        "lot_step": 50,
        "time_blocks": TIME_BLOCKS,
        "resource_types": ["MESA", "ROBOT", "PLANA", "POSTE", "MAQUILA"],
        "resource_capacity": resource_capacity,
        "days": days,
        "lead_time_maquila": int(opt.get("lead_time_maquila", 3)),
        "weights": weights,
    }


def _load_catalogo() -> dict:
    """Carga catalogo completo desde Supabase."""
    modelos = _sb_get("catalogo_modelos", "select=*")
    catalogo = {}

    for m in modelos:
        modelo_id = m["id"]
        modelo_num = m["modelo_num"]

        # Operaciones con robots
        ops = _sb_get(
            "catalogo_operaciones",
            f"select=*,catalogo_operacion_robots(robot_id,robots(nombre))"
            f"&modelo_id=eq.{modelo_id}&order=fraccion",
        )

        operations = []
        resource_summary = {}
        robots_used = set()
        total_sec = 0

        for op in ops:
            robot_names = []
            for rel in (op.get("catalogo_operacion_robots") or []):
                rn = rel.get("robots", {}).get("nombre", "")
                if rn:
                    robot_names.append(rn)
                    robots_used.add(rn)

            recurso = op["recurso"]
            resource_summary[recurso] = resource_summary.get(recurso, 0) + 1
            total_sec += op["sec_per_pair"]

            operations.append({
                "fraccion": op["fraccion"],
                "operacion": op["operacion"],
                "input_o_proceso": op["input_o_proceso"],
                "etapa": op.get("etapa", ""),
                "recurso": recurso,
                "recurso_raw": op.get("recurso_raw", ""),
                "robots": sorted(robot_names),
                "rate": float(op["rate"]),
                "sec_per_pair": op["sec_per_pair"],
            })

        catalogo[modelo_num] = {
            "codigo_full": m.get("codigo_full", modelo_num),
            "alternativas": m.get("alternativas", []),
            "clave_material": m.get("clave_material", ""),
            "operations": operations,
            "total_sec_per_pair": total_sec,
            "num_ops": len(operations),
            "resource_summary": resource_summary,
            "robot_ops": resource_summary.get("ROBOT", 0),
            "robots_used": sorted(robots_used),
        }

    return catalogo


def _load_pedido(pedido_nombre: str) -> list:
    """Carga items de un pedido."""
    ped = _sb_get("pedidos", f"select=id&nombre=eq.{pedido_nombre}")
    if not ped:
        return []
    items = _sb_get("pedido_items", f"select=*&pedido_id=eq.{ped[0]['id']}")
    return [
        {
            "modelo": it["modelo_num"],
            "color": it.get("color", ""),
            "volumen": it["volumen"],
            "fabrica": it.get("fabrica", ""),
        }
        for it in items
    ]


def _load_restricciones(semana: str = None) -> list:
    """Carga restricciones."""
    q = "select=*&order=created_at"
    if semana:
        q += f"&semana=eq.{semana}"
    rows = _sb_get("restricciones", q)
    return [
        {
            "id": r["id"],
            "tipo": r["tipo"],
            "modelo": r["modelo_num"],
            "activa": r["activa"],
            "parametros": r["parametros"],
        }
        for r in rows
    ]


def _load_avance(semana: str) -> dict:
    """Carga avance de produccion."""
    av = _sb_get("avance", f"select=*&semana=eq.{semana}")
    if not av:
        return {}
    detalles = _sb_get("avance_detalle", f"select=*&avance_id=eq.{av[0]['id']}")
    modelos = {}
    for d in detalles:
        mn = d["modelo_num"]
        if mn not in modelos:
            modelos[mn] = {}
        modelos[mn][d["dia"]] = d["pares"]
    return modelos


def _load_operarios() -> list:
    """Carga operarios con sus relaciones."""
    rows = _sb_get("operarios", "select=*,fabricas(nombre)&activo=eq.true&order=nombre")
    result = []
    for r in rows:
        op_id = r["id"]
        recursos = _sb_get("operario_recursos", f"select=recurso&operario_id=eq.{op_id}")
        robots = _sb_get("operario_robots", f"select=robots(nombre)&operario_id=eq.{op_id}")
        dias = _sb_get("operario_dias", f"select=dia&operario_id=eq.{op_id}")

        result.append({
            "id": op_id,
            "nombre": r["nombre"],
            "fabrica": (r.get("fabricas") or {}).get("nombre", ""),
            "recursos_habilitados": [x["recurso"] for x in recursos],
            "robots_habilitados": [x["robots"]["nombre"] for x in robots],
            "eficiencia": float(r["eficiencia"]),
            "dias_disponibles": [x["dia"] for x in dias],
            "activo": True,
        })
    return result


def _match_models(catalogo: dict, pedido: list) -> list:
    """Cruza pedido con catalogo (equivale a fuzzy_match)."""
    matched = []
    for item in pedido:
        modelo_num = item["modelo"]
        if modelo_num in catalogo:
            cat = catalogo[modelo_num]
            matched.append({
                "modelo_num": modelo_num,
                "codigo_full": cat["codigo_full"],
                "codigo": cat.get("codigo_full", modelo_num),
                "color": item.get("color", ""),
                "fabrica": item.get("fabrica", ""),
                "suela": cat.get("clave_material", ""),
                "total_producir": item["volumen"],
                "operations": cat["operations"],
                "total_sec_per_pair": cat["total_sec_per_pair"],
                "num_ops": cat["num_ops"],
                "resource_summary": cat["resource_summary"],
                "robot_ops": cat.get("robot_ops", 0),
                "robots_used": cat.get("robots_used", []),
            })
    return matched


def _save_resultado(base_name: str, weekly_schedule, weekly_summary,
                    daily_results, pedido, params, nota="") -> str:
    """Guarda resultado en Supabase con versionado."""
    import json

    existing = _sb_get(
        "resultados",
        f"select=version&base_name=eq.{base_name}&order=version.desc&limit=1",
    )
    next_version = (existing[0]["version"] + 1) if existing else 1
    nombre = f"{base_name}_v{next_version}"

    _sb_post("resultados", {
        "nombre": nombre,
        "base_name": base_name,
        "version": next_version,
        "nota": nota,
        "weekly_schedule": weekly_schedule,
        "weekly_summary": weekly_summary,
        "daily_results": daily_results,
        "pedido_snapshot": pedido,
        "params_snapshot": params,
    })

    return nombre


# --- Request/Response models ---

class OptimizeRequest(BaseModel):
    pedido_nombre: str
    semana: str = ""
    nota: str = ""
    reopt_from_day: Optional[int] = None


class OptimizeResponse(BaseModel):
    status: str
    total_pares: int
    tardiness: int
    wall_time: float
    saved_as: str


# --- Endpoint ---

@router.post("/optimize", response_model=OptimizeResponse)
def run_optimization(req: OptimizeRequest):
    """Ejecuta el pipeline completo de optimizacion."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise HTTPException(500, "Supabase no configurado en el servidor")

    # 1. Cargar datos desde Supabase
    params = _load_params()
    catalogo = _load_catalogo()
    pedido = _load_pedido(req.pedido_nombre)
    if not pedido:
        raise HTTPException(404, f"Pedido '{req.pedido_nombre}' no encontrado")

    # --- Diagnosticos: validar datos antes de optimizar ---
    days = params.get("days", [])
    print(f"[OPT] dias_laborales: {len(days)} dias")
    for d in days:
        print(f"  {d['name']}: {d['minutes']}min, plantilla={d['plantilla']}")
    if not days:
        raise HTTPException(
            400,
            "Tabla 'dias_laborales' esta vacia. "
            "Ejecuta el seed SQL de la migracion inicial.",
        )

    resource_cap = params.get("resource_capacity", {})
    print(f"[OPT] capacidades_recurso: {resource_cap}")
    if not resource_cap:
        raise HTTPException(
            400,
            "Tabla 'capacidades_recurso' esta vacia. "
            "Ejecuta el seed SQL de la migracion inicial.",
        )

    print(f"[OPT] catalogo: {len(catalogo)} modelos")
    for mn, cat in catalogo.items():
        print(f"  {mn}: {cat['num_ops']} ops, {cat['total_sec_per_pair']}s/par")

    print(f"[OPT] pedido '{req.pedido_nombre}': {len(pedido)} items")
    for it in pedido:
        print(f"  {it['modelo']} x{it['volumen']} ({it.get('fabrica','')})")

    restricciones = _load_restricciones(req.semana or None)
    avance_data = _load_avance(req.semana) if req.semana else {}
    operarios = _load_operarios()

    # 2. Cruzar pedido con catalogo
    matched = _match_models(catalogo, pedido)
    print(f"[OPT] matched: {len(matched)} modelos cruzados")
    for m in matched:
        print(f"  {m['modelo_num']}: {m['total_producir']} pares, "
              f"{m['num_ops']} ops, {m['total_sec_per_pair']}s/par")
        if m["num_ops"] == 0:
            print(f"  *** ATENCION: modelo {m['modelo_num']} sin operaciones!")
        if m["total_sec_per_pair"] == 0:
            print(f"  *** ATENCION: modelo {m['modelo_num']} con 0 sec/par!")

    if not matched:
        raise HTTPException(400, "Ningun modelo del pedido tiene catalogo")

    # 3. Compilar restricciones
    compiled = compile_constraints(
        restricciones, avance_data, matched, params["days"],
        reopt_from_day=req.reopt_from_day,
    )

    # 4. Ajustar volumenes
    day_names = [d["name"] for d in params["days"]]
    models_for_opt = deepcopy(matched)
    for m in models_for_opt:
        mn = m.get("modelo_num", "")
        if mn in compiled.maquila:
            m["total_producir"] = max(0, m["total_producir"] - compiled.maquila[mn])
        if mn in compiled.volume_overrides:
            m["total_producir"] = compiled.volume_overrides[mn]
        if mn in compiled.avance:
            if req.reopt_from_day is not None:
                already = sum(
                    p for dn, p in compiled.avance[mn].items()
                    if dn in day_names and day_names.index(dn) < req.reopt_from_day
                )
            else:
                already = sum(compiled.avance[mn].values())
            m["total_producir"] = max(0, m["total_producir"] - already)

    # 5. Ajustar plantilla por restricciones
    params = deepcopy(params)
    for day_cfg in params["days"]:
        dn = day_cfg["name"]
        if dn in compiled.plantilla_overrides:
            day_cfg["plantilla"] = compiled.plantilla_overrides[dn]
        elif dn in compiled.plantilla_adjustments:
            day_cfg["plantilla"] = max(1, day_cfg["plantilla"] + compiled.plantilla_adjustments[dn])

    # 6. Optimizacion semanal
    weekly_schedule, weekly_summary = optimize(models_for_opt, params, compiled)

    # 7. Scheduling diario
    raw_daily = schedule_week(weekly_schedule, models_for_opt, params, compiled)

    # 8. Asignacion de operarios (ANTES de renombrar campos,
    #    porque operator_assignment.py espera block_pares/total_pares/robots_used)
    op_results = {}
    if operarios:
        op_results = assign_operators_week(
            raw_daily, operarios, params["time_blocks"]
        )

    # 9. Aplanar: mover summary fields al top level y renombrar campos de schedule
    # para coincidir con DailyResult/DailyScheduleEntry del frontend.
    # Si hay operator assignments, usar el augmented schedule que incluye operarios.
    model_lookup = {m["codigo"]: m for m in models_for_opt}
    daily_results = {}
    for day_name, day_data in raw_daily.items():
        summary = day_data.get("summary", {})

        # Usar augmented schedule (con operarios) si existe, sino raw
        op_day = op_results.get(day_name, {})
        source_schedule = op_day.get("assignments") or day_data.get("schedule", [])

        # Transformar schedule entries: renombrar campos para el frontend
        schedule = []
        for s in source_schedule:
            # Buscar etapa desde las operaciones del catalogo
            modelo_code = s.get("modelo", "")
            etapa = ""
            cat_model = model_lookup.get(modelo_code)
            if cat_model:
                for op in cat_model.get("operations", []):
                    if op["fraccion"] == s.get("fraccion"):
                        etapa = op.get("etapa", "")
                        break

            schedule.append({
                "modelo": modelo_code,
                "fraccion": s.get("fraccion", 0),
                "operacion": s.get("operacion", ""),
                "recurso": s.get("recurso", ""),
                "rate": s.get("rate", 0),
                "hc": s.get("hc", 0),
                "etapa": etapa,
                "blocks": s.get("block_pares", []),
                "total": s.get("total_pares", 0),
                "robot": s.get("robot_asignado") or (s.get("robots_used") or [None])[0],
                "operario": s.get("operario", ""),
            })

        daily_results[day_name] = {
            "status": summary.get("status", ""),
            "total_pares": summary.get("total_pares", 0),
            "total_tardiness": summary.get("total_tardiness", 0),
            "plantilla": summary.get("plantilla", 0),
            "schedule": schedule,
            "operator_timelines": op_day.get("operator_timelines", {}),
            "unassigned_ops": op_day.get("unassigned", []),
        }

    # 10. Guardar resultado en Supabase
    base_name = req.semana or req.pedido_nombre
    saved_as = _save_resultado(
        base_name, weekly_schedule, weekly_summary,
        daily_results, pedido, params, req.nota,
    )

    return OptimizeResponse(
        status=weekly_summary.get("status", "UNKNOWN"),
        total_pares=weekly_summary.get("total_pares", 0),
        tardiness=weekly_summary.get("total_tardiness", 0),
        wall_time=weekly_summary.get("wall_time_s", 0),
        saved_as=saved_as,
    )
