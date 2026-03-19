"""
capacity_planner.py — Vista de capacidad instalada.

Planifica usando SOLO restricciones fisicas:
- Robot exclusivity (1 robot = 1 op por bloque)
- Conteo de maquinas (MESA, PLANA, POSTE)
- Precedencias (cascada + conveyor buffer=0)
- Rates de operacion (propiedad de la maquina)

SIN operarios, SIN skills, SIN HC limits.
Muestra el techo teorico de produccion de la planta.
"""

from ortools.sat.python import cp_model
from collections import defaultdict

# ---------------------------------------------------------------------------
# Pesos del objetivo (simplificados)
# ---------------------------------------------------------------------------
_W_TARDINESS = 100_000
_W_SPAN = 3_000
_W_BALANCE = 500
_W_SATURDAY = 300


# ---------------------------------------------------------------------------
# Weekly distribution — CP-SAT simplificado (solo limites fisicos)
# ---------------------------------------------------------------------------

def _capacity_weekly(models, params, compiled=None):
    """
    Distribuye pares en la semana usando solo capacidad fisica de maquinas/robots.
    No usa plantilla, operator_capacity ni throughput_factor.
    """
    solver_model = cp_model.CpModel()
    days = params["days"]
    num_days = len(days)
    num_models = len(models)
    step = params.get("lot_step", 100)
    resource_cap = params.get("resource_capacity", {})

    # --- Robots por modelo: mapear operacion → robot names ---
    # Para el constraint de exclusividad de robots a nivel semanal,
    # necesitamos saber cuantos segundos de cada robot usa cada modelo.
    robot_sec_per_model = defaultdict(lambda: defaultdict(float))  # robot_name → model_idx → sec
    for m, model in enumerate(models):
        for op in model.get("operations", []):
            robots = op.get("robots", [])
            if robots:
                spp = op.get("sec_per_pair", 60)
                for rname in robots:
                    robot_sec_per_model[rname][m] += spp

    # Carga por recurso por modelo (excluir MAQUILA y ROBOT individual)
    model_resource_load = []
    for model in models:
        rload = {}
        for op in model.get("operations", []):
            r = op.get("recurso", "GENERAL") or "GENERAL"
            if r == "MAQUILA":
                continue
            # Robots ya se manejan individualmente
            rload[r] = rload.get(r, 0) + op.get("sec_per_pair", 0)
        model_resource_load.append(rload)

    # --- Variables ---
    x = {}
    z = {}
    for m, model in enumerate(models):
        max_batches = model["total_producir"] // step
        for d in range(num_days):
            x[m, d] = solver_model.NewIntVar(0, model["total_producir"], f"x_{m}_{d}")
            z[m, d] = solver_model.NewIntVar(0, max_batches, f"z_{m}_{d}")
            solver_model.Add(x[m, d] == step * z[m, d])

    y = {}
    for m in range(num_models):
        for d in range(num_days):
            y[m, d] = solver_model.NewBoolVar(f"y_{m}_{d}")

    tardiness = {}
    for m, model in enumerate(models):
        tardiness[m] = solver_model.NewIntVar(0, model["total_producir"], f"tard_{m}")

    # Span tracking
    first_day = {}
    last_day = {}
    span = {}
    for m in range(num_models):
        first_day[m] = solver_model.NewIntVar(0, num_days - 1, f"fd_{m}")
        last_day[m] = solver_model.NewIntVar(0, num_days - 1, f"ld_{m}")
        span[m] = solver_model.NewIntVar(0, num_days - 1, f"sp_{m}")
        for d in range(num_days):
            solver_model.Add(first_day[m] <= d).OnlyEnforceIf(y[m, d])
            solver_model.Add(last_day[m] >= d).OnlyEnforceIf(y[m, d])
        solver_model.Add(span[m] >= last_day[m] - first_day[m])

    # --- Constraints ---

    # 1. Completar volumen
    for m, model in enumerate(models):
        solver_model.Add(
            sum(x[m, d] for d in range(num_days)) + tardiness[m] == model["total_producir"]
        )

    # 2. Lote minimo + linking y↔x
    min_lot = params.get("min_lot_size", 100)
    for m, model in enumerate(models):
        effective_min = min(min_lot, model["total_producir"])
        effective_min = (effective_min // step) * step
        for d in range(num_days):
            solver_model.Add(x[m, d] <= model["total_producir"] * y[m, d])
            solver_model.Add(x[m, d] >= effective_min * y[m, d])

    # 2b. Restricciones compiladas (dia availability, frozen days, secuencias)
    if compiled and hasattr(compiled, 'day_availability'):
        for m, model in enumerate(models):
            mn = model.get("modelo_num", "")
            if mn in getattr(compiled, 'day_availability', {}):
                allowed = compiled.day_availability[mn]
                day_names = [d["name"] for d in days]
                for d in range(num_days):
                    if day_names[d] not in allowed:
                        solver_model.Add(x[m, d] == 0)

    # 3. Capacidad por recurso por dia (solo limites fisicos de maquinas)
    if resource_cap:
        for d in range(num_days):
            day_minutes = days[d]["minutes"] + days[d].get("minutes_ot", 0)
            for res_type, cap in resource_cap.items():
                if res_type in ("ROBOT", "GENERAL", "MAQUILA"):
                    continue
                terms = []
                for m in range(num_models):
                    load_sec = model_resource_load[m].get(res_type, 0)
                    if load_sec > 0:
                        terms.append(x[m, d] * load_sec)
                if terms:
                    solver_model.Add(sum(terms) <= cap * day_minutes * 60)

    # 4. Capacidad por robot individual por dia
    #    Cada robot fisico tiene max bloques_productivos * 3600 segundos/dia
    for rname, model_secs in robot_sec_per_model.items():
        for d in range(num_days):
            day_minutes = days[d]["minutes"] + days[d].get("minutes_ot", 0)
            max_robot_sec = int(day_minutes * 60)  # 1 robot, all blocks
            terms = []
            for m_idx, spp in model_secs.items():
                terms.append(x[m_idx, d] * int(spp))
            if terms:
                solver_model.Add(sum(terms) <= max_robot_sec)

    # 5. Max models per day (physical constraint: more models = more cascade overhead)
    for d in range(num_days):
        solver_model.Add(sum(y[m, d] for m in range(num_models)) <= max(4, num_models))

    # --- Objective ---
    obj_terms = []

    for m in range(num_models):
        obj_terms.append(_W_TARDINESS * tardiness[m])

    for m in range(num_models):
        obj_terms.append(_W_SPAN * span[m])

    # Balance: minimize max-min pares spread
    total_volume = sum(model["total_producir"] for model in models)
    max_pares = solver_model.NewIntVar(0, total_volume, "max_pares")
    min_pares = solver_model.NewIntVar(0, total_volume, "min_pares")
    normal_days = [d for d in range(num_days) if not days[d].get("is_saturday", False)]
    for d in normal_days:
        day_pares = sum(x[m, d] for m in range(num_models))
        solver_model.Add(max_pares >= day_pares)
        solver_model.Add(min_pares <= day_pares)
    obj_terms.append(_W_BALANCE * (max_pares - min_pares))

    # Saturday penalty
    for d in range(num_days):
        if days[d].get("is_saturday", False):
            for m in range(num_models):
                obj_terms.append(_W_SATURDAY * x[m, d])

    solver_model.Minimize(sum(obj_terms))

    # --- Solve ---
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 15
    solver.parameters.num_workers = 4
    status = solver.Solve(solver_model)

    status_name = {
        cp_model.OPTIMAL: "OPTIMAL",
        cp_model.FEASIBLE: "FEASIBLE",
        cp_model.INFEASIBLE: "INFEASIBLE",
        cp_model.MODEL_INVALID: "MODEL_INVALID",
    }.get(status, "UNKNOWN")

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return [], {"status": status_name, "total_pares": 0, "total_tardiness": 0,
                     "wall_time_s": solver.WallTime()}

    # --- Extract ---
    schedule = []
    for m, model in enumerate(models):
        for d in range(num_days):
            pares = solver.Value(x[m, d])
            if pares > 0:
                schedule.append({
                    "Dia": days[d]["name"],
                    "Modelo": model["codigo"],
                    "Pares": pares,
                    "Fabrica": model.get("fabrica", ""),
                })

    total_pares = sum(e["Pares"] for e in schedule)
    total_tard = sum(solver.Value(tardiness[m]) for m in range(num_models))

    summary = {
        "status": status_name,
        "total_pares": total_pares,
        "total_tardiness": total_tard,
        "wall_time_s": round(solver.WallTime(), 2),
    }

    return schedule, summary


# ---------------------------------------------------------------------------
# Daily greedy scheduler — solo restricciones fisicas
# ---------------------------------------------------------------------------

def _greedy_daily(models_day, time_blocks, resource_cap, all_robots_list):
    """
    Greedy block-by-block scheduler usando solo capacidad de maquinas.
    Sin HC limits, sin operator skills.

    Args:
        models_day: list of model dicts with operations and pares_dia
        time_blocks: list of {id, label, minutes}
        resource_cap: {MESA: N, PLANA: N, POSTE: N, ...}
        all_robots_list: list of robot names (for tracking exclusivity)

    Returns:
        {schedule: [...], summary: {...}}
    """
    productive_blocks = [b for b in time_blocks if b["minutes"] > 0]
    num_blocks = len(productive_blocks)

    # Build operation list with cascade ordering
    ops = []
    for model in models_day:
        codigo = model["codigo"]
        pares_dia = model.get("pares_dia", 0)
        if pares_dia <= 0:
            continue
        for op in sorted(model.get("operations", []), key=lambda o: o["fraccion"]):
            ops.append({
                "modelo": codigo,
                "fraccion": op["fraccion"],
                "operacion": op.get("operacion", ""),
                "recurso": op.get("recurso", "MESA"),
                "rate": op.get("rate", 60),
                "robots": op.get("robots", []),
                "etapa": op.get("etapa", ""),
                "input_o_proceso": op.get("input_o_proceso", ""),
                "pares_target": pares_dia,
                "cum_produced": 0,
                "block_pares": [0] * num_blocks,
            })

    # Track resource usage per block
    robot_used = {}  # (robot_name, block_idx) → True
    resource_used = defaultdict(int)  # (res_type, block_idx) → count

    # Group ops by model for cascade checking
    model_ops = defaultdict(list)
    for op in ops:
        model_ops[op["modelo"]].append(op)

    # Greedy: iterate blocks, fill each to capacity
    for b_idx, block in enumerate(productive_blocks):
        block_min = block["minutes"]

        for op in ops:
            if op["cum_produced"] >= op["pares_target"]:
                continue

            # Cascade: can't produce more than previous fraction
            modelo = op["modelo"]
            fracc = op["fraccion"]
            prev_ops = [o for o in model_ops[modelo] if o["fraccion"] < fracc]
            if prev_ops:
                max_from_cascade = min(o["cum_produced"] for o in prev_ops
                                       if o["fraccion"] == max(p["fraccion"] for p in prev_ops
                                                               if p["fraccion"] < fracc))
                available = max_from_cascade - op["cum_produced"]
                if available <= 0:
                    continue
            else:
                available = op["pares_target"] - op["cum_produced"]

            remaining = op["pares_target"] - op["cum_produced"]
            can_produce = min(remaining, available)

            recurso = op["recurso"]
            robots = op["robots"]

            if robots:
                # Robot operation: find a free robot
                assigned_robot = None
                for rname in robots:
                    if not robot_used.get((rname, b_idx)):
                        assigned_robot = rname
                        break
                if not assigned_robot:
                    continue  # all robots busy

                # 1 robot, 1 operator equivalent, rate pares per hour
                max_rate = int(op["rate"] * block_min / 60)
                produced = min(can_produce, max_rate)
                if produced > 0:
                    robot_used[(assigned_robot, b_idx)] = True
                    op["block_pares"][b_idx] = produced
                    op["cum_produced"] += produced
            else:
                # Manual operation: use up to machine_count concurrent instances
                res_parts = [r.strip() for r in recurso.split(",")]
                # Find min available machines across all required resource types
                max_instances = 999
                for rp in res_parts:
                    cap = resource_cap.get(rp, 10)
                    used = resource_used[(rp, b_idx)]
                    max_instances = min(max_instances, cap - used)

                if max_instances <= 0:
                    continue

                # Each instance produces rate pares/hour
                rate_per_block = int(op["rate"] * block_min / 60)
                max_from_machines = rate_per_block * max_instances
                produced = min(can_produce, max_from_machines)
                instances_needed = max(1, (produced + rate_per_block - 1) // rate_per_block)
                instances_needed = min(instances_needed, max_instances)
                produced = min(produced, rate_per_block * instances_needed)

                if produced > 0:
                    for rp in res_parts:
                        resource_used[(rp, b_idx)] += instances_needed
                    op["block_pares"][b_idx] = produced
                    op["cum_produced"] += produced

    # Build schedule output (same format as optimizer_v2)
    schedule = []
    for op in ops:
        total = sum(op["block_pares"])
        if total == 0:
            continue
        entry = {
            "modelo": op["modelo"],
            "fraccion": op["fraccion"],
            "operacion": op["operacion"],
            "recurso": op["recurso"],
            "rate": op["rate"],
            "hc": 1,
            "etapa": op.get("etapa", ""),
            "input_o_proceso": op.get("input_o_proceso", ""),
            "blocks": op["block_pares"],
            "total": total,
            "robot": "",
            "robot_per_block": [],
            "operario": "CAPACIDAD",
        }
        schedule.append(entry)

    total_pares = sum(e["total"] for e in schedule)
    total_target = sum(m.get("pares_dia", 0) for m in models_day)
    tardiness = max(0, total_target - total_pares)

    summary = {
        "status": "FEASIBLE" if total_pares > 0 else "NO_PRODUCTION",
        "total_pares": total_pares,
        "total_tardiness": tardiness,
        "plantilla": 0,
    }

    return {"schedule": schedule, "summary": summary}


# ---------------------------------------------------------------------------
# Entry point: plan_capacity
# ---------------------------------------------------------------------------

def plan_capacity(models, params, compiled=None):
    """
    Pipeline completo de capacidad instalada.

    Returns:
        (weekly_schedule, weekly_summary, daily_results)
    """
    # 1. Weekly distribution
    weekly_schedule, weekly_summary = _capacity_weekly(models, params, compiled)

    if not weekly_schedule:
        return weekly_schedule, weekly_summary, {}

    # 2. Daily greedy for each day
    time_blocks = params.get("time_blocks", [])
    resource_cap = params.get("resource_capacity", {})
    days = params.get("days", [])

    # Build model lookup
    model_lookup = {m["codigo"]: m for m in models}

    # Group weekly schedule by day
    day_models = defaultdict(list)
    for entry in weekly_schedule:
        dia = entry["Dia"]
        codigo = entry["Modelo"]
        pares = entry["Pares"]
        if codigo in model_lookup:
            m = {**model_lookup[codigo], "pares_dia": pares}
            day_models[dia].append(m)

    # Get all robot names
    all_robots = set()
    for m in models:
        for op in m.get("operations", []):
            for r in op.get("robots", []):
                all_robots.add(r)

    # Schedule each day
    daily_results = {}
    for day_cfg in days:
        day_name = day_cfg["name"]
        models_today = day_models.get(day_name, [])
        if not models_today:
            daily_results[day_name] = {
                "status": "NO_PRODUCTION",
                "total_pares": 0,
                "total_tardiness": 0,
                "plantilla": 0,
                "schedule": [],
            }
            continue

        result = _greedy_daily(models_today, time_blocks, resource_cap, list(all_robots))
        daily_results[day_name] = {
            "status": result["summary"]["status"],
            "total_pares": result["summary"]["total_pares"],
            "total_tardiness": result["summary"]["total_tardiness"],
            "plantilla": 0,
            "schedule": result["schedule"],
        }

    # Update weekly summary with daily totals
    daily_total = sum(d.get("total_pares", 0) for d in daily_results.values())
    daily_tardiness = sum(d.get("total_tardiness", 0) for d in daily_results.values())
    weekly_summary["daily_total_pares"] = daily_total
    weekly_summary["daily_total_tardiness"] = daily_tardiness

    return weekly_schedule, weekly_summary, daily_results
