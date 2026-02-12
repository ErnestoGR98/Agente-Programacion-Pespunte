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
  tardiness(100k) > uniformity(100) > early_start(50) > balance(1)
  Uniformity: penaliza bloques activos que producen menos que el rate/hora
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from ortools.sat.python import cp_model

# Pesos del objetivo
W_TARDINESS = 100_000     # por par no completado en el dia
W_UNIFORMITY = 100        # penalizar bloques activos que producen menos que el rate
W_EARLY_START = 50        # preferir iniciar operaciones lo antes posible
W_RESOURCE_BALANCE = 1    # balancear uso de recursos entre bloques


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
                    # Para operaciones con robots: rate limit per robot
                    # y total x puede ser hasta len(robots) * rate
                    max_pares_all_robots = max_pares_1person * len(robots)
                    if max_pares_all_robots < pares_dia:
                        solver_model.Add(x[m_idx, op_idx, b] <= max_pares_all_robots)
                    # Rate limit individual por robot
                    for r in robots:
                        if max_pares_1person < pares_dia:
                            solver_model.Add(y[m_idx, op_idx, r, b] <= max_pares_1person)
                else:
                    # Para operaciones manuales: 1 persona max por operacion
                    if max_pares_1person < pares_dia:
                        solver_model.Add(x[m_idx, op_idx, b] <= max_pares_1person)

    # 2b. Linking y con x para operaciones con robots
    #     sum_r y[m, op, r, b] = x[m, op, b]
    for m_idx, op_idx in robot_ops_idx:
        op = models_day[m_idx]["operations"][op_idx]
        robots = op["robots"]
        for b in range(num_blocks):
            solver_model.Add(
                sum(y[m_idx, op_idx, r, b] for r in robots) == x[m_idx, op_idx, b]
            )

    # 3. Capacidad de recurso por bloque (recursos NO-robot)
    #    Para cada tipo de recurso R (excepto ROBOT) y bloque b:
    #    sum de (tiempo de trabajo) <= capacidad_R * minutos_bloque * 60
    for b in range(num_blocks):
        block_minutes = time_blocks[b]["minutes"]
        block_sec = block_minutes * 60

        # Agrupar carga por tipo de recurso (excluir ops con robots asignados)
        resource_loads = {}
        for m_idx, model in enumerate(models_day):
            for op_idx, op in enumerate(model["operations"]):
                robots = op.get("robots", [])
                if robots:
                    # Operaciones con robots: manejadas por restriccion 6
                    continue
                recurso = op["recurso"]
                if recurso not in resource_loads:
                    resource_loads[recurso] = []
                # Carga = pares * sec_per_pair
                resource_loads[recurso].append(
                    x[m_idx, op_idx, b] * op["sec_per_pair"]
                )

        for recurso, loads in resource_loads.items():
            cap = resource_cap.get(recurso, resource_cap.get("GENERAL", 4))
            max_capacity_sec = cap * block_sec
            solver_model.Add(sum(loads) <= max_capacity_sec)

    # 4. Headcount total por bloque <= plantilla
    for b in range(num_blocks):
        block_sec = time_blocks[b]["minutes"] * 60
        # HC por operacion = pares * sec_per_pair / block_sec
        # Multiplicamos ambos lados por block_sec:
        # sum(pares * sec_per_pair) <= plantilla * block_sec
        total_load = []
        for m_idx, model in enumerate(models_day):
            for op_idx, op in enumerate(model["operations"]):
                total_load.append(x[m_idx, op_idx, b] * op["sec_per_pair"])
        if total_load:
            solver_model.Add(sum(total_load) <= plantilla * block_sec)

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

    # 6. Contiguidad de operaciones: una vez que una operacion se detiene,
    #    no puede reiniciar. Evita que operarios salten entre tareas.
    #    stopped[b] = 1 si la operacion estaba activa y ya no lo esta.
    #    Una vez stopped, no puede volver a activarse.
    for m_idx, model in enumerate(models_day):
        for op_idx in range(len(model["operations"])):
            stopped = {}
            for b in range(num_blocks):
                stopped[b] = solver_model.NewBoolVar(
                    f"stop_{m_idx}_{op_idx}_{b}"
                )
            solver_model.Add(stopped[0] == 0)
            for b in range(1, num_blocks):
                # Transicion activo->inactivo marca stopped
                solver_model.Add(
                    stopped[b] >= active[m_idx, op_idx, b - 1]
                    - active[m_idx, op_idx, b]
                )
                # Una vez stopped, permanece stopped
                solver_model.Add(stopped[b] >= stopped[b - 1])
                # No puede reactivarse despues de stopped
                solver_model.Add(
                    active[m_idx, op_idx, b] + stopped[b - 1] <= 1
                )

    # --- Funcion Objetivo ---
    obj_terms = []

    # Minimizar tardiness
    for m_idx in range(len(models_day)):
        obj_terms.append(W_TARDINESS * tardiness[m_idx])

    # Penalizar bloques activos que producen menos que el rate
    # Si rate=100/hr y bloque=60min, target=100 pares. Si solo produce 20,
    # shortfall=80 y se penaliza. Esto fuerza bloques llenos al rate.
    # Para ops con robots: target = rate de 1 robot (si usa N robots, x > target -> 0 penalty)
    for m_idx, model in enumerate(models_day):
        for op_idx, op in enumerate(model["operations"]):
            for b in range(num_blocks):
                block_min = time_blocks[b]["minutes"]
                target = int(op["rate"] * block_min / 60)
                if target <= 0:
                    continue
                shortfall = solver_model.NewIntVar(
                    0, target, f"sf_{m_idx}_{op_idx}_{b}"
                )
                solver_model.Add(
                    shortfall >= target * active[m_idx, op_idx, b]
                    - x[m_idx, op_idx, b]
                )
                obj_terms.append(W_UNIFORMITY * shortfall)

    # Preferir iniciar operaciones temprano (penalizar bloques tardios)
    for m_idx, model in enumerate(models_day):
        for op_idx in range(len(model["operations"])):
            for b in range(num_blocks):
                # Penalizacion crece con el indice del bloque
                obj_terms.append(W_EARLY_START * b * active[m_idx, op_idx, b])

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
            models_day.append({
                "codigo": modelo_code,
                "fabrica": entry["Fabrica"],
                "suela": entry.get("Suela", ""),
                "pares_dia": entry["Pares"],
                "operations": model_data["operations"],
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
