"""
Endpoint de optimizacion — el core del backend.

Recibe datos desde Supabase (via frontend), corre el pipeline
completo de OR-Tools, y guarda resultados de vuelta en Supabase.
"""

import os
import requests
from copy import deepcopy
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from optimizer_weekly import optimize
from optimizer_v2 import schedule_week
from operator_assignment import assign_operators_week
from constraint_compiler import compile_constraints
from rules import TIME_BLOCKS, generate_time_blocks

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


# --- Tipos base por categoria (mismos que en frontend types/index.ts) ---
_ROBOT_BASE_TIPOS = {'3020', '6040', 'CHACHE'}
_PRELIM_BASE_TIPOS = {'MAQ_PINTURA', 'REMACH_NEUMATICA', 'REMACH_MECANICA', 'PERFORADORA_JACK'}


def _compute_resource_capacity() -> dict:
    """Deriva capacidades de recursos a partir de maquinas, fabricas y operarios registrados.
    Solo cuentan maquinas con area=PESPUNTE (las de AVIOS solo se prestan en emergencia)."""
    machines = _sb_get("robots", "select=id,estado,area")
    tipos = _sb_get("robot_tipos", "select=robot_id,tipo")
    fabricas = _sb_get("fabricas", "select=es_maquila")
    op_count_resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/operarios?select=id&activo=eq.true",
        headers={**_sb_headers(), "Prefer": "count=exact"},
    )
    op_count = int(op_count_resp.headers.get("content-range", "0/0").split("/")[-1] or 0)

    # Build tipo set per machine — solo ACTIVO + area PESPUNTE
    available_ids = {
        m["id"] for m in machines
        if m["estado"] == "ACTIVO" and m.get("area") == "PESPUNTE"
    }
    machine_tipos: dict[str, set[str]] = {}
    for t in tipos:
        if t["robot_id"] in available_ids:
            machine_tipos.setdefault(t["robot_id"], set()).add(t["tipo"])

    robot = 0
    mesa = 0
    plana = 0
    poste = 0
    for mid, ts in machine_tipos.items():
        if ts & _ROBOT_BASE_TIPOS:
            robot += 1
        if ts & _PRELIM_BASE_TIPOS:
            mesa += 1
        if 'PLANA' in ts:
            plana += 1
        if 'POSTE' in ts:
            poste += 1

    maquila = sum(1 for f in fabricas if f.get("es_maquila"))

    cap = {
        "ROBOT": robot,
        "MESA": mesa,
        "PLANA": plana,
        "POSTE": poste,
        "MAQUILA": maquila,
        "GENERAL": op_count,
    }
    print(f"[OPT] resource_capacity (derived): {cap}")
    return cap


# --- Helpers para cargar datos de Supabase ---

