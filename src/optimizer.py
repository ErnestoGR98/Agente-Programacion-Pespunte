"""
optimizer.py - Modelo de optimizacion CP-SAT para programacion de pespunte.

Modelo basado en headcount (personas necesarias por dia), no operadores individuales.
Decide cuantos pares de cada modelo producir cada dia, respetando:
  - Capacidad de plantilla (personas * minutos disponibles)
  - Completar todos los volumenes de la semana
  - Minimizar uso de sabado (horas extra)
  - Balancear carga entre dias

Variables de decision:
  x[modelo, dia] = pares a producir (entero)

El rate (pares/hora) del catalogo determina cuanto trabajo implica cada par.
"""

from ortools.sat.python import cp_model

# Pesos del objetivo multi-criterio
W_TARDINESS = 100_000   # por par no completado (maxima prioridad)
W_SATURDAY = 50         # por par producido en sabado (penalizar horas extra)
W_BALANCE = 1           # por unidad de desbalance entre dias
W_CHANGEOVER = 10_000   # por cambio de modelo (forzar lotes grandes, menos modelos por dia)
W_ODD_LOT = 5_000       # por lote no multiplo de 100 (preferir centenas, permitir 50s si es necesario)
W_OVERTIME = 10          # por segundo de overtime (usa horas extra solo si es necesario)


