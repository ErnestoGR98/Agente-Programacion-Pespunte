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
W_SPAN = 20_000         # por dia de dispersion de un modelo (consolidar en dias consecutivos)
W_CHANGEOVER = 10_000   # por cambio de modelo (forzar lotes grandes, menos modelos por dia)
W_ODD_LOT = 5_000       # por lote no multiplo de 100 (preferir centenas, permitir 50s si es necesario)
W_SATURDAY = 500        # por par producido en sabado (ultimo recurso, solo si no cabe L-V)
W_OVERTIME = 10          # por segundo de overtime (usa horas extra solo si es necesario)
W_BALANCE = 1           # por unidad de desbalance entre dias
W_EARLY = 5             # por par * indice_dia (desempata en favor de dias tempranos)


def optimize(models: list, params: dict, compiled=None) -> tuple:
    """
    Construye y resuelve el modelo CP-SAT.

    Args:
        models: lista de dicts con datos de modelos (del match sabana+catalogo)
        params: dict con configuracion de dias, plantilla, etc.
        compiled: CompiledConstraints (opcional) - restricciones pre-procesadas

    Returns:
        (schedule, summary)
    """
    solver_model = cp_model.CpModel()

    days = params["days"]
    num_days = len(days)
    num_models = len(models)
    min_lot = params.get("min_lot_size", 100)
    step = params.get("lot_step", 50)
    lead_time_maquila = params.get("lead_time_maquila", 0)

    # Detectar modelos con operaciones MAQUILA y calcular sec_per_pair ajustado
    # MAQUILA es trabajo externo: no consume capacidad interna
    maquila_models = set()
    adjusted_sec = {}  # m -> sec_per_pair sin MAQUILA
    for m, model in enumerate(models):
        maquila_sec = 0
        for op in model.get("operations", []):
            if op.get("recurso") == "MAQUILA":
                maquila_sec += op.get("sec_per_pair", 0)
        if maquila_sec > 0:
            maquila_models.add(m)
            adjusted_sec[m] = max(1, model["total_sec_per_pair"] - maquila_sec)
        else:
            adjusted_sec[m] = model["total_sec_per_pair"]

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

    # Variables de consolidacion: span = ultimo_dia - primer_dia de produccion
    # Un span bajo = modelo concentrado en dias consecutivos -> ensamble tiene buffer
    first_day = {}
    last_day = {}
    span = {}
    for m in range(num_models):
        first_day[m] = solver_model.NewIntVar(0, num_days - 1, f"fd_{m}")
        last_day[m] = solver_model.NewIntVar(0, num_days - 1, f"ld_{m}")
        span[m] = solver_model.NewIntVar(0, num_days - 1, f"sp_{m}")
        for d in range(num_days):
            # Si se produce en dia d, primer dia no puede ser despues de d
            solver_model.Add(first_day[m] <= d).OnlyEnforceIf(y[m, d])
            # Si se produce en dia d, ultimo dia no puede ser antes de d
            solver_model.Add(last_day[m] >= d).OnlyEnforceIf(y[m, d])
        # span >= last - first (minimizacion lo empuja al valor exacto)
        solver_model.Add(span[m] >= last_day[m] - first_day[m])

    # MAQUILA: modelos con operaciones externas necesitan span minimo = lead_time
    # Esto garantiza un hueco de N dias entre produccion pre-MAQUILA y post-MAQUILA
    if lead_time_maquila > 0 and maquila_models:
        for m in maquila_models:
            solver_model.Add(span[m] >= lead_time_maquila)

    # --- Restricciones ---

    # 1. Completar volumen (o registrar tardiness)
    for m, model in enumerate(models):
        total_produced = sum(x[m, d] for d in range(num_days))
        solver_model.Add(total_produced + tardiness[m] == model["total_producir"])

    # 2. Lote minimo: si se produce, al menos min_lot pares (redondeado a multiplo de step)
    for m, model in enumerate(models):
        # Override de lote minimo por modelo (LOTE_MINIMO_CUSTOM)
        modelo_num = model.get("modelo_num", "")
        model_min = min_lot
        if compiled and modelo_num in compiled.lot_min_overrides:
            model_min = compiled.lot_min_overrides[modelo_num]
        effective_min = min(model_min, model["total_producir"])
        effective_min = (effective_min // step) * step  # redondear al multiplo de step
        for d in range(num_days):
            # x[m,d] <= total_producir * y[m,d]  (si y=0, x=0)
            solver_model.Add(x[m, d] <= model["total_producir"] * y[m, d])
            # x[m,d] >= effective_min * y[m,d]  (si y=1, x >= minimo)
            solver_model.Add(x[m, d] >= effective_min * y[m, d])

    # 2b. Restricciones dinamicas: day availability, frozen days, secuencias
    if compiled:
        _apply_compiled_constraints(solver_model, x, y, models, days, compiled)

    # 3. Capacidad por dia con overtime flexible
    #    Tier 1 (regular): plantilla * minutes * 60 (sin costo extra)
    #    Tier 2 (overtime): plantilla_ot * minutes_ot * 60 (penalizado)
    #    day_load <= regular_cap + overtime_cap (hard limit)
    #    overtime_used[d] >= day_load - regular_cap (soft, penalizado)
    day_loads = {}
    overtime_used = {}
    regular_caps = {}
    overtime_caps = {}
    # Factor de eficiencia: contiguidad y comida reducen capacidad real ~10%.
    # El diario ahora usa soft constraints, asi que no necesitamos ser muy conservadores.
    EFF = 0.90
    for d in range(num_days):
        day_cfg = days[d]
        regular_cap = int(day_cfg["plantilla"] * day_cfg["minutes"] * 60 * EFF)
        ot_minutes = day_cfg.get("minutes_ot", 0)
        ot_plantilla = day_cfg.get("plantilla_ot", day_cfg["plantilla"])
        overtime_cap = int(ot_plantilla * ot_minutes * 60 * EFF)

        regular_caps[d] = regular_cap
        overtime_caps[d] = overtime_cap

        load_terms = []
        for m, model in enumerate(models):
            sec_per_pair = adjusted_sec[m]
            load_terms.append(x[m, d] * sec_per_pair)

        day_load = sum(load_terms)
        day_loads[d] = day_load

        # Hard limit: no exceder regular + overtime (con factor eficiencia)
        solver_model.Add(day_load <= regular_cap + overtime_cap)

        # Overtime usado (se minimiza via penalizacion)
        overtime_used[d] = solver_model.NewIntVar(0, overtime_cap, f"ot_{d}")
        solver_model.Add(overtime_used[d] >= day_load - regular_cap)

    # 3b. Capacidad por tipo de recurso por dia
    #     El diario enforza limites por recurso (MESA, PLANA, ROBOT, etc).
    #     Sin esta restriccion el semanal sobrecarga recursos especificos.
    resource_cap = params.get("resource_capacity", {})
    if resource_cap:
        # Pre-computar carga por recurso para cada modelo (excluir MAQUILA)
        model_resource_load = []
        for model in models:
            rload = {}
            for op in model.get("operations", []):
                r = op.get("recurso", "GENERAL") or "GENERAL"
                if r == "MAQUILA":
                    continue  # MAQUILA es trabajo externo
                rload[r] = rload.get(r, 0) + op["sec_per_pair"]
            model_resource_load.append(rload)

        for d in range(num_days):
            day_minutes = days[d]["minutes"] + days[d].get("minutes_ot", 0)
            for res_type, cap in resource_cap.items():
                terms = []
                for m in range(num_models):
                    load_sec = model_resource_load[m].get(res_type, 0)
                    if load_sec > 0:
                        terms.append(x[m, d] * load_sec)
                if terms:
                    solver_model.Add(
                        sum(terms) <= cap * day_minutes * 60
                    )

    # 4. Throughput maximo por modelo/dia: la operacion mas lenta (cuello de botella)
    #    limita cuantos pares pueden completarse en un dia, independientemente de
    #    la capacidad total. Sin esto el solver asigna mas pares de los que el
    #    programa diario puede realmente producir.
    for m, model in enumerate(models):
        ops = [op for op in model.get("operations", []) if op.get("recurso") != "MAQUILA"]
        if ops:
            bottleneck_rate = min(op["rate"] for op in ops if op.get("rate", 0) > 0)
        else:
            # Fallback: estimar rate promedio desde total_sec_per_pair y num_ops
            n_ops = model.get("num_ops", 1)
            avg_sec = model["total_sec_per_pair"] / max(n_ops, 1)
            bottleneck_rate = 3600 / avg_sec if avg_sec > 0 else 100

        for d in range(num_days):
            day_minutes = days[d]["minutes"]
            ot_minutes = days[d].get("minutes_ot", 0)
            total_minutes = day_minutes + ot_minutes
            # Max pares = bottleneck_rate * horas totales * factor contiguidad
            # Factor 0.80: el diario enforza contiguidad (una vez detenida, no reinicia),
            # por lo que un modelo tipicamente usa ~80% de los bloques disponibles.
            max_throughput = int(bottleneck_rate * total_minutes / 60 * 0.80)
            max_throughput = (max_throughput // step) * step
            max_throughput = min(max_throughput, model["total_producir"])
            if max_throughput > 0:
                solver_model.Add(x[m, d] <= max_throughput)

    # 5. Balanceo: rastrear carga maxima y minima entre dias normales
    normal_day_indices = [d for d in range(num_days) if not days[d]["is_saturday"]]
    for d in normal_day_indices:
        solver_model.Add(max_load >= day_loads[d])
        solver_model.Add(min_load <= day_loads[d])

    # --- Funcion Objetivo ---

    obj_terms = []

    # Minimizar pares no completados (maxima prioridad, con peso por modelo)
    for m in range(num_models):
        weight = W_TARDINESS
        if compiled:
            modelo_num = models[m].get("modelo_num", "")
            multiplier = compiled.tardiness_weights.get(modelo_num, 1.0)
            weight = int(W_TARDINESS * multiplier)
        obj_terms.append(weight * tardiness[m])

    # Penalizar produccion en sabado
    saturday_indices = [d for d in range(num_days) if days[d]["is_saturday"]]
    for d in saturday_indices:
        for m in range(num_models):
            obj_terms.append(W_SATURDAY * x[m, d] * adjusted_sec[m])

    # Penalizar dispersion de modelos (consolidar en dias consecutivos)
    # Pespunte alimenta ensamble: modelos desperdigados = ensamble sin buffer
    for m in range(num_models):
        obj_terms.append(W_SPAN * span[m])

    # Penalizar cambios de modelo (menos modelos distintos por dia = mejor)
    for d in range(num_days):
        for m in range(num_models):
            obj_terms.append(W_CHANGEOVER * y[m, d])

    # Penalizar overtime (horas extra solo cuando se necesitan)
    for d in range(num_days):
        obj_terms.append(W_OVERTIME * overtime_used[d])

    # Hard constraint: limitar total de operaciones concurrentes por dia.
    # El diario enforza plantilla * block_sec por bloque. Con contiguidad,
    # las operaciones se solapan parcialmente. Factor 3 permite phasing:
    # con plantilla=5, max 15 ops → ~3 modelos de 5 ops cada uno.
    for d in range(num_days):
        total_ops_day = []
        for m in range(num_models):
            n_ops = models[m].get("num_ops", 1)
            total_ops_day.append(y[m, d] * n_ops)
        plantilla_d = days[d]["plantilla"]
        max_ops = plantilla_d * 3
        solver_model.Add(sum(total_ops_day) <= max_ops)

    # Penalizar lotes no multiplo de 100 (preferir centenas cerradas)
    for d in range(num_days):
        for m in range(num_models):
            obj_terms.append(W_ODD_LOT * is_odd[m, d])

    # Minimizar desbalance (diferencia max-min de carga en dias normales)
    obj_terms.append(W_BALANCE * (max_load - min_load))

    # Preferir produccion en dias tempranos (desempate)
    # Lun=5, Mar=10, Mie=15, Jue=20, Vie=25: insignificante vs W_TARDINESS(100k)
    for d in range(num_days):
        if not days[d]["is_saturday"]:
            for m in range(num_models):
                obj_terms.append(W_EARLY * x[m, d] * (d + 1))

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
    summary = _build_summary(solver, x, y, tardiness, span, day_loads, overtime_used,
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


def _build_summary(solver, x, y, tardiness, span, day_loads, overtime_used,
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

        # Peak HC: total operaciones concurrentes si todos los modelos activos se traslapan
        peak_hc = sum(
            models[m].get("num_ops", 1) for m in range(num_models)
            if solver.Value(y[m, d]) > 0
        )

        days_summary.append({
            "dia": day_cfg["name"],
            "pares": total_pares,
            "hc_necesario": round(hc_needed, 1),
            "hc_disponible": day_cfg["plantilla"],
            "peak_hc": peak_hc,
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
        sp = solver.Value(span[m]) if m in span else 0
        # Dias activos para este modelo
        active_days = [
            days[d]["name"] for d in range(num_days)
            if solver.Value(x[m, d]) > 0
        ]
        models_summary.append({
            "codigo": model["codigo"],
            "fabrica": model["fabrica"],
            "volumen": model["total_producir"],
            "producido": produced,
            "tardiness": tard,
            "pct_completado": round(produced / model["total_producir"] * 100, 1),
            "span_dias": sp,
            "dias_produccion": active_days,
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


def _apply_compiled_constraints(solver_model, x, y, models, days, compiled):
    """Aplica restricciones dinamicas del CompiledConstraints al modelo CP-SAT."""
    num_days = len(days)

    for m, model in enumerate(models):
        modelo_num = model.get("modelo_num", "")

        # Day availability: forzar x[m,d]=0 para dias no permitidos
        if modelo_num in compiled.day_availability:
            allowed = compiled.day_availability[modelo_num]
            for d in range(num_days):
                if d not in allowed:
                    solver_model.Add(x[m, d] == 0)

        # Frozen days (avance): forzar x[m,d]=0 para dias ya producidos
        if modelo_num in compiled.avance:
            for day_name, pares_done in compiled.avance[modelo_num].items():
                for d in range(num_days):
                    if days[d]["name"] == day_name and pares_done > 0:
                        solver_model.Add(x[m, d] == 0)

    # Secuencias: modelo A debe completarse antes de que B produzca
    for antes_idx, despues_idx in compiled.sequences:
        total_antes = models[antes_idx]["total_producir"]
        if total_antes <= 0:
            continue
        for d in range(num_days):
            # Si B produce en dia d, A debe tener todo acumulado hasta dia d
            cum_antes = sum(x[antes_idx, dd] for dd in range(d + 1))
            solver_model.Add(cum_antes >= total_antes * y[despues_idx, d])

    # Agrupacion: modelos A y B deben producirse en los mismos dias
    for idx_a, idx_b in compiled.model_groups:
        for d in range(num_days):
            solver_model.Add(y[idx_a, d] == y[idx_b, d])