def _load_params() -> dict:
    """Carga parametros de optimizacion desde Supabase."""
    # Dias laborales
    dias = _sb_get("dias_laborales", "select=*&order=orden")

    # Plantilla automatica: contar operarios activos disponibles por dia
    op_dias = _sb_get("operario_dias", "select=dia,operario_id")
    # Solo contar operarios que estan activos
    active_ops = _sb_get("operarios", "select=id&activo=eq.true")
    active_ids = {o["id"] for o in active_ops}
    plantilla_by_day = {}
    for od in op_dias:
        if od["operario_id"] in active_ids:
            plantilla_by_day[od["dia"]] = plantilla_by_day.get(od["dia"], 0) + 1
    print(f"[OPT] plantilla from DB: {plantilla_by_day}")

    days = [
        {
            "name": d["nombre"],
            "minutes": d["minutos"],
            "plantilla": plantilla_by_day.get(d["nombre"], 0),
            "minutes_ot": d["minutos_ot"],
            "plantilla_ot": plantilla_by_day.get(d["nombre"], 0),
            "is_saturday": d["es_sabado"],
        }
        for d in dias
    ]

    # Horarios → generar TIME_BLOCKS dinamicamente
    horarios = _sb_get("horarios", "select=*")
    horario_semana = next((h for h in horarios if h["tipo"] == "SEMANA"), None)
    if horario_semana:
        time_blocks = generate_time_blocks(
            entrada=horario_semana["entrada"],
            salida=horario_semana["salida"],
            comida_inicio=horario_semana.get("comida_inicio"),
            comida_fin=horario_semana.get("comida_fin"),
            bloque_min=horario_semana.get("bloque_min", 60),
        )
        print(f"[OPT] time_blocks from horarios: {len(time_blocks)} blocks")
    else:
        time_blocks = TIME_BLOCKS
        print("[OPT] time_blocks: using hardcoded fallback")

    # Capacidades — derivadas de recursos registrados
    resource_capacity = _compute_resource_capacity()

    # Parametros optimizador
    opt_params = _sb_get("parametros_optimizacion", "select=nombre,valor")
    opt = {p["nombre"]: float(p["valor"]) for p in opt_params}

    # Pesos
    pesos = _sb_get("pesos_priorizacion", "select=nombre,valor")
    weights = {p["nombre"]: p["valor"] for p in pesos}

    return {
        "min_lot_size": int(opt.get("lote_minimo", 50)),
        "lot_step": 50,
        "time_blocks": time_blocks,
        "resource_types": ["MESA", "ROBOT", "PLANA", "POSTE", "MAQUILA"],
        "resource_capacity": resource_capacity,
        "days": days,
        "lineas_post": int(opt.get("lineas_post", 0)),
        "weights": weights,
        # Daily optimizer weights (read from parametros_optimizacion)
        "w_diario_tardiness": int(opt.get("w_diario_tardiness", 100000)),
        "w_diario_hc_overflow": int(opt.get("w_diario_hc_overflow", 5000)),
        "w_diario_idle": int(opt.get("w_diario_idle", 500)),
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

            recurso = _normalize_recurso(op["recurso"])
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
            "num_ops": sum(1 for op in operations if op.get("recurso") != "MAQUILA"),
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
    """Carga restricciones semanales + reglas permanentes (semana IS NULL)."""
    q = "select=*&order=created_at"
    if semana:
        q += f"&or=(semana.eq.{semana},semana.is.null)"
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


_CANONICAL_RECURSOS = {"MESA", "PLANA", "POSTE", "ROBOT", "MAQUILA", "GENERAL"}


def _normalize_recurso(recurso: str) -> str:
    """Normalize recurso to canonical type (or compound like 'PLANA,POSTE')."""
    if not recurso:
        return "GENERAL"
    r = recurso.strip().upper()
    if r in _CANONICAL_RECURSOS:
        return r
    # Compound resources (e.g. "PLANA,POSTE") — keep if all parts canonical
    if "," in r:
        parts = [p.strip() for p in r.split(",")]
        if all(p in _CANONICAL_RECURSOS for p in parts):
            return ",".join(parts)
        # Normalize each part
        normalized = []
        for p in parts:
            if p in _CANONICAL_RECURSOS:
                normalized.append(p)
            elif "PLANA" in p:
                normalized.append("PLANA")
            elif "POSTE" in p or "POST" in p:
                normalized.append("POSTE")
            elif "MESA" in p:
                normalized.append("MESA")
        return ",".join(normalized) if normalized else "GENERAL"
    # Single unknown → infer
    if "PLANA" in r:
        return "PLANA"
    if "POSTE" in r or "POST" in r:
        return "POSTE"
    if "MESA" in r:
        return "MESA"
    if "ROBOT" in r:
        return "ROBOT"
    if "DESHEBRADORA" in r or "CONFORMADORA" in r or "DESHEBR" in r:
        return "MESA"
    return "GENERAL"


def _load_operarios() -> list:
    """Carga operarios con habilidades simplificadas y deriva recursos/robots."""
    rows = _sb_get("operarios", "select=*&activo=eq.true&order=nombre")

    # All active robot names — used when operator has ROBOTS skill
    all_robots = _sb_get("robots", "select=nombre&estado=eq.ACTIVO")
    all_robot_names = [r["nombre"] for r in all_robots]

    result = []
    for r in rows:
        op_id = r["id"]
        habs = _sb_get("operario_habilidades", f"select=habilidad,nivel&operario_id=eq.{op_id}")
        dias = _sb_get("operario_dias", f"select=dia&operario_id=eq.{op_id}")
        skills = {x["habilidad"] for x in habs}

        # Derive recursos_habilitados from simplified skills
        recursos: set[str] = set()
        robots_hab: list[str] = []

        if 'PRELIMINARES' in skills:
            recursos.add('MESA')
        if 'ROBOTS' in skills:
            recursos.add('ROBOT')
            robots_hab = list(all_robot_names)  # can operate any robot
        if 'MAQ_COMPLEMENTARIAS' in skills:
            recursos.add('MESA')  # complementary machines are mesa-area
        if 'PLANA_RECTA' in skills:
            recursos.add('PLANA')
        if 'POSTE_CONV' in skills:
            recursos.add('POSTE')

        # Pass skill+nivel pairs for operator assignment scoring
        habilidades_nivel = [
            {"habilidad": x["habilidad"], "nivel": x.get("nivel", 2)}
            for x in habs
        ]

        result.append({
            "id": op_id,
            "nombre": r["nombre"],
            "recursos_habilitados": list(recursos),
            "robots_habilitados": robots_hab,
            "habilidades_nivel": habilidades_nivel,
            "eficiencia": float(r["eficiencia"]),
            "dias_disponibles": [x["dia"] for x in dias],
            "activo": True,
        })
    return result


def _week_monday(semana: str) -> datetime:
    """Parse 'sem_WW_YYYY' → Monday date of that ISO week."""
    parts = semana.replace("sem_", "").split("_")
    week_num, year = int(parts[0]), int(parts[1])
    # ISO week: Jan 4 is always in week 1
    jan4 = datetime(year, 1, 4)
    monday_w1 = jan4 - timedelta(days=jan4.isoweekday() - 1)
    return monday_w1 + timedelta(weeks=week_num - 1)


# Block start hours (must match _BLOCK_START_TIMES in constraint_compiler.py)
_BLOCK_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]