def optimize(models: list, params: dict) -> tuple:
    """
    Construye y resuelve el modelo CP-SAT.

    Args:
        models: lista de dicts con datos de modelos (del match sabana+catalogo)
        params: dict con configuracion de dias, plantilla, etc.

    Returns:
        (schedule, summary)
    """
    solver_model = cp_model.CpModel()

    days = params["days"]
    num_days = len(days)
    num_models = len(models)
    min_lot = params.get("min_lot_size", 100)
    step = params.get("lot_step", 50)

    # --- Variables de decision ---

    # x[m, d] = pares de modelo m a producir en dia d (forzado a multiplos de step)
    # z[m, d] = numero de lotes de 'step' pares (variable auxiliar entera)
    x = {}
    z = {}
    for m, model in enumerate(models):
        max_batches = model["total_producir"] // step
        for d in range(num_days):
            x[m, d] = solver_model.NewIntVar(
                0, model["total_producir"], f"x_{m}_{d}"
            )
            z[m, d] = solver_model.NewIntVar(0, max_batches, f"z_{m}_{d}")
            solver_model.Add(x[m, d] == step * z[m, d])

    # y[m, d] = 1 si modelo m se produce en dia d (indicador binario)
    y = {}
    for m, model in enumerate(models):
        for d in range(num_days):
            y[m, d] = solver_model.NewBoolVar(f"y_{m}_{d}")

    # is_odd[m, d] = 1 si z es impar (lote no multiplo de 100, ej: 50, 150, 250...)
    # z[m,d] = 2*w[m,d] + is_odd[m,d] donde w es entero
    is_odd = {}
    w = {}
    for m, model in enumerate(models):
        max_batches = model["total_producir"] // step
        for d in range(num_days):
            w[m, d] = solver_model.NewIntVar(0, max_batches // 2, f"w_{m}_{d}")
            is_odd[m, d] = solver_model.NewBoolVar(f"odd_{m}_{d}")
            solver_model.Add(z[m, d] == 2 * w[m, d] + is_odd[m, d])

    # tardiness[m] = pares no completados del modelo m
    tardiness = {}
    for m, model in enumerate(models):
        tardiness[m] = solver_model.NewIntVar(
            0, model["total_producir"], f"tard_{m}"
        )

    # Variables auxiliares para balanceo: carga por dia en segundos
    max_load = solver_model.NewIntVar(0, 10_000_000, "max_load")
    min_load = solver_model.NewIntVar(0, 10_000_000, "min_load")

    # --- Restricciones ---

    # 1. Completar volumen (o registrar tardiness)
    for m, model in enumerate(models):
        total_produced = sum(x[m, d] for d in range(num_days))
        solver_model.Add(total_produced + tardiness[m] == model["total_producir"])

    # 2. Lote minimo: si se produce, al menos min_lot pares (redondeado a multiplo de step)
    for m, model in enumerate(models):
        effective_min = min(min_lot, model["total_producir"])
        effective_min = (effective_min // step) * step  # redondear al multiplo de step
        for d in range(num_days):
            # x[m,d] <= total_producir * y[m,d]  (si y=0, x=0)
            solver_model.Add(x[m, d] <= model["total_producir"] * y[m, d])
            # x[m,d] >= effective_min * y[m,d]  (si y=1, x >= minimo)
            solver_model.Add(x[m, d] >= effective_min * y[m, d])

    # 3. Capacidad por dia con overtime flexible
    #    Tier 1 (regular): plantilla * minutes * 60 (sin costo extra)
    #    Tier 2 (overtime): plantilla_ot * minutes_ot * 60 (penalizado)
    #    day_load <= regular_cap + overtime_cap (hard limit)
    #    overtime_used[d] >= day_load - regular_cap (soft, penalizado)
    day_loads = {}
    overtime_used = {}
    regular_caps = {}
    overtime_caps = {}
    for d in range(num_days):
        day_cfg = days[d]
        regular_cap = day_cfg["plantilla"] * day_cfg["minutes"] * 60
        ot_minutes = day_cfg.get("minutes_ot", 0)
        ot_plantilla = day_cfg.get("plantilla_ot", day_cfg["plantilla"])
        overtime_cap = ot_plantilla * ot_minutes * 60

        regular_caps[d] = regular_cap
        overtime_caps[d] = overtime_cap

        load_terms = []
        for m, model in enumerate(models):
            sec_per_pair = model["total_sec_per_pair"]
            load_terms.append(x[m, d] * sec_per_pair)

        day_load = sum(load_terms)
        day_loads[d] = day_load

        # Hard limit: no exceder regular + overtime
        solver_model.Add(day_load <= regular_cap + overtime_cap)

        # Overtime usado (se minimiza via penalizacion)
        overtime_used[d] = solver_model.NewIntVar(0, overtime_cap, f"ot_{d}")
        solver_model.Add(overtime_used[d] >= day_load - regular_cap)

    # 4. Balanceo: rastrear carga maxima y minima entre dias normales
    normal_day_indices = [d for d in range(num_days) if not days[d]["is_saturday"]]
    for d in normal_day_indices:
        solver_model.Add(max_load >= day_loads[d])
        solver_model.Add(min_load <= day_loads[d])

    # --- Funcion Objetivo ---

    obj_terms = []

    # Minimizar pares no completados (maxima prioridad)
    for m in range(num_models):
        obj_terms.append(W_TARDINESS * tardiness[m])

    # Penalizar produccion en sabado
    saturday_indices = [d for d in range(num_days) if days[d]["is_saturday"]]
    for d in saturday_indices:
        for m in range(num_models):
            sec_per_pair = models[m]["total_sec_per_pair"]
            obj_terms.append(W_SATURDAY * x[m, d] * sec_per_pair)

    # Penalizar cambios de modelo (menos modelos distintos por dia = mejor)
    for d in range(num_days):
        for m in range(num_models):
            obj_terms.append(W_CHANGEOVER * y[m, d])

    # Penalizar overtime (horas extra solo cuando se necesitan)
    for d in range(num_days):
        obj_terms.append(W_OVERTIME * overtime_used[d])

    # Penalizar lotes no multiplo de 100 (preferir centenas cerradas)
    for d in range(num_days):
        for m in range(num_models):
            obj_terms.append(W_ODD_LOT * is_odd[m, d])

    # Minimizar desbalance (diferencia max-min de carga en dias normales)
    obj_terms.append(W_BALANCE * (max_load - min_load))

    solver_model.Minimize(sum(obj_terms))

    # --- Resolver ---

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 60
    solver.parameters.num_workers = 8
    status = solver.Solve(solver_model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise RuntimeError(
            f"No se encontro solucion factible. Estado: {solver.StatusName(status)}"
        )

    # --- Extraer solucion ---

    schedule = _extract_schedule(solver, x, models, days)
    summary = _build_summary(solver, x, tardiness, day_loads, overtime_used,
                             regular_caps, overtime_caps, models, days, status)

    return schedule, summary


def _extract_schedule(solver, x, models, days):
    """Extrae asignaciones de pares por modelo y dia."""
    num_days = len(days)
    schedule = []

    for m, model in enumerate(models):
        for d in range(num_days):
            pares = solver.Value(x[m, d])
            if pares <= 0:
                continue

            day_cfg = days[d]
            sec_total = pares * model["total_sec_per_pair"]
            hours_work = sec_total / 3600.0
            # Headcount fraccionario: horas de trabajo / horas del dia
            hours_day = day_cfg["minutes"] / 60.0
            headcount = hours_work / hours_day

            schedule.append({
                "Dia": day_cfg["name"],
                "Fabrica": model["fabrica"],
                "Modelo": model["codigo"],
                "Suela": model["suela"],
                "Pares": pares,
                "HC_Necesario": round(headcount, 1),
                "Horas_Trabajo": round(hours_work, 1),
                "Num_Operaciones": model["num_ops"],
            })

    # Ordenar por dia, fabrica, modelo
    day_order = {days[d]["name"]: d for d in range(len(days))}
    schedule.sort(key=lambda r: (day_order.get(r["Dia"], 99), r["Fabrica"], r["Modelo"]))

    return schedule


def _build_summary(solver, x, tardiness, day_loads, overtime_used,
                    regular_caps, overtime_caps, models, days, status):
    """Construye resumen de metricas."""
    num_days = len(days)
    num_models = len(models)

    # Metricas por dia
    days_summary = []
    for d in range(num_days):
        day_cfg = days[d]
        total_pares = sum(solver.Value(x[m, d]) for m in range(num_models))
        load_sec = solver.Value(day_loads[d])
        regular_cap = regular_caps[d]
        overtime_cap = overtime_caps[d]
        total_cap = regular_cap + overtime_cap
        utilization = (load_sec / regular_cap * 100) if regular_cap > 0 else 0

        ot_sec = solver.Value(overtime_used[d])
        ot_hours = ot_sec / 3600.0

        # Headcount necesario (basado en horas regulares del dia)
        hours_work = load_sec / 3600.0
        hours_day = day_cfg["minutes"] / 60.0
        hc_needed = hours_work / hours_day

        days_summary.append({
            "dia": day_cfg["name"],
            "pares": total_pares,
            "hc_necesario": round(hc_needed, 1),
            "hc_disponible": day_cfg["plantilla"],
            "diferencia": round(day_cfg["plantilla"] - hc_needed, 1),
            "utilizacion_pct": round(utilization, 1),
            "overtime_hrs": round(ot_hours, 1),
            "is_saturday": day_cfg["is_saturday"],
        })

    # Metricas por modelo
    models_summary = []
    for m, model in enumerate(models):
        produced = sum(solver.Value(x[m, d]) for d in range(num_days))
        tard = solver.Value(tardiness[m])
        models_summary.append({
            "codigo": model["codigo"],
            "fabrica": model["fabrica"],
            "volumen": model["total_producir"],
            "producido": produced,
            "tardiness": tard,
            "pct_completado": round(produced / model["total_producir"] * 100, 1),
        })

    return {
        "status": solver.StatusName(status),
        "objective_value": solver.ObjectiveValue(),
        "wall_time_s": round(solver.WallTime(), 2),
        "days": days_summary,
        "models": models_summary,
        "total_pares": sum(ds["pares"] for ds in days_summary),
        "total_tardiness": sum(ms["tardiness"] for ms in models_summary),
    }
