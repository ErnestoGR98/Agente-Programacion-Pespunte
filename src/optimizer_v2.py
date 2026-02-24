"""
optimizer_v2.py - Scheduler por operacion y bloque horario (Iteracion 2).

Toma la salida del optimizador semanal (pares por modelo por dia) y genera
un programa detallado: que operacion se ejecuta en que bloque horario,
respetando precedencia entre fracciones y capacidad de recursos.

Variables de decision:
  x[m, op, b] = pares de modelo m, operacion op, en bloque horario b
  y[m, op, r, b] = pares en robot r (solo para operaciones con robots asignados)

Restricciones:
  1. Completar pares asignados al dia para cada modelo
  2. Capacidad de recurso por bloque (MESA, PLANA, etc.)
  3. Headcount total por bloque <= plantilla
  4. Capacidad de robot individual por bloque (cada robot fisico = 1 maquina)
  5. Rate limit: 1 persona por robot, 1 persona por operacion manual
  6. Contiguidad: una vez detenida, una operacion no puede reiniciar

Objetivo:
  tardiness(100k) > hc_overflow(50k) > uniformity(500) > balance(1 * peak_load_sec)
  Uniformidad: SUAVE - penalty por producir menos del rate (manual y robot)
  HC/Recurso: SUAVE - penalty por exceder plantilla o capacidad de recurso
  Balance: minimiza el pico de HC para distribuir trabajo en todos los bloques
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from ortools.sat.python import cp_model

# Pesos del objetivo
W_TARDINESS = 100_000     # por par no completado en el dia
W_UNIFORMITY = 500        # soft uniformity (por par de shortfall)
W_HC_OVERFLOW = 50_000    # por segundo de exceso sobre plantilla/recurso por bloque
W_BALANCE = 1             # minimizar pico de HC (spread work across all blocks)


class _EarlyStopCallback(cp_model.CpSolverSolutionCallback):
    """Detiene el solver despues de optimizar objetivos secundarios.

    Al encontrar 0 tardiness, sigue buscando al menos `grace_seconds`
    para mejorar uniformidad, early_start y otros objetivos suaves.
    Sin esto, la primera solucion sin tardiness gana aunque tenga
    huecos enormes en el programa.
    """

    GRACE_SECONDS = 5.0  # tiempo adicional tras 0-tardiness

    def __init__(self, tardiness_vars):
        super().__init__()
        self._tardiness_vars = tardiness_vars
        self._first_zero_time = None

    def on_solution_callback(self):
        total_tard = sum(self.Value(t) for t in self._tardiness_vars)
        if total_tard == 0:
            if self._first_zero_time is None:
                self._first_zero_time = self.WallTime()
            elif self.WallTime() - self._first_zero_time >= self.GRACE_SECONDS:
                self.StopSearch()


def _mark_bottleneck_ops(models_day):
    """Detecta operaciones cuello de botella y marca con hc_multiplier=2.

    Criterio: rate < mediana_del_modelo * 0.75  (solo ops manuales).
    Esto permite que el solver asigne 2x produccion por bloque y que
    operator_assignment ponga 2 operarios trabajando en simultaneo.
    """
    for model in models_day:
        ops = model.get("operations", [])
        if not ops:
            continue
        rates = [op["rate"] for op in ops if op["rate"] > 0]
        if not rates:
            continue
        sorted_rates = sorted(rates)
        median_rate = sorted_rates[len(sorted_rates) // 2]
        threshold = median_rate * 0.75

        for op in ops:
            is_robot = bool(op.get("robots", []))
            if not is_robot and op["rate"] < threshold:
                op["hc_multiplier"] = 2
            else:
                op["hc_multiplier"] = 1


def schedule_day(models_day: list, params: dict, compiled=None) -> dict:
    """
    Genera el programa horario para un dia.

    Args:
        models_day: lista de dicts, cada uno con:
            - codigo: str (nombre modelo)
            - fabrica: str
            - suela: str
            - pares_dia: int (pares asignados por optimizer_weekly)
            - operations: lista de dicts con fraccion, operacion, recurso, rate, sec_per_pair
        params: dict con time_blocks, resource_capacity, plantilla, etc.

    Returns:
        dict con:
            - schedule: lista de asignaciones (modelo, op, bloque, pares)
            - summary: metricas del dia
    """
    time_blocks = params["time_blocks"]
    resource_cap = params["resource_capacity"]
    plantilla = params["plantilla"]
    num_blocks = len(time_blocks)
    step = params.get("lot_step", 50)

    if not models_day:
        return {"schedule": [], "summary": _empty_summary(time_blocks)}

    # Detectar cuellos de botella (marca ops con hc_multiplier=2)
    _mark_bottleneck_ops(models_day)

    # Construir indices
    all_ops = []  # (m_idx, op_idx, model, op)
    for m_idx, model in enumerate(models_day):
        for op_idx, op in enumerate(model["operations"]):
            all_ops.append((m_idx, op_idx, model, op))

    solver_model = cp_model.CpModel()

    # --- Variables ---

    # x[m, op, b] = pares producidos
    x = {}
    for m_idx, model in enumerate(models_day):
        pares_dia = model["pares_dia"]
        max_per_block = pares_dia  # upper bound
        for op_idx, op in enumerate(model["operations"]):
            for b in range(num_blocks):
                x[m_idx, op_idx, b] = solver_model.NewIntVar(
                    0, max_per_block, f"x_{m_idx}_{op_idx}_{b}"
                )

    # active[m, op, b] = 1 si se producen pares
    active = {}
    for m_idx, model in enumerate(models_day):
        for op_idx in range(len(model["operations"])):
            for b in range(num_blocks):
                active[m_idx, op_idx, b] = solver_model.NewBoolVar(
                    f"act_{m_idx}_{op_idx}_{b}"
                )

    # y[m, op, r, b] = pares en robot r (solo para ops con robots asignados)
    y = {}
    robot_ops_idx = []  # lista de (m_idx, op_idx) que tienen robots
    for m_idx, model in enumerate(models_day):
        for op_idx, op in enumerate(model["operations"]):
            robots = op.get("robots", [])
            if not robots:
                continue
            robot_ops_idx.append((m_idx, op_idx))
            pares_dia = model["pares_dia"]
            for r in robots:
                for b in range(num_blocks):
                    y[m_idx, op_idx, r, b] = solver_model.NewIntVar(
                        0, pares_dia, f"y_{m_idx}_{op_idx}_{r}_{b}"
                    )

    # tardiness[m] = pares no completados del modelo
    tardiness = {}
    for m_idx, model in enumerate(models_day):
        tardiness[m_idx] = solver_model.NewIntVar(
            0, model["pares_dia"], f"tard_{m_idx}"
        )

    # --- Restricciones compiladas (block_availability + disabled_robots) ---
    day_name = params.get("day_name", "")

    # Block availability: retraso de material con hora especifica
    if compiled and day_name and compiled.block_availability:
        for m_idx, model in enumerate(models_day):
            modelo_code = model.get("codigo", "")
            key = (modelo_code, day_name)
            if key in compiled.block_availability:
                allowed_blocks = compiled.block_availability[key]
                for op_idx in range(len(model["operations"])):
                    for b in range(num_blocks):
                        if b not in allowed_blocks:
                            solver_model.Add(x[m_idx, op_idx, b] == 0)

    # Disabled robots: forzar y[m, op, robot, b] == 0 para robots no disponibles
    if compiled and day_name and compiled.disabled_robots:
        for robot_name, day_blocks in compiled.disabled_robots.items():
            if day_name in day_blocks:
                blocked_blocks = day_blocks[day_name]
                for m_idx, op_idx in robot_ops_idx:
                    op = models_day[m_idx]["operations"][op_idx]
                    if robot_name in op.get("robots", []):
                        for b in range(num_blocks):
                            if b in blocked_blocks:
                                key = (m_idx, op_idx, robot_name, b)
                                if key in y:
                                    solver_model.Add(y[key] == 0)

    # Precedencia entre operaciones: fracciones_origen deben llevar
    # buffer de ventaja acumulativa sobre cada fraccion en fracciones_destino.
    frac_to_op = {}
    if compiled and compiled.precedences:
        for m_idx, model in enumerate(models_day):
            for op_idx, op in enumerate(model["operations"]):
                frac_to_op[(m_idx, op["fraccion"])] = op_idx

        for (modelo_code, fracs_orig, fracs_dest, buffer) in compiled.precedences:
            target_m = None
            for m_idx, model in enumerate(models_day):
                code = model.get("codigo", "")
                if code == modelo_code or code.startswith(str(modelo_code)):
                    target_m = m_idx
                    break
            if target_m is None:
                continue

            # buffer=-1 means "todo": all origin pairs must finish before
            # any destination pair starts → use pares_dia as buffer
            effective_buffer = buffer
            if effective_buffer < 0:
                effective_buffer = models_day[target_m]["pares_dia"]

            # Map fraccion numbers to op_idx
            idx_orig = [frac_to_op[(target_m, f)]
                        for f in fracs_orig if (target_m, f) in frac_to_op]
            idx_dest = [frac_to_op[(target_m, f)]
                        for f in fracs_dest if (target_m, f) in frac_to_op]

            if not idx_orig or not idx_dest:
                continue

            for op_o in idx_orig:
                for op_d in idx_dest:
                    for b in range(num_blocks):
                        cum_orig = sum(x[target_m, op_o, bb] for bb in range(b + 1))
                        cum_dest = sum(x[target_m, op_d, bb] for bb in range(b + 1))
                        solver_model.Add(cum_orig >= effective_buffer + cum_dest)

    # --- Restricciones ---

    # 1. Completar pares del dia para cada operacion de cada modelo
    for m_idx, model in enumerate(models_day):
        pares_dia = model["pares_dia"]
        for op_idx in range(len(model["operations"])):
            total_op = sum(x[m_idx, op_idx, b] for b in range(num_blocks))
            # Todas las operaciones deben completar lo mismo (mismo par pasa por todas)
            solver_model.Add(total_op + tardiness[m_idx] == pares_dia)

    # 2. Linking x y active + limite por rate
    for m_idx, model in enumerate(models_day):
        pares_dia = model["pares_dia"]
        for op_idx, op in enumerate(model["operations"]):
            robots = op.get("robots", [])
            has_robots = len(robots) > 0
            for b in range(num_blocks):
                # Si active=0, x=0; si active=1, x>=1
                solver_model.Add(
                    x[m_idx, op_idx, b] <= pares_dia * active[m_idx, op_idx, b]
                )
                solver_model.Add(
                    x[m_idx, op_idx, b] >= active[m_idx, op_idx, b]
                )

                block_min = time_blocks[b]["minutes"]
                max_pares_1person = int(op["rate"] * block_min / 60)

                if has_robots:
                    # Para operaciones con robots: 1 robot a la vez por operacion
                    # (lista robots = compatibles/elegibles, NO paralelos)
                    if max_pares_1person < pares_dia:
                        solver_model.Add(x[m_idx, op_idx, b] <= max_pares_1person)
                    # Rate limit individual por robot
                    for r in robots:
                        if max_pares_1person < pares_dia:
                            solver_model.Add(y[m_idx, op_idx, r, b] <= max_pares_1person)
                else:
                    # Para operaciones manuales: hc_multiplier personas
                    hc_mult = op.get("hc_multiplier", 1)
                    max_pares_block = max_pares_1person * hc_mult
                    if max_pares_block < pares_dia:
                        solver_model.Add(x[m_idx, op_idx, b] <= max_pares_block)

    # 2b. Linking y con x para operaciones con robots
    #     sum_r y[m, op, r, b] = x[m, op, b]
    for m_idx, op_idx in robot_ops_idx:
        op = models_day[m_idx]["operations"][op_idx]
        robots = op["robots"]
        for b in range(num_blocks):
            solver_model.Add(
                sum(y[m_idx, op_idx, r, b] for r in robots) == x[m_idx, op_idx, b]
            )

    # 3. Capacidad de recurso por bloque (recursos NO-robot) - SOFT
    #    Permite exceder capacidad con penalty alto en vez de INFEASIBLE.
    hc_overflow_terms = []
    for b in range(num_blocks):
        block_minutes = time_blocks[b]["minutes"]
        block_sec = block_minutes * 60
        if block_sec == 0:
            continue

        # Agrupar carga por tipo de recurso (excluir ops con robots asignados)
        resource_loads = {}
        for m_idx, model in enumerate(models_day):
            for op_idx, op in enumerate(model["operations"]):
                robots = op.get("robots", [])
                if robots:
                    continue
                recurso = op["recurso"]
                if recurso not in resource_loads:
                    resource_loads[recurso] = []
                resource_loads[recurso].append(
                    x[m_idx, op_idx, b] * op["sec_per_pair"]
                )

        for recurso, loads in resource_loads.items():
            cap = resource_cap.get(recurso, resource_cap.get("GENERAL", 4))
            max_capacity_sec = cap * block_sec
            overflow = solver_model.NewIntVar(
                0, max_capacity_sec, f"rcap_{recurso}_{b}"
            )
            solver_model.Add(sum(loads) <= max_capacity_sec + overflow)
            hc_overflow_terms.append(overflow)

    # 4. Headcount total por bloque <= plantilla - SOFT
    #    Permite exceder plantilla con penalty alto en vez de INFEASIBLE.
    for b in range(num_blocks):
        block_sec = time_blocks[b]["minutes"] * 60
        if block_sec == 0:
            continue
        total_load = []
        for m_idx, model in enumerate(models_day):
            for op_idx, op in enumerate(model["operations"]):
                total_load.append(x[m_idx, op_idx, b] * op["sec_per_pair"])
        if total_load:
            max_hc_sec = plantilla * block_sec
            overflow = solver_model.NewIntVar(
                0, max_hc_sec, f"hcov_{b}"
            )
            solver_model.Add(sum(total_load) <= max_hc_sec + overflow)
            hc_overflow_terms.append(overflow)

    # 5. Capacidad de robot individual por bloque
    #    Cada robot fisico solo puede trabajar 1 fraccion a la vez
    #    Para robot r y bloque b: sum_{m,op} y[m,op,r,b] * sec_per_pair <= block_sec
    all_robots_in_day = set()
    for m_idx, op_idx in robot_ops_idx:
        op = models_day[m_idx]["operations"][op_idx]
        for r in op["robots"]:
            all_robots_in_day.add(r)

    for b in range(num_blocks):
        block_sec = time_blocks[b]["minutes"] * 60
        for robot in all_robots_in_day:
            robot_load = []
            for m_idx, op_idx in robot_ops_idx:
                op = models_day[m_idx]["operations"][op_idx]
                if robot in op["robots"]:
                    robot_load.append(
                        y[m_idx, op_idx, robot, b] * op["sec_per_pair"]
                    )
            if robot_load:
                solver_model.Add(sum(robot_load) <= block_sec)

    # Bloques productivos (excluir bloques con 0 minutos, e.g. COMIDA)
    real_blocks = [b for b in range(num_blocks) if time_blocks[b]["minutes"] > 0]

    # Forzar x=0 y active=0 en bloques no productivos (COMIDA)
    for b in range(num_blocks):
        if time_blocks[b]["minutes"] == 0:
            for m_idx, model in enumerate(models_day):
                for op_idx in range(len(model["operations"])):
                    solver_model.Add(x[m_idx, op_idx, b] == 0)
                    solver_model.Add(active[m_idx, op_idx, b] == 0)

    # 6. Contiguidad de operaciones (salta bloques no productivos):
    #    Una vez detenida, no puede reiniciar. COMIDA no rompe contiguidad.
    for m_idx, model in enumerate(models_day):
        for op_idx in range(len(model["operations"])):
            stopped = {}
            for rb_idx, b in enumerate(real_blocks):
                stopped[b] = solver_model.NewBoolVar(
                    f"stop_{m_idx}_{op_idx}_{b}"
                )
            solver_model.Add(stopped[real_blocks[0]] == 0)
            for rb_idx in range(1, len(real_blocks)):
                b = real_blocks[rb_idx]
                prev_b = real_blocks[rb_idx - 1]
                solver_model.Add(
                    stopped[b] >= active[m_idx, op_idx, prev_b]
                    - active[m_idx, op_idx, b]
                )
                solver_model.Add(stopped[b] >= stopped[prev_b])
                solver_model.Add(
                    active[m_idx, op_idx, b] + stopped[prev_b] <= 1
                )

    # 7. Uniformidad de produccion (salta COMIDA):
    #    SUAVE para todas las ops (manual y robot): penalty por shortfall.
    #    Hard constraint causaba INFEASIBLE con multiples modelos compitiendo por HC.
    uniformity_shortfall_terms = []
    for m_idx, model in enumerate(models_day):
        for op_idx, op in enumerate(model["operations"]):
            is_robot = bool(op.get("robots", []))
            for rb_idx in range(len(real_blocks) - 1):
                b = real_blocks[rb_idx]
                next_b = real_blocks[rb_idx + 1]
                block_min = time_blocks[b]["minutes"]
                hc_mult = op.get("hc_multiplier", 1) if not is_robot else 1
                target = int(op["rate"] * block_min / 60 * hc_mult)
                if target <= 0:
                    continue
                shortfall = solver_model.NewIntVar(
                    0, target, f"uf_{m_idx}_{op_idx}_{b}"
                )
                solver_model.Add(
                    x[m_idx, op_idx, b] + shortfall >= target
                ).OnlyEnforceIf([
                    active[m_idx, op_idx, b],
                    active[m_idx, op_idx, next_b]
                ])
                uniformity_shortfall_terms.append(shortfall)

    # --- Funcion Objetivo ---
    obj_terms = []

    # Minimizar tardiness
    for m_idx in range(len(models_day)):
        obj_terms.append(W_TARDINESS * tardiness[m_idx])

    # Soft uniformity para todas las ops (manual + robot)
    for sf in uniformity_shortfall_terms:
        obj_terms.append(W_UNIFORMITY * sf)

    # Penalty por exceder capacidad de recurso o plantilla por bloque
    for ov in hc_overflow_terms:
        obj_terms.append(W_HC_OVERFLOW * ov)

    # Balance: minimizar el pico de carga (HC) para distribuir trabajo
    # en todos los bloques del dia. Si peak es bajo, el trabajo se reparte.
    max_block_capacity = plantilla * max(tb["minutes"] for tb in time_blocks) * 60
    peak_load = solver_model.NewIntVar(0, max_block_capacity, "peak_load")
    for b in range(num_blocks):
        load_terms = []
        for m_idx, model in enumerate(models_day):
            for op_idx, op in enumerate(model["operations"]):
                load_terms.append(x[m_idx, op_idx, b] * op["sec_per_pair"])
        if load_terms:
            solver_model.Add(peak_load >= sum(load_terms))
    obj_terms.append(W_BALANCE * peak_load)

    solver_model.Minimize(sum(obj_terms))

    # --- Resolver ---
    solver = cp_model.CpSolver()

    # Timeout dinamico segun complejidad del dia
    total_pares = sum(m["pares_dia"] for m in models_day)
    total_ops = sum(len(m["operations"]) for m in models_day)
    # Base 20s + escala con pares y operaciones, tope 90s
    timeout = min(90, max(20, 10 + total_pares // 100 + total_ops))
    solver.parameters.max_time_in_seconds = timeout

    # Workers: reducir si se ejecuta en paralelo (evitar contention)
    num_workers = params.get("num_workers", 4)
    solver.parameters.num_workers = num_workers

    # Callback de parada temprana: si tardiness=0, dejar de buscar
    callback = _EarlyStopCallback(list(tardiness.values()))
    status = solver.Solve(solver_model, callback)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        print(f"  ADVERTENCIA: No se encontro solucion para el dia. Estado: {solver.StatusName(status)}")
        return {"schedule": [], "summary": _empty_summary(time_blocks)}

    # --- Extraer solucion ---
    schedule = _extract_day_schedule(solver, x, y, active, robot_ops_idx,
                                      models_day, time_blocks)
    summary = _build_day_summary(solver, x, tardiness, models_day, time_blocks,
                                  plantilla, resource_cap, status)

    return {"schedule": schedule, "summary": summary}


def schedule_week(weekly_schedule: list, matched_models: list, params: dict,
                   compiled=None) -> dict:
    """
    Genera programas horarios para todos los dias de la semana EN PARALELO.

    Cada dia se resuelve en un thread separado. CP-SAT libera el GIL durante
    la resolucion, por lo que ThreadPoolExecutor funciona bien.

    Args:
        weekly_schedule: salida de optimizer_weekly (lista de {Dia, Modelo, Pares, ...})
        matched_models: modelos con operaciones del catalogo
        params: parametros con days, time_blocks, resource_capacity

    Returns:
        dict {dia_name: {schedule, summary}}
    """
    days = params["days"]

    # Crear lookup de modelos por codigo
    model_lookup = {}
    for m in matched_models:
        model_lookup[m["codigo"]] = m

    # Agrupar schedule semanal por dia
    by_day = {}
    for entry in weekly_schedule:
        dia = entry["Dia"]
        if dia not in by_day:
            by_day[dia] = []
        by_day[dia].append(entry)

    # Preparar tareas para cada dia
    day_tasks = {}  # day_name -> (models_day, day_params)
    results = {}

    for day_cfg in days:
        day_name = day_cfg["name"]
        entries = by_day.get(day_name, [])

        if not entries:
            results[day_name] = {"schedule": [], "summary": _empty_summary(params["time_blocks"])}
            continue

        # Construir models_day para este dia
        models_day = []
        for entry in entries:
            modelo_code = entry["Modelo"]
            if modelo_code not in model_lookup:
                continue
            model_data = model_lookup[modelo_code]
            # Excluir operaciones MAQUILA: son externas, no consumen recursos internos
            internal_ops = [
                op for op in model_data["operations"]
                if op.get("recurso") != "MAQUILA"
            ]
            if not internal_ops:
                continue  # Modelo 100% maquila, nada que programar internamente
            models_day.append({
                "codigo": modelo_code,
                "fabrica": entry["Fabrica"],
                "suela": entry.get("Suela", ""),
                "pares_dia": entry["Pares"],
                "operations": internal_ops,
            })

        # Parametros para este dia (workers reducidos para paralelismo)
        plantilla = day_cfg["plantilla"]
        # Ajustes de plantilla desde restricciones (AUSENCIA_OPERARIO, CAPACIDAD_DIA)
        if compiled:
            if day_name in compiled.plantilla_overrides:
                plantilla = compiled.plantilla_overrides[day_name]
            elif day_name in compiled.plantilla_adjustments:
                plantilla = max(1, plantilla + compiled.plantilla_adjustments[day_name])

        day_params = {
            "time_blocks": params["time_blocks"],
            "resource_capacity": params["resource_capacity"],
            "plantilla": plantilla,
            "lot_step": params.get("lot_step", 50),
            "num_workers": 4,  # Menos workers por dia ya que corren en paralelo
            "day_name": day_name,  # para block_availability y disabled_robots
        }

        day_tasks[day_name] = (models_day, day_params)

    # Ejecutar dias en paralelo
    if day_tasks:
        active_days = len(day_tasks)
        print(f"  Scheduling {active_days} dias en paralelo...")

        with ThreadPoolExecutor(max_workers=active_days) as executor:
            futures = {}
            for day_name, (models_day, day_params) in day_tasks.items():
                total_p = sum(m["pares_dia"] for m in models_day)
                print(f"    -> {day_name}: {len(models_day)} modelos, {total_p} pares")
                futures[executor.submit(schedule_day, models_day, day_params, compiled)] = day_name

            for future in as_completed(futures):
                day_name = futures[future]
                try:
                    results[day_name] = future.result()
                    s = results[day_name]["summary"]
                    print(f"    <- {day_name}: {s['total_pares']} pares, "
                          f"tardiness={s['total_tardiness']}, status={s['status']}")
                except Exception as e:
                    print(f"    ERROR {day_name}: {e}")
                    results[day_name] = {"schedule": [], "summary": _empty_summary(params["time_blocks"])}

    # Reordenar por el orden logico de la semana (params["days"])
    day_order = [d["name"] for d in days]
    ordered = {d: results[d] for d in day_order if d in results}
    return ordered


def _extract_day_schedule(solver, x, y, active, robot_ops_idx,
                           models_day, time_blocks):
    """Extrae el programa horario del dia."""
    num_blocks = len(time_blocks)
    schedule = []

    # Set de (m_idx, op_idx) con robots para lookup rapido
    robot_ops_set = set(robot_ops_idx)

    for m_idx, model in enumerate(models_day):
        for op_idx, op in enumerate(model["operations"]):
            block_pares = []
            total_pares = 0
            for b in range(num_blocks):
                pares = solver.Value(x[m_idx, op_idx, b])
                block_pares.append(pares)
                total_pares += pares

            if total_pares <= 0:
                continue

            # Calcular HC: total_sec / total_minutos_activo / 60
            total_sec = total_pares * op["sec_per_pair"]
            active_minutes = sum(
                time_blocks[b]["minutes"]
                for b in range(num_blocks)
                if solver.Value(active[m_idx, op_idx, b])
            )
            hc = total_sec / (active_minutes * 60) if active_minutes > 0 else 0

            # Para operaciones con robots, extraer uso por robot
            robots_used = []
            if (m_idx, op_idx) in robot_ops_set:
                robots = op.get("robots", [])
                for r in robots:
                    r_pares = sum(
                        solver.Value(y[m_idx, op_idx, r, b])
                        for b in range(num_blocks)
                    )
                    if r_pares > 0:
                        robots_used.append(r)

            schedule.append({
                "modelo": model["codigo"],
                "fabrica": model["fabrica"],
                "fraccion": op["fraccion"],
                "operacion": op["operacion"],
                "recurso": op["recurso"],
                "rate": op["rate"],
                "hc": round(hc, 1),
                "block_pares": block_pares,
                "total_pares": total_pares,
                "robots_used": robots_used,
                "robots_eligible": op.get("robots", []),
                "hc_multiplier": op.get("hc_multiplier", 1),
            })

    # Ordenar por modelo, fraccion
    schedule.sort(key=lambda r: (r["modelo"], r["fraccion"]))
    return schedule


def _build_day_summary(solver, x, tardiness, models_day, time_blocks,
                        plantilla, resource_cap, status):
    """Construye resumen del dia."""
    num_blocks = len(time_blocks)

    # HC por bloque
    block_hc = []
    block_pares = []
    for b in range(num_blocks):
        block_sec = time_blocks[b]["minutes"] * 60
        total_load_sec = 0
        total_pares_b = 0
        for m_idx, model in enumerate(models_day):
            for op_idx, op in enumerate(model["operations"]):
                pares = solver.Value(x[m_idx, op_idx, b])
                total_load_sec += pares * op["sec_per_pair"]
                total_pares_b += pares
        hc = total_load_sec / block_sec if block_sec > 0 else 0
        block_hc.append(round(hc, 1))
        block_pares.append(total_pares_b)

    # Tardiness total
    total_tard = sum(solver.Value(tardiness[m]) for m in range(len(models_day)))

    # Pares totales
    total_pares = sum(m["pares_dia"] for m in models_day) - total_tard

    return {
        "status": solver.StatusName(status),
        "total_pares": total_pares,
        "total_tardiness": total_tard,
        "plantilla": plantilla,
        "block_hc": block_hc,
        "block_pares": block_pares,
        "block_labels": [tb["label"] for tb in time_blocks],
    }


def _empty_summary(time_blocks):
    """Resumen vacio para dias sin produccion."""
    return {
        "status": "NO_PRODUCTION",
        "total_pares": 0,
        "total_tardiness": 0,
        "plantilla": 0,
        "block_hc": [0] * len(time_blocks),
        "block_pares": [0] * len(time_blocks),
        "block_labels": [tb["label"] for tb in time_blocks],
    }