def _load_maquila_delivery_dates(pedido_nombre: str) -> dict:
    """Load maquila delivery dates for the current pedido.

    Returns {modelo_num: [(fecha_entrega_str, pares), ...]} — all assignments
    per model so we can handle in-week vs out-of-week deliveries separately.
    """
    # Get pedido id
    ped = _sb_get("pedidos", f"select=id&nombre=eq.{pedido_nombre}")
    if not ped:
        return {}
    pedido_id = ped[0]["id"]

    # Get items with their modelo_num
    items = _sb_get("pedido_items", f"select=id,modelo_num&pedido_id=eq.{pedido_id}")
    if not items:
        return {}

    item_ids = [it["id"] for it in items]
    item_modelo = {it["id"]: it["modelo_num"] for it in items}

    # Get maquila assignments with fecha_entrega
    asigs = _sb_get(
        "asignaciones_maquila",
        f"select=pedido_item_id,fecha_entrega,pares&pedido_item_id=in.({','.join(item_ids)})"
        f"&fecha_entrega=not.is.null",
    )

    # Group by modelo_num — keep all assignments
    result = {}
    for a in asigs:
        modelo = item_modelo.get(a["pedido_item_id"])
        if not modelo:
            continue
        result.setdefault(modelo, []).append(
            (a["fecha_entrega"], a.get("pares", 0))
        )

    return result


def _inject_maquila_delivery(compiled, delivery_dates: dict, semana: str,
                             day_names: list, matched: list):
    """Convert maquila delivery dates to optimizer constraints.

    For each model:
    - Deliveries within the week → scheduling constraint (post-maquila after delivery)
    - Deliveries after the week → subtract those pares from producible volume
    - Deliveries before the week start → no restriction (material already here)
    """
    if not semana:
        return

    monday = _week_monday(semana)
    # Map each day_name to its date
    day_name_order = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab"]
    day_dates = {}
    for i, dn in enumerate(day_name_order):
        if dn in day_names:
            day_dates[dn] = monday + timedelta(days=i)

    first_day_date = min(day_dates[dn].date() for dn in day_names if dn in day_dates)
    last_day_date = max(day_dates[dn].date() for dn in day_names if dn in day_dates)

    for modelo_num, deliveries in delivery_dates.items():
        # Find matched model data
        model_data = None
        codigos = []
        for m in matched:
            if m.get("modelo_num") == modelo_num:
                model_data = m
                codigos.append(m["codigo"])

        if not model_data:
            compiled.warnings.append(
                f"MAQUILA_DELIVERY: modelo '{modelo_num}' not in matched models"
            )
            continue

        # Find max MAQUILA fraccion
        max_maq_frac = 0
        for op in model_data.get("operations", []):
            if op.get("recurso") == "MAQUILA":
                max_maq_frac = max(max_maq_frac, op.get("fraccion", 0))

        if max_maq_frac == 0:
            continue  # No maquila ops found

        min_post_frac = max_maq_frac + 1

        # Classify each delivery
        pares_after_week = 0
        latest_in_week_dt = None  # latest delivery datetime within the week

        for fecha_str, pares in deliveries:
            try:
                dt = datetime.fromisoformat(fecha_str.replace("Z", "+00:00"))
                dt = dt.replace(tzinfo=None)
            except (ValueError, AttributeError):
                compiled.warnings.append(
                    f"MAQUILA_DELIVERY: can't parse fecha_entrega '{fecha_str}'"
                )
                continue

            d = dt.date()
            if d > last_day_date:
                # Delivery after week → these pares can't be produced this week
                pares_after_week += pares
                print(f"[OPT] MAQUILA_DELIVERY {modelo_num}: {pares}p entrega {d} "
                      f"after week, subtracting from volume")
            elif d < first_day_date:
                # Delivery before week start → material already available, no restriction
                print(f"[OPT] MAQUILA_DELIVERY {modelo_num}: {pares}p entrega {d} "
                      f"before week, no restriction")
            else:
                # Delivery within the week
                if latest_in_week_dt is None or dt > latest_in_week_dt:
                    latest_in_week_dt = dt

        # Subtract pares that won't arrive this week from volume
        if pares_after_week > 0:
            compiled.maquila_pares_unavailable[modelo_num] = \
                compiled.maquila_pares_unavailable.get(modelo_num, 0) + pares_after_week
            print(f"[OPT] MAQUILA_DELIVERY {modelo_num}: volume reduced by "
                  f"{pares_after_week}p (out-of-week deliveries)")

        # Apply scheduling constraint for in-week delivery
        if latest_in_week_dt is None:
            continue  # No in-week deliveries

        delivery_date = latest_in_week_dt.date()
        delivery_hour = latest_in_week_dt.hour

        # Map to day_name and day_index
        target_day = None
        target_day_idx = None
        for i, dn in enumerate(day_names):
            if dn in day_dates and day_dates[dn].date() == delivery_date:
                target_day = dn
                target_day_idx = i
                break

        if target_day is None:
            continue

        # If delivery is on first day (day_idx 0), no scheduling restriction needed
        # (material arrives at start of the week)
        if target_day_idx == 0 and delivery_hour <= 8:
            print(f"[OPT] MAQUILA_DELIVERY {modelo_num}: entrega {target_day} "
                  f"at start of week, no restriction")
            continue

        # Map hour to block index
        target_block = 0
        for idx, bh in enumerate(_BLOCK_HOURS):
            if bh <= delivery_hour:
                target_block = idx
            else:
                break

        # Weekly constraint: no production before delivery day
        compiled.maquila_earliest_day[modelo_num] = target_day_idx

        # Daily constraint: on delivery day, only blocks >= target_block
        for codigo in codigos:
            for i in range(target_day_idx):
                compiled.maquila_block_restriction.append(
                    (codigo, day_names[i], 11, min_post_frac)
                )
            compiled.maquila_block_restriction.append(
                (codigo, target_day, target_block, min_post_frac)
            )

        print(f"[OPT] MAQUILA_DELIVERY {modelo_num}: entrega {target_day} bloque "
              f"{target_block} ({latest_in_week_dt}), post-maquila fracs >= {min_post_frac}")


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
                "codigo": f"{modelo_num} {item.get('color', '')}".strip(),
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
    reopt_from_day: Optional[str] = None  # day name e.g. "Mie", or null


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

    # --- Resolver reopt_from_day: nombre → indice en params.days ---
    days = params.get("days", [])
    reopt_day_idx = None
    if req.reopt_from_day:
        day_name_list = [d["name"] for d in days]
        if req.reopt_from_day in day_name_list:
            reopt_day_idx = day_name_list.index(req.reopt_from_day)
            print(f"[OPT] reopt_from_day: '{req.reopt_from_day}' → idx {reopt_day_idx} in {day_name_list}")
        else:
            print(f"[OPT] WARNING: reopt_from_day '{req.reopt_from_day}' not found in {day_name_list}")

    # --- Diagnosticos: validar datos antes de optimizar ---
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
    print(f"[OPT] resource_capacity (derived): {resource_cap}")
    if not resource_cap:
        raise HTTPException(
            400,
            "No hay recursos registrados (robots, maquinas, operarios). "
            "Registra recursos en Configuracion > Recursos.",
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
        print(f"  {m['codigo']}: {m['total_producir']} pares, "
              f"{m['num_ops']} ops, {m['total_sec_per_pair']}s/par")
        if m["num_ops"] == 0:
            print(f"  *** ATENCION: modelo {m['codigo']} sin operaciones!")
        if m["total_sec_per_pair"] == 0:
            print(f"  *** ATENCION: modelo {m['codigo']} con 0 sec/par!")

    if not matched:
        raise HTTPException(400, "Ningun modelo del pedido tiene catalogo")

    # 3. Compilar restricciones
    compiled = compile_constraints(
        restricciones, avance_data, matched, params["days"],
        reopt_from_day=reopt_day_idx,
    )

    # 3b. Inyectar restricciones de entrega maquila desde asignaciones_maquila
    day_names = [d["name"] for d in params["days"]]
    if req.pedido_nombre:
        delivery_dates = _load_maquila_delivery_dates(req.pedido_nombre)
        if delivery_dates:
            _inject_maquila_delivery(compiled, delivery_dates, req.semana, day_names, matched)
            print(f"[OPT] maquila_earliest_day: {compiled.maquila_earliest_day}")
            print(f"[OPT] maquila_block_restriction: {compiled.maquila_block_restriction}")

    # 4. Ajustar volumenes
    models_for_opt = deepcopy(matched)
    for m in models_for_opt:
        mn = m.get("modelo_num", "")
        if mn in compiled.maquila:
            m["total_producir"] = max(0, m["total_producir"] - compiled.maquila[mn])
        if mn in compiled.volume_overrides:
            m["total_producir"] = compiled.volume_overrides[mn]
        if mn in compiled.maquila_pares_unavailable:
            m["total_producir"] = max(0, m["total_producir"] - compiled.maquila_pares_unavailable[mn])
        if mn in compiled.avance:
            if reopt_day_idx is not None:
                already = sum(
                    p for dn, p in compiled.avance[mn].items()
                    if dn in day_names and day_names.index(dn) < reopt_day_idx
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

    # 5b. Filtrar modelos con volumen 0 (puede pasar por maquila total o avance completo)
    models_for_opt = [m for m in models_for_opt if m["total_producir"] > 0]

    # 6. Optimizacion semanal
    weekly_schedule, weekly_summary = optimize(models_for_opt, params, compiled)

    # 7. Scheduling diario
    raw_daily = schedule_week(weekly_schedule, models_for_opt, params, compiled, operarios=operarios)

    # 8. Asignacion de operarios (ANTES de renombrar campos,
    #    porque operator_assignment.py espera block_pares/total_pares/robots_used)
    op_results = {}
    print(f"[OPT] operarios loaded: {len(operarios)}")
    for op in operarios:
        print(f"  {op['nombre']}: recursos={op['recursos_habilitados']}, robots={op.get('robots_habilitados', [])[:3]}...")
    if operarios:
        # Debug: print first day's schedule entries
        first_day = next(iter(raw_daily), None)
        if first_day:
            for s in raw_daily[first_day].get("schedule", [])[:5]:
                print(f"  [SCHED] {s['modelo']} F{s['fraccion']}: recurso={s['recurso']}, robots_eligible={s.get('robots_eligible', [])}, robots_used={s.get('robots_used', [])}")
        op_results = assign_operators_week(
            raw_daily, operarios, params["time_blocks"]
        )
        # Debug: print assignment results
        if first_day and first_day in op_results:
            for a in op_results[first_day].get("assignments", [])[:8]:
                print(f"  [ASSIGN] {a['modelo']} F{a.get('fraccion',0)}: {a.get('recurso','?')} -> {a.get('operario','?')}")

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

            entry = {
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
            }
            if s.get("adelanto"):
                entry["adelanto"] = True
                entry["adelanto_de"] = s.get("adelanto_de", "")
            schedule.append(entry)

        day_dict = {
            "status": summary.get("status", ""),
            "total_pares": summary.get("total_pares", 0),
            "total_tardiness": summary.get("total_tardiness", 0),
            "plantilla": summary.get("plantilla", 0),
            "schedule": schedule,
            "operator_timelines": op_day.get("operator_timelines", {}),
            "unassigned_ops": op_day.get("unassigned", []),
        }
        if summary.get("pares_adelantados"):
            day_dict["pares_adelantados"] = summary["pares_adelantados"]
        if summary.get("pares_rezago"):
            day_dict["pares_rezago"] = summary["pares_rezago"]
        if summary.get("tardiness_by_model"):
            day_dict["tardiness_by_model"] = summary["tardiness_by_model"]
        daily_results[day_name] = day_dict

    # 10. Preservar dias congelados del resultado anterior (reopt_from_day)
    base_name = req.semana or req.pedido_nombre
    if reopt_day_idx is not None and reopt_day_idx > 0:
        frozen_day_names = {d["name"] for i, d in enumerate(days) if i < reopt_day_idx}
        prev = _sb_get(
            "resultados",
            f"select=daily_results,weekly_schedule&base_name=eq.{base_name}"
            f"&order=version.desc&limit=1",
        )
        if prev and prev[0].get("daily_results"):
            prev_daily = prev[0]["daily_results"]
            prev_weekly = prev[0].get("weekly_schedule", [])
            # Merge frozen days from previous result
            for dn in frozen_day_names:
                if dn in prev_daily:
                    daily_results[dn] = prev_daily[dn]
                    print(f"  [REOPT] {dn}: preservado del resultado anterior")
            # Merge frozen weekly entries
            frozen_entries = [e for e in prev_weekly if e.get("Dia") in frozen_day_names]
            new_entries = [e for e in weekly_schedule if e.get("Dia") not in frozen_day_names]
            weekly_schedule = frozen_entries + new_entries
            print(f"  [REOPT] weekly_schedule: {len(frozen_entries)} frozen + {len(new_entries)} new")

    # 11. Guardar resultado en Supabase
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
