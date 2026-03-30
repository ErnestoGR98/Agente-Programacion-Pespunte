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
  5. Rate limit: 1 persona por robot, max_hc personas por operacion manual
  6. Contiguidad: una vez detenida, una operacion no puede reiniciar

Objetivo:
  tardiness(100k) > hc_overflow(50k) > uniformity(5k) > idle(500) > balance(1)
  Uniformidad: SUAVE - penalty por producir menos del rate (manual y robot)
  HC/Recurso: SUAVE - penalty por exceder plantilla o capacidad de recurso
  Idle: SUAVE - penalty por no usar toda la plantilla (incentiva multi-HC)
  Balance: minimiza el pico de HC para distribuir trabajo en todos los bloques
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from ortools.sat.python import cp_model

# Pesos del objetivo (defaults, overridden by params if available)
_W_TARDINESS = 100_000     # por par no completado en el dia
_W_UNIFORMITY = 5_000      # soft uniformity (por par de shortfall)
_W_HC_OVERFLOW = 50         # por segundo de exceso sobre plantilla/recurso por bloque
                            # (50 * 3600s = 180k por persona-bloque: fuerte pero < tardiness)
_W_OP_CAP_OVERFLOW = 5_000  # LEGACY: kept for params override; used only if op_capacity is soft
_W_IDLE = 1_500            # por segundo de capacidad ociosa (moderado, no domina W_EARLY)
_W_BALANCE = 10            # minimizar pico de HC (suave)


class _EarlyStopCallback(cp_model.CpSolverSolutionCallback):
    """Detiene el solver despues de optimizar objetivos secundarios.

    Al encontrar 0 tardiness, sigue buscando al menos `grace_seconds`
    para mejorar uniformidad, early_start y otros objetivos suaves.
    Sin esto, la primera solucion sin tardiness gana aunque tenga
    huecos enormes en el programa.
    """

    GRACE_SECONDS = 15.0  # tiempo adicional tras 0-tardiness para explorar mejor distribucion

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


def _calc_dynamic_hc(models_day, resource_cap, plantilla, op_capacity=None,
                     enforce_hc_stability=False):
    """Calcula HC maximo por operacion segun recursos y operarios.

    Robots siempre max_hc=1 (1 persona por robot).
    op_capacity: {recurso: num_operarios} — limita max_hc individual por operarios.
    enforce_hc_stability: si True, limita max_hc para que cada operacion dure
        al menos 1 bloque (evita saltos frecuentes entre operaciones).
        Si False (default), permite HC alto para aprovechar operarios ociosos.
    """
    num_models = len(models_day)
    # Mas generoso: distribuir plantilla por modelo (no por operacion)
    # Con cascada, cada modelo tiene varias ops concurrentes que comparten el HC
    base_hc = max(3, plantilla // max(1, num_models))
    block_min = 60  # duracion tipica de bloque en minutos
    min_blocks = 1  # permitir operaciones de 1 bloque para aprovechar todo el HC
    for model in models_day:
        pares_dia = model["pares_dia"]
        for op in model["operations"]:
            is_robot = bool(op.get("robots", []))
            if is_robot:
                op["max_hc"] = 1
            else:
                recurso = op.get("recurso", "GENERAL")
                # MESA y GENERAL son trabajo manual, no limitados por maquinas
                if recurso in ("MESA", "GENERAL"):
                    cap = plantilla
                else:
                    cap = resource_cap.get(recurso, resource_cap.get("GENERAL", plantilla))
                hc = max(1, min(cap, base_hc))
                # Limitar por operarios disponibles para este recurso
                if op_capacity:
                    parts = [p.strip() for p in recurso.split(",")] if "," in recurso else [recurso]
                    op_count = min(op_capacity.get(p, plantilla) for p in parts)
                    hc = min(hc, op_count)
                # Opcionalmente limitar HC para estabilidad (operaciones de al menos 1 bloque)
                if enforce_hc_stability:
                    rate_per_block = op["rate"] * block_min / 60
                    if rate_per_block > 0:
                        max_hc_stable = max(1, int(pares_dia / (rate_per_block * min_blocks)))
                        hc = min(hc, max_hc_stable)
                op["max_hc"] = hc


def schedule_day(models_day: list, params: dict, compiled=None,
                  reserved_robots: dict = None) -> dict:
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
    step = params.get("lot_step", 100)
    lineas_post = params.get("lineas_post", 0)

    # Read weights from params (DB-configurable), fallback to module defaults
    W_TARDINESS = int(params.get("w_diario_tardiness", _W_TARDINESS))
    W_HC_OVERFLOW = int(params.get("w_diario_hc_overflow", _W_HC_OVERFLOW))
    W_IDLE = int(params.get("w_diario_idle", _W_IDLE))

    if not models_day:
        return {"schedule": [], "summary": _empty_summary(time_blocks)}

    # Calcular HC dinamico por operacion segun recursos, operarios y plantilla
    _calc_dynamic_hc(models_day, resource_cap, plantilla,
                     params.get("operator_capacity"),
                     enforce_hc_stability=params.get("enforce_hc_stability", False))

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

    # hc_used[m, op, b] = personas asignadas (entero, fuerza x = rate * hc_used)
    hc_used = {}
    for m_idx, model in enumerate(models_day):
        for op_idx, op in enumerate(model["operations"]):
            is_robot = bool(op.get("robots", []))
            max_hc_val = 1 if is_robot else op.get("max_hc", 1)
            for b in range(num_blocks):
                hc_used[m_idx, op_idx, b] = solver_model.NewIntVar(
                    0, max_hc_val, f"hu_{m_idx}_{op_idx}_{b}"
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

    # Per-operation tardiness: each operation can have different completion.
    # Cascade ensures earlier ops have less tardiness (more production).
    # Model tardiness = last operation's tardiness (defines actual output).
    # This enables multi-day pipelines: F1-F4 complete today, F5-F13 tomorrow.
    op_tardiness = {}
    tardiness = {}  # model-level (= last op's tardiness, for rezago)
    for m_idx, model in enumerate(models_day):
        n_ops = len(model["operations"])
        for op_idx in range(n_ops):
            op_tardiness[m_idx, op_idx] = solver_model.NewIntVar(
                0, model["pares_dia"], f"otard_{m_idx}_{op_idx}"
            )
        # Model tardiness = last operation's tardiness
        tardiness[m_idx] = solver_model.NewIntVar(
            0, model["pares_dia"], f"tard_{m_idx}"
        )
        if n_ops > 0:
            solver_model.Add(
                tardiness[m_idx] == op_tardiness[m_idx, n_ops - 1]
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

    # Maquila delivery: post-maquila fractions can't produce before delivery block
    if compiled and day_name and compiled.maquila_block_restriction:
        for (restr_code, restr_day, restr_block, min_frac) in compiled.maquila_block_restriction:
            if restr_day != day_name:
                continue
            for m_idx, model in enumerate(models_day):
                if model.get("codigo", "") != restr_code:
                    continue
                for op_idx, op in enumerate(model["operations"]):
                    if op.get("fraccion", 0) >= min_frac:
                        for b in range(min(restr_block, num_blocks)):
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

        # Pre-count precedence rules per model to scale buffers.
        # With N rules each having buffer B, total startup = N*B.
        # If N*B > pares_dia, the pipeline is infeasible.
        # Scale each buffer so total startup <= pares_dia * 0.4.
        prec_count_per_model = {}
        for (mc, _, _, _) in compiled.precedences:
            prec_count_per_model[str(mc)] = prec_count_per_model.get(str(mc), 0) + 1

        for (modelo_code, fracs_orig, fracs_dest, buffer) in compiled.precedences:
            target_m = None
            for m_idx, model in enumerate(models_day):
                code = model.get("codigo", "")
                if code == modelo_code or code.startswith(str(modelo_code)):
                    target_m = m_idx
                    break
            if target_m is None:
                print(f"    [PREC] modelo {modelo_code} no encontrado en models_day, skip")
                continue

            pares_dia_m = models_day[target_m]["pares_dia"]

            # buffer=-2 means "dia": destination ops CANNOT produce on the same
            # day as origin ops. If origin is scheduled today, block destination.
            # If origin was completed on a PREVIOUS day, destination is free.
            if buffer == -2:
                idx_orig = [frac_to_op[(target_m, f)]
                            for f in fracs_orig if (target_m, f) in frac_to_op]
                idx_dest = [frac_to_op[(target_m, f)]
                            for f in fracs_dest if (target_m, f) in frac_to_op]
                if idx_orig and idx_dest:
                    # Origin is in today's schedule → block destination completely
                    print(f"    [PREC-DIA] {modelo_code}: F{fracs_orig}->F{fracs_dest} buffer=1dia, "
                          f"bloqueando destino ops {idx_dest} completamente hoy (origen presente)")
                    for op_d in idx_dest:
                        for b in range(num_blocks):
                            solver_model.Add(x[target_m, op_d, b] == 0)
                elif not idx_orig and idx_dest:
                    # Origin NOT in today's schedule (done on previous day) → destination free
                    print(f"    [PREC-DIA] {modelo_code}: F{fracs_orig}->F{fracs_dest} buffer=1dia, "
                          f"origen no presente hoy → destino LIBRE")
                continue

            # buffer=-1 means "todo": all origin pairs must finish before
            # any destination pair starts -> use pares_dia as buffer
            effective_buffer = buffer
            if effective_buffer < 0:
                effective_buffer = pares_dia_m
            # Scale buffer so total startup across all rules stays feasible.
            # With N rules, each buffer is capped at pares_dia * 0.4 / N.
            # This ensures the pipeline has enough overlap to complete.
            if effective_buffer > 0 and pares_dia_m > 0:
                n_rules = prec_count_per_model.get(str(modelo_code), 1)
                max_total_startup = max(1, int(pares_dia_m * 0.4))
                max_per_rule = max(1, max_total_startup // max(1, n_rules))
                if effective_buffer > max_per_rule:
                    print(f"    [PREC] {modelo_code}: buffer {effective_buffer} "
                          f"scaled to {max_per_rule} ({n_rules} rules, "
                          f"pares_dia={pares_dia_m})")
                    effective_buffer = max_per_rule

            # Map fraccion numbers to op_idx
            idx_orig = [frac_to_op[(target_m, f)]
                        for f in fracs_orig if (target_m, f) in frac_to_op]
            idx_dest = [frac_to_op[(target_m, f)]
                        for f in fracs_dest if (target_m, f) in frac_to_op]

            print(f"    [PREC] {modelo_code}: orig_fracs={fracs_orig}->idx={idx_orig}, dest_fracs={fracs_dest}->idx={idx_dest}, buffer={buffer}, eff_buffer={effective_buffer}")

            if not idx_orig or not idx_dest:
                print(f"    [PREC] skip: idx_orig o idx_dest vacio")
                continue

            for op_o in idx_orig:
                for op_d in idx_dest:
                    print(f"      [PREC] op{op_o}->op{op_d}, eff_buffer={effective_buffer}")
                    if effective_buffer == 0:
                        # Buffer=0 -> conveyor: unidirectional flow
                        # Destination NEVER produces more than origin
                        # Origin at most ~1 block ahead (tight coupling)
                        rate_o = models_day[target_m]["operations"][op_o]["rate"]
                        rate_d = models_day[target_m]["operations"][op_d]["rate"]
                        block_min = max(tb["minutes"] for tb in time_blocks)
                        max_lead = max(int(rate_o * block_min / 60),
                                       int(rate_d * block_min / 60))
                        for b in range(num_blocks):
                            cum_orig = sum(x[target_m, op_o, bb]
                                           for bb in range(b + 1))
                            cum_dest = sum(x[target_m, op_d, bb]
                                           for bb in range(b + 1))
                            # Destination NEVER ahead of origin
                            solver_model.Add(cum_dest <= cum_orig)
                            # Origin at most max_lead ahead (tight coupling)
                            solver_model.Add(cum_orig <= cum_dest + max_lead)
                    else:
                        # Buffer>0 -> startup delay: destination can't produce
                        # until origin has accumulated buffer pares, then free.
                        for b in range(num_blocks):
                            cum_orig = sum(x[target_m, op_o, bb] for bb in range(b + 1))
                            cum_dest = sum(x[target_m, op_d, bb] for bb in range(b + 1))
                            # Destination never produces more than origin
                            solver_model.Add(cum_dest <= cum_orig)
                            # Startup delay: dest blocked until origin >= buffer
                            buf_ok = solver_model.NewBoolVar(
                                f"buf_{target_m}_{op_o}_{op_d}_{b}")
                            solver_model.Add(
                                cum_orig >= effective_buffer).OnlyEnforceIf(buf_ok)
                            solver_model.Add(
                                cum_orig <= effective_buffer - 1).OnlyEnforceIf(buf_ok.Not())
                            solver_model.Add(
                                x[target_m, op_d, b] == 0).OnlyEnforceIf(buf_ok.Not())

    # --- Cascada implicita entre operaciones consecutivas ---
    # Cada operacion debe llevar ventaja acumulativa sobre la siguiente.
    # Esto fuerza un flujo pipeline: frac1 empieza primero, frac2 despues, etc.
    # Sin esto, el solver puede activar fracciones en cualquier orden (saltos).
    # SKIP solo los pares de fracciones que tienen PRECEDENCIA custom que conflicta
    # (ej: si custom dice F4->F2, saltar cascade entre F2->F3 y F3->F4).
    custom_prec_edges = set()  # (m_idx, op_idx_from, op_idx_to) — custom precedence pairs
    if compiled and compiled.precedences:
        for (modelo_code, fracs_orig, fracs_dest, _buf) in compiled.precedences:
            for m_idx, model in enumerate(models_day):
                code = model.get("codigo", "")
                if code == str(modelo_code) or code.startswith(str(modelo_code)):
                    # If custom says later_frac -> earlier_frac, cascade conflicts
                    for fo in fracs_orig:
                        for fd in fracs_dest:
                            oi = frac_to_op.get((m_idx, fo))
                            od = frac_to_op.get((m_idx, fd))
                            if oi is not None and od is not None and oi > od:
                                # Custom goes backwards (later -> earlier): skip all cascade
                                # between od and oi (inclusive range)
                                for skip_idx in range(od, oi):
                                    custom_prec_edges.add((m_idx, skip_idx))
                                    print(f"    [CASCADE] skip cascade {code} op{skip_idx}->op{skip_idx+1} (conflicts with F{fo}->F{fd})")

    for m_idx, model in enumerate(models_day):
        ops = model["operations"]
        for op_idx in range(len(ops) - 1):
            if (m_idx, op_idx) in custom_prec_edges:
                continue  # skip: custom precedence conflicts with linear cascade here
            for b in range(num_blocks):
                cum_current = sum(x[m_idx, op_idx, bb] for bb in range(b + 1))
                cum_next = sum(x[m_idx, op_idx + 1, bb] for bb in range(b + 1))
                # Operacion actual siempre debe haber producido >= la siguiente
                solver_model.Add(cum_current >= cum_next)

    # --- Restricciones ---

    # 1. Completar pares del dia para cada operacion de cada modelo.
    #    Permitir sobreproduccion para completar bloques al rate exacto.
    #    total_op = pares_dia - tardiness + overproduction
    overproduction = {}
    for m_idx, model in enumerate(models_day):
        pares_dia = model["pares_dia"]
        # Max overproduction: limitada a 15% del pares_dia (solo para redondeo de bloques)
        rate_max = max(
            int(op["rate"] * op.get("max_hc", 1))
            for op in model["operations"]
        ) if model["operations"] else 0
        max_over = min(rate_max, max(10, int(pares_dia * 0.15)))
        overproduction[m_idx] = solver_model.NewIntVar(
            0, max_over, f"over_{m_idx}"
        )
        for op_idx in range(len(model["operations"])):
            total_op = sum(x[m_idx, op_idx, b] for b in range(num_blocks))
            # Per-op completion: each op can complete independently
            # Cascade ensures earlier ops produce >= later ops
            solver_model.Add(
                total_op + op_tardiness[m_idx, op_idx] == pares_dia + overproduction[m_idx]
            )

    # 2. Linking x, active, hc_used + limite por rate
    #    Para operaciones manuales: x = rate * hc_used (exacto, multiples del rate).
    #    Para robots: hc_used=1 siempre, x <= rate (1 persona por robot).
    for m_idx, model in enumerate(models_day):
        pares_dia = model["pares_dia"]
        for op_idx, op in enumerate(model["operations"]):
            robots = op.get("robots", [])
            has_robots = len(robots) > 0
            for b in range(num_blocks):
                # Linking hc_used <-> active
                solver_model.Add(
                    hc_used[m_idx, op_idx, b] >= 1
                ).OnlyEnforceIf(active[m_idx, op_idx, b])
                solver_model.Add(
                    hc_used[m_idx, op_idx, b] == 0
                ).OnlyEnforceIf(active[m_idx, op_idx, b].Not())
                # x = 0 cuando inactivo
                solver_model.Add(
                    x[m_idx, op_idx, b] == 0
                ).OnlyEnforceIf(active[m_idx, op_idx, b].Not())

                block_min = time_blocks[b]["minutes"]
                max_pares_1person = int(op["rate"] * block_min / 60)

                if has_robots:
                    # Robots: hc_used=1, x <= rate (1 persona por robot)
                    if max_pares_1person < pares_dia:
                        solver_model.Add(x[m_idx, op_idx, b] <= max_pares_1person)
                    for r in robots:
                        if max_pares_1person < pares_dia:
                            solver_model.Add(y[m_idx, op_idx, r, b] <= max_pares_1person)
                else:
                    # Operaciones manuales: x <= rate * max_hc (upper bound)
                    max_hc = op.get("max_hc", 1)
                    max_pares_block = max_pares_1person * max_hc
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
            # MESA y GENERAL son trabajo manual — capacidad = plantilla, no maquinas
            if recurso in ("MESA", "GENERAL"):
                cap = plantilla
            else:
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

    # 4b. Capacidad de operarios por recurso por bloque - SEMI-HARD
    #     Limita hc_used simultaneo por recurso al numero real de operarios con esa skill.
    #     Permite overflow maximo de 1 operario extra con penalty alto para evitar INFEASIBLE.
    op_capacity = params.get("operator_capacity", {})
    op_cap_overflow_terms = []
    if op_capacity:
        for b in range(num_blocks):
            # Group hc_used by recurso
            hc_by_recurso = {}  # {recurso: [hc_used vars]}
            for m_idx, model in enumerate(models_day):
                for op_idx, op in enumerate(model["operations"]):
                    if bool(op.get("robots", [])):
                        continue  # robots have dedicated operators, skip
                    recurso = op["recurso"]
                    # For compound resources like "PLANA,POSTE", count toward each part
                    parts = [p.strip() for p in recurso.split(",")] if "," in recurso else [recurso]
                    for part in parts:
                        if part not in hc_by_recurso:
                            hc_by_recurso[part] = []
                        hc_by_recurso[part].append(hc_used[m_idx, op_idx, b])
            # SEMI-HARD: max 1 extra operario con penalty alto
            for recurso, hc_vars in hc_by_recurso.items():
                cap = op_capacity.get(recurso)
                if cap is not None and hc_vars:
                    overflow = solver_model.NewIntVar(0, 1, f"opcap_{recurso}_{b}")
                    solver_model.Add(sum(hc_vars) <= cap + overflow)
                    op_cap_overflow_terms.append(overflow)

    # 5. Capacidad de robot individual por bloque
    #    Cada robot fisico solo puede trabajar 1 operacion a la vez.
    #    robot_active[m, op, r, b] = 1 si robot r esta asignado a (m, op) en bloque b
    #    Para cada robot r y bloque b: sum_{m,op} robot_active <= 1  (exclusividad)
    #    Linking: y[m,op,r,b] > 0 => robot_active = 1
    all_robots_in_day = set()
    for m_idx, op_idx in robot_ops_idx:
        op = models_day[m_idx]["operations"][op_idx]
        for r in op["robots"]:
            all_robots_in_day.add(r)

    robot_active = {}
    for m_idx, op_idx in robot_ops_idx:
        op = models_day[m_idx]["operations"][op_idx]
        pares_dia = models_day[m_idx]["pares_dia"]
        for r in op["robots"]:
            for b in range(num_blocks):
                ra = solver_model.NewBoolVar(f"ra_{m_idx}_{op_idx}_{r}_{b}")
                robot_active[m_idx, op_idx, r, b] = ra
                # Linking: y > 0 => ra = 1, ra = 0 => y = 0
                solver_model.Add(y[m_idx, op_idx, r, b] <= pares_dia * ra)
                solver_model.Add(y[m_idx, op_idx, r, b] >= ra)  # ra=1 => y>=1

    # Exclusividad: cada robot puede estar en max 1 operacion por bloque
    robot_constraint_count = 0
    for b in range(num_blocks):
        for robot in all_robots_in_day:
            uses = []
            use_labels = []
            for m_idx, op_idx in robot_ops_idx:
                op = models_day[m_idx]["operations"][op_idx]
                if robot in op["robots"]:
                    uses.append(robot_active[m_idx, op_idx, robot, b])
                    use_labels.append(f"{models_day[m_idx]['codigo']}:F{op['fraccion']}")
            if len(uses) > 1:
                solver_model.Add(sum(uses) <= 1)
                robot_constraint_count += 1
                if b == 0:  # Log once per robot
                    print(f"    [ROBOT EXCL] {robot}: {len(uses)} ops compiten -> {use_labels}")
    print(f"    [ROBOT EXCL] Total constraints: {robot_constraint_count}")

    # Capacidad de rate por robot por bloque (1 persona por robot)
    for b in range(num_blocks):
        block_sec = time_blocks[b]["minutes"] * 60
        for robot in all_robots_in_day:
            for m_idx, op_idx in robot_ops_idx:
                op = models_day[m_idx]["operations"][op_idx]
                if robot in op["robots"]:
                    solver_model.Add(
                        y[m_idx, op_idx, robot, b] * op["sec_per_pair"] <= block_sec
                    )

    # 5b. Robots reservados por schedule principal (para adelantos)
    #     Si un robot ya esta en uso en un bloque, ninguna operacion puede usarlo.
    if reserved_robots:
        for robot, blocked_set in reserved_robots.items():
            if robot not in all_robots_in_day:
                continue
            for b in blocked_set:
                if b >= num_blocks:
                    continue
                for m_idx, op_idx in robot_ops_idx:
                    op = models_day[m_idx]["operations"][op_idx]
                    if robot in op["robots"]:
                        key = (m_idx, op_idx, robot, b)
                        if key in robot_active:
                            solver_model.Add(robot_active[key] == 0)

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

    # 7. Produccion por multiplos exactos del rate (salta COMIDA):
    #    Cada persona produce exactamente rate pares/bloque (ej: 100).
    #    Operaciones manuales: x = rate_pb * hc_used (multiplo exacto).
    #    Ultimo bloque activo: x = rate_pb * hc_used (preferido) o
    #    x = step_pb * hc_used (fallback, 50 pares/persona).
    #    Robots: hc_used=1 siempre, x <= rate_pb (ya limitado en seccion 2).
    step_penalty_vars = []
    for m_idx, model in enumerate(models_day):
        for op_idx, op in enumerate(model["operations"]):
            is_robot = bool(op.get("robots", []))
            if is_robot:
                # Robots ya limitados: hc_used=1, x<=rate. Solo forzar uniformidad
                # para bloques no-ultimo: x >= rate cuando ambos activos.
                for rb_idx in range(len(real_blocks) - 1):
                    b = real_blocks[rb_idx]
                    next_b = real_blocks[rb_idx + 1]
                    block_min = time_blocks[b]["minutes"]
                    rate_pb = int(op["rate"] * block_min / 60)
                    if rate_pb <= 0:
                        continue
                    solver_model.Add(
                        x[m_idx, op_idx, b] >= rate_pb
                    ).OnlyEnforceIf([
                        active[m_idx, op_idx, b],
                        active[m_idx, op_idx, next_b]
                    ])
                continue

            # --- Operaciones manuales: x = rate * hc_used ---
            for rb_idx in range(len(real_blocks)):
                b = real_blocks[rb_idx]
                block_min = time_blocks[b]["minutes"]
                rate_pb = int(op["rate"] * block_min / 60)
                step_pb = min(step, rate_pb) if rate_pb > 0 else 0
                if rate_pb <= 0:
                    continue

                # Determinar si es ultimo bloque activo
                if rb_idx < len(real_blocks) - 1:
                    next_b = real_blocks[rb_idx + 1]
                    is_last = solver_model.NewBoolVar(
                        f"il_{m_idx}_{op_idx}_{b}")
                    solver_model.Add(
                        is_last <= active[m_idx, op_idx, b])
                    solver_model.Add(
                        is_last <= 1 - active[m_idx, op_idx, next_b])
                    solver_model.Add(
                        is_last >= active[m_idx, op_idx, b]
                        - active[m_idx, op_idx, next_b])

                    # No-ultimo: x == rate_pb * hc_used (multiplo exacto)
                    solver_model.Add(
                        x[m_idx, op_idx, b] == rate_pb * hc_used[m_idx, op_idx, b]
                    ).OnlyEnforceIf([
                        active[m_idx, op_idx, b],
                        active[m_idx, op_idx, next_b]
                    ])
                else:
                    # Ultimo real_block: si esta activo, es el ultimo
                    is_last = active[m_idx, op_idx, b]

                # Ultimo bloque: rate*hc (preferred) o step*hc (fallback)
                is_full = solver_model.NewBoolVar(
                    f"fl_{m_idx}_{op_idx}_{b}")
                solver_model.Add(
                    x[m_idx, op_idx, b] == rate_pb * hc_used[m_idx, op_idx, b]
                ).OnlyEnforceIf([is_last, is_full])
                solver_model.Add(
                    x[m_idx, op_idx, b] == step_pb * hc_used[m_idx, op_idx, b]
                ).OnlyEnforceIf([is_last, is_full.Not()])
                step_penalty_vars.append((is_last, is_full))

    # 8. Exclusividad de conveyor: limitar modelos con ops POST por bloque
    #    Si lineas_post > 0, maximo N modelos distintos pueden tener operaciones
    #    POST activas en el mismo bloque (1 conveyor = 1 modelo a la vez).
    if lineas_post > 0:
        post_ops_by_model = {}
        for m_idx, model in enumerate(models_day):
            post_idxs = [i for i, op in enumerate(model["operations"])
                         if op.get("input_o_proceso") == "POST"]
            if post_idxs:
                post_ops_by_model[m_idx] = post_idxs

        if post_ops_by_model:
            post_model_active = {}
            for m_idx, post_op_idxs in post_ops_by_model.items():
                for b in range(num_blocks):
                    pma = solver_model.NewBoolVar(f"pma_{m_idx}_{b}")
                    post_model_active[m_idx, b] = pma
                    # pma = OR(active[m, op, b] para cada op POST)
                    for op_idx in post_op_idxs:
                        solver_model.Add(pma >= active[m_idx, op_idx, b])
                    solver_model.Add(
                        pma <= sum(active[m_idx, op_idx, b]
                                   for op_idx in post_op_idxs)
                    )

            models_with_post = list(post_ops_by_model.keys())
            for b in range(num_blocks):
                solver_model.Add(
                    sum(post_model_active[m_idx, b]
                        for m_idx in models_with_post)
                    <= lineas_post
                )
            print(f"    [POST] Conveyor exclusivity: {len(models_with_post)} modelos POST, "
                  f"max {lineas_post} simultaneos por bloque")

    # 9. Penalizar operarios ociosos: incentiva usar toda la plantilla
    idle_terms = []
    for b in real_blocks:
        block_sec = time_blocks[b]["minutes"] * 60
        total_load = []
        for m_idx, model in enumerate(models_day):
            for op_idx, op in enumerate(model["operations"]):
                total_load.append(x[m_idx, op_idx, b] * op["sec_per_pair"])
        target_sec = plantilla * block_sec
        idle = solver_model.NewIntVar(0, target_sec, f"idle_{b}")
        solver_model.Add(idle >= target_sec - sum(total_load))
        idle_terms.append(idle)

    # --- Funcion Objetivo ---
    obj_terms = []

    # Minimizar tardiness
    for m_idx in range(len(models_day)):
        obj_terms.append(W_TARDINESS * tardiness[m_idx])

    # (Uniformidad ahora es HARD constraint, no necesita penalizacion suave)

    # Penalty por exceder capacidad de recurso o plantilla por bloque
    for ov in hc_overflow_terms:
        obj_terms.append(W_HC_OVERFLOW * ov)

    # Penalty por exceder capacidad de operarios por recurso (semi-hard)
    # Peso alto: 1 overflow por 1 bloque = 200k (equivale a 2 pares de tardiness)
    W_OP_CAP = 200_000
    for ov in op_cap_overflow_terms:
        obj_terms.append(W_OP_CAP * ov)

    # Penalty por operarios ociosos (incentiva usar toda la plantilla)
    for idle in idle_terms:
        obj_terms.append(W_IDLE * idle)

    # Penalizar sobreproduccion (leve: preferir completar bloques al rate,
    # pero no sobreproducir mas de lo necesario para llenar el ultimo bloque)
    W_OVER = 5  # mucho menor que tardiness para preferir sobreproducir a no completar
    for m_idx in range(len(models_day)):
        obj_terms.append(W_OVER * overproduction[m_idx])

    # Penalizar uso de step (50 pares) en lugar de rate (100 pares) en ultimo bloque.
    # Preferir bloques completos al rate; step solo como fallback.
    W_STEP_PENALTY = 50
    for sp_idx, (is_last_var, is_full_var) in enumerate(step_penalty_vars):
        # Penalizar solo cuando IS ultimo bloque Y usa step (is_full=0)
        uses_step = solver_model.NewBoolVar(f"ustp_{sp_idx}")
        solver_model.Add(uses_step <= is_last_var)
        solver_model.Add(uses_step <= 1 - is_full_var)
        solver_model.Add(uses_step >= is_last_var + (1 - is_full_var) - 1)
        obj_terms.append(W_STEP_PENALTY * uses_step)

    # Early/Late completion: controlar posicion horaria de modelos.
    # - Modelos normales y split_head: preferir bloques tempranos (W_EARLY * b)
    # - Modelos split_tail (primer dia de un split): empujar a bloques tardios
    #   para crear continuidad con el dia siguiente (fin dia 1 -> inicio dia 2)
    W_EARLY = 10  # leve pero suficiente para preferir bloques tempranos
    W_LATE = 10   # misma magnitud, invertida para split_tail
    for m_idx, model in enumerate(models_day):
        split_pos = model.get("split_position")
        for op_idx, op in enumerate(model["operations"]):
            for b in range(num_blocks):
                if split_pos == "tail":
                    # Invertir: preferir bloques tardios (penalizar bloques tempranos)
                    obj_terms.append(W_LATE * x[m_idx, op_idx, b] * (num_blocks - 1 - b))
                else:
                    # Normal: preferir bloques tempranos
                    obj_terms.append(W_EARLY * x[m_idx, op_idx, b] * b)

    # Desbalance de HC entre bloques: penalizar la diferencia entre el bloque
    # con mas HC y el bloque con menos HC. Esto incentiva distribuir el trabajo
    # uniformemente a lo largo del dia (no concentrar todo en mañana o tarde).
    W_BALANCE = int(params.get("w_diario_balance", _W_BALANCE))
    if len(real_blocks) > 1:
        block_hc_vars = []
        for b in real_blocks:
            hc_b = solver_model.NewIntVar(0, plantilla * 10, f"bhc_{b}")
            block_load = []
            for m_idx, model in enumerate(models_day):
                for op_idx in range(len(model["operations"])):
                    block_load.append(hc_used[m_idx, op_idx, b])
            solver_model.Add(hc_b == sum(block_load))
            block_hc_vars.append(hc_b)
        # Minimize max HC across blocks (soft)
        peak_hc = solver_model.NewIntVar(0, plantilla * 10, "peak_hc")
        for hc_b in block_hc_vars:
            solver_model.Add(peak_hc >= hc_b)
        obj_terms.append(W_BALANCE * peak_hc)

    solver_model.Minimize(sum(obj_terms))

    # --- Resolver ---
    solver = cp_model.CpSolver()

    # Timeout dinamico segun complejidad del dia
    total_pares = sum(m["pares_dia"] for m in models_day)
    total_ops = sum(len(m["operations"]) for m in models_day)
    # Base 15s + escala con pares y operaciones, tope 60s
    # Mas tiempo para explorar distribuciones balanceadas de HC
    timeout = min(60, max(15, 10 + total_pares // 150 + total_ops // 2))
    solver.parameters.max_time_in_seconds = timeout

    # Workers: reducir si se ejecuta en paralelo (evitar contention)
    num_workers = params.get("num_workers", 4)
    solver.parameters.num_workers = num_workers

    # Callback de parada temprana: si tardiness=0, dejar de buscar
    callback = _EarlyStopCallback(list(tardiness.values()))
    status = solver.Solve(solver_model, callback)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        print(f"  ADVERTENCIA: No se encontro solucion para el dia. Estado: {solver.StatusName(status)}")
        print(f"    Modelos: {[(m['codigo'], m['pares_dia'], len(m['operations'])) for m in models_day]}")
        print(f"    Plantilla: {plantilla}, Bloques: {num_blocks}")
        print(f"    Num constraints: {solver_model.Proto().constraints.__len__()}")
        return {"schedule": [], "summary": _empty_summary(time_blocks)}

    # --- Extraer solucion ---
    schedule = _extract_day_schedule(solver, x, y, active, hc_used,
                                      robot_ops_idx, models_day, time_blocks)
    summary = _build_day_summary(solver, x, tardiness, overproduction,
                                  models_day, time_blocks,
                                  plantilla, resource_cap, status,
                                  op_tardiness=op_tardiness)

    return {"schedule": schedule, "summary": summary}


def schedule_week(weekly_schedule: list, matched_models: list, params: dict,
                   compiled=None, operarios: list = None) -> dict:
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

    # Lookup de fabrica por modelo (del weekly_schedule)
    fabrica_lookup = {}
    for entry in weekly_schedule:
        code = entry["Modelo"]
        if code not in fabrica_lookup:
            fabrica_lookup[code] = entry.get("Fabrica", "")

    # Agrupar schedule semanal por dia
    by_day = {}
    for entry in weekly_schedule:
        dia = entry["Dia"]
        if dia not in by_day:
            by_day[dia] = []
        by_day[dia].append(entry)

    # Detectar modelos que se parten en multiples dias (split)
    # model_days[codigo] = lista ordenada de dias donde aparece
    model_days = {}
    day_order_tmp = [d["name"] for d in days]
    for entry in weekly_schedule:
        code = entry["Modelo"]
        dia = entry["Dia"]
        if code not in model_days:
            model_days[code] = set()
        model_days[code].add(dia)
    # Convertir a listas ordenadas segun day_order
    for code in model_days:
        model_days[code] = sorted(model_days[code], key=lambda d: day_order_tmp.index(d) if d in day_order_tmp else 99)

    # Preparar tareas para cada dia
    day_tasks = {}  # day_name -> (models_day, day_params)
    results = {}

    for day_cfg in days:
        day_name = day_cfg["name"]
        entries = by_day.get(day_name, [])

        if not entries:
            print(f"  [schedule_week] {day_name}: sin entries en weekly -> NO_PRODUCTION")
            results[day_name] = {"schedule": [], "summary": _empty_summary(params["time_blocks"])}
            continue

        print(f"  [schedule_week] {day_name}: {len(entries)} entries: {[(e['Modelo'], e['Pares']) for e in entries]}")

        # Construir models_day para este dia
        models_day = []
        for entry in entries:
            modelo_code = entry["Modelo"]
            if modelo_code not in model_lookup:
                print(f"    SKIP {modelo_code}: not in model_lookup (keys={list(model_lookup.keys())[:5]}...)")
                continue
            model_data = model_lookup[modelo_code]
            # Excluir operaciones MAQUILA: son externas, no consumen recursos internos
            # Excluir fracciones ya completadas (preliminares hechos dia anterior, etc.)
            completed_fracs = set()
            if compiled and modelo_code in getattr(compiled, 'completed_fractions', {}):
                completed_fracs = compiled.completed_fractions[modelo_code]
            # Also check by modelo_num (without suffix like " NE")
            modelo_num = modelo_code.split()[0] if " " in modelo_code else modelo_code
            if compiled and modelo_num in getattr(compiled, 'completed_fractions', {}):
                completed_fracs = completed_fracs | compiled.completed_fractions[modelo_num]

            internal_ops = [
                op for op in model_data["operations"]
                if op.get("recurso") != "MAQUILA"
                and op.get("fraccion") not in completed_fracs
            ]
            if completed_fracs:
                print(f"    [AVANCE] {modelo_code}: saltando fracciones completadas {completed_fracs}")
            if not internal_ops:
                continue  # Modelo 100% maquila o completado, nada que programar
            # Detectar posicion de split: si el modelo aparece en >1 dia,
            # marcar "tail" en dias intermedios/no-ultimo (empujar a bloques tardios)
            # y "head" en dias posteriores al primero (bloques tempranos, default).
            # Esto crea continuidad: fin dia 1 -> inicio dia 2.
            split_pos = None
            code_days = model_days.get(modelo_code, [])
            if len(code_days) > 1:
                day_idx_in_split = code_days.index(day_name) if day_name in code_days else -1
                if day_idx_in_split == 0:
                    split_pos = "tail"  # primer dia del split: empujar a bloques tardios
                elif day_idx_in_split > 0:
                    split_pos = "head"  # dias siguientes: bloques tempranos (default)
                print(f"    [SPLIT] {modelo_code} dia {day_name}: posicion={split_pos} (dias={code_days})")

            models_day.append({
                "codigo": modelo_code,
                "fabrica": entry["Fabrica"],
                "suela": entry.get("Suela", ""),
                "pares_dia": entry["Pares"],
                "operations": internal_ops,
                "split_position": split_pos,
            })

        print(f"    models_day construido: {len(models_day)} modelos: {[(m['codigo'], m['pares_dia'], len(m['operations'])) for m in models_day]}")
        if not models_day:
            print(f"    -> models_day VACIO despues de filtrar -> NO_PRODUCTION")

        # Parametros para este dia (workers reducidos para paralelismo)
        plantilla = day_cfg["plantilla"]
        # Ajustes de plantilla desde restricciones (AUSENCIA_OPERARIO, CAPACIDAD_DIA)
        if compiled:
            if day_name in compiled.plantilla_overrides:
                plantilla = compiled.plantilla_overrides[day_name]
            elif day_name in compiled.plantilla_adjustments:
                plantilla = max(1, plantilla + compiled.plantilla_adjustments[day_name])

        # Count available operators per resource type for this day
        op_cap_by_recurso = {}
        if operarios:
            day_prefix = day_name.split()[0] if day_name else ""
            for op in operarios:
                if not op.get("activo", True):
                    continue
                dias = op.get("dias_disponibles", [])
                available = not dias  # empty = available every day
                if not available:
                    for d in dias:
                        if d == day_name or day_name.startswith(d) or d.startswith(day_prefix):
                            available = True
                            break
                if not available:
                    continue
                for r in op.get("recursos_habilitados", []):
                    op_cap_by_recurso[r] = op_cap_by_recurso.get(r, 0) + 1
            if op_cap_by_recurso:
                print(f"    [OP_CAP] {day_name}: {op_cap_by_recurso}")

        day_params = {
            "time_blocks": params["time_blocks"],
            "resource_capacity": params["resource_capacity"],
            "plantilla": plantilla,
            "lot_step": params.get("lot_step", 100),
            "num_workers": 2,  # Render free tier: pocos cores disponibles
            "day_name": day_name,  # para block_availability y disabled_robots
            "lineas_post": params.get("lineas_post", 0),
            "operator_capacity": op_cap_by_recurso,  # operators per resource type
        }

        day_tasks[day_name] = (models_day, day_params)

    # Ejecutar dias SECUENCIALMENTE para permitir adelantos.
    # Cuando un dia tiene HC ocioso, inyectamos modelos del dia siguiente
    # para que los operarios sin maquina adelanten trabajo.
    day_order = [d["name"] for d in days]
    ordered_tasks = [(dn, day_tasks[dn]) for dn in day_order if dn in day_tasks]

    # Track de pares adelantados: {modelo_code: pares_ya_adelantados}
    adelanto_credits = {}  # se descuenta del dia siguiente (solo de adelanto EXPLICITO)
    # Track de tardiness carry-over: {modelo_code: pares_pendientes_dia_anterior}
    tardiness_carryover = {}
    # Track de ops completadas acumulativamente: {modelo_code: set of fraccion numbers}
    # For multi-day pipelines: ops completed on previous days are skipped
    cumulative_completed_fracs = {}  # {code: set of completed fraccion numbers}
    # Track cumulative pairs produced per operation across days (for cross-day pipeline cap)
    cumulative_produced_by_op = {}  # {code: {fraccion: total_pairs_produced_so_far}}
    # Track which models have rezago (tardiness carryover applied this day)
    rezago_applied_today = set()
    # Guardar pares originales del weekly para cada modelo-dia (proteccion minima)
    weekly_pares_lookup = {}  # {(code, day_name): pares}
    for dn, (md_list, _) in day_tasks.items():
        for m in md_list:
            weekly_pares_lookup[(m["codigo"], dn)] = m["pares_dia"]

    for task_idx, (day_name, (models_day, day_params)) in enumerate(ordered_tasks):
        rezago_applied_today.clear()

        # Descontar pares ya adelantados del dia anterior
        for m in models_day:
            code = m["codigo"]
            if code in adelanto_credits and adelanto_credits[code] > 0:
                descuento = min(adelanto_credits[code], m["pares_dia"])
                print(f"    [ADELANTO] {day_name} {code}: descontando {descuento}p adelantados "
                      f"(pares_dia {m['pares_dia']} -> {m['pares_dia'] - descuento})")
                m["pares_dia"] -= descuento
                adelanto_credits[code] -= descuento

        # Sumar pares de tardiness del dia anterior (rezago)
        pares_rezago = 0
        models_day_codes = {m["codigo"] for m in models_day}
        for m in models_day:
            code = m["codigo"]
            if code in tardiness_carryover and tardiness_carryover[code] > 0:
                extra = tardiness_carryover[code]
                print(f"    [REZAGO] {day_name} {code}: +{extra}p de tardiness del dia anterior")
                m["pares_dia"] += extra
                pares_rezago += extra
                tardiness_carryover[code] = 0
                rezago_applied_today.add(code)

        # Inyectar modelos con tardiness pendiente que NO estan programados hoy
        for code, pending in list(tardiness_carryover.items()):
            if pending <= 0 or code in models_day_codes:
                continue
            if code not in model_lookup:
                print(f"    [REZAGO] {code}: {pending}p pendientes pero modelo no encontrado en lookup")
                continue
            model_data = model_lookup[code]
            internal_ops = [
                op for op in model_data["operations"]
                if op.get("recurso") != "MAQUILA"
            ]
            if not internal_ops:
                continue
            print(f"    [REZAGO-INJECT] {day_name} {code}: inyectando {pending}p pendientes (modelo no programado hoy)")
            models_day.append({
                "codigo": code,
                "fabrica": fabrica_lookup.get(code, ""),
                "suela": model_data.get("suela", ""),
                "pares_dia": pending,
                "operations": internal_ops,
            })
            pares_rezago += pending
            tardiness_carryover[code] = 0
            rezago_applied_today.add(code)

        # Multi-day pipeline: filter out ops completed on previous days
        # SOLO aplicar a modelos con rezago (tardiness de dia anterior),
        # NO a lotes frescos del weekly (cada dia es un lote independiente).
        for m in models_day:
            code = m["codigo"]
            if code in cumulative_completed_fracs and code in rezago_applied_today:
                done_fracs = cumulative_completed_fracs[code]
                original_count = len(m["operations"])
                # Keep only operations whose fraccion is NOT yet completed
                remaining = [
                    op for op in m["operations"]
                    if op.get("fraccion") not in done_fracs
                ]
                if len(remaining) < original_count:
                    skipped = original_count - len(remaining)
                    print(f"    [PIPELINE] {day_name} {code}: skipping {skipped} "
                          f"completed fracs {done_fracs}, {len(remaining)} remaining")
                    m["operations"] = remaining

        # Cross-day pipeline cap: for models with prior-day production,
        # ensure no fraction produces more across the week than the minimum
        # of all fractions (bottleneck). Prevents downstream exceeding upstream.
        for m in models_day:
            code = m["codigo"]
            cum_prod = cumulative_produced_by_op.get(code, {})
            if not cum_prod:
                continue  # first day for this model, no cap

            # Find the bottleneck: min production across ALL internal fracs so far
            internal_produced = {f: p for f, p in cum_prod.items() if p > 0}
            if not internal_produced:
                continue

            bottleneck = min(internal_produced.values())

            # How much has the most-produced of today's fracs already done?
            today_fracs = set(op.get("fraccion", 0) for op in m["operations"])
            max_downstream_done = max(
                (cum_prod.get(f, 0) for f in today_fracs), default=0
            )

            # If any of today's fracs already exceeds bottleneck, cap to 0
            # Otherwise, cap so they don't exceed bottleneck
            remaining_cap = max(0, bottleneck - max_downstream_done)

            # Soft cap: allow weekly minimum, let intra-day cascade handle balance.
            # Do NOT hard-cap to 0 — that kills models with rezago.
            weekly_min = weekly_pares_lookup.get((code, day_name), 0)

            if remaining_cap < m["pares_dia"]:
                new_pares = max(remaining_cap, weekly_min)
                if new_pares < m["pares_dia"]:
                    print(f"    [PIPELINE-CAP] {day_name} {code}: capping pares_dia "
                          f"{m['pares_dia']} -> {new_pares} "
                          f"(bottleneck={bottleneck}, downstream_done={max_downstream_done})")
                    m["pares_dia"] = new_pares

        # Filtrar modelos con 0 pares o 0 operaciones — con logging diagnostico
        filtered_out = [m for m in models_day if m["pares_dia"] <= 0 or not m.get("operations")]
        for m in filtered_out:
            print(f"    WARNING: {day_name} {m['codigo']} ELIMINADO: "
                  f"pares_dia={m['pares_dia']}, ops={len(m.get('operations', []))}, "
                  f"weekly_pares={weekly_pares_lookup.get((m['codigo'], day_name), '?')}")
        models_day = [m for m in models_day if m["pares_dia"] > 0 and m.get("operations")]

        total_p = sum(m["pares_dia"] for m in models_day)
        print(f"    -> {day_name}: {len(models_day)} modelos, {total_p} pares")

        try:
            results[day_name] = schedule_day(models_day, day_params, compiled)
            s = results[day_name]["summary"]
            if pares_rezago > 0:
                s["pares_rezago"] = pares_rezago
            print(f"    <- {day_name}: {s['total_pares']} pares, "
                  f"tardiness={s['total_tardiness']}, rezago={pares_rezago}, status={s['status']}")
        except Exception as e:
            print(f"    ERROR {day_name}: {e}")
            results[day_name] = {"schedule": [], "summary": _empty_summary(params["time_blocks"])}
            continue

        # --- Carry-over tardiness al dia siguiente ---
        day_tardiness = results[day_name]["summary"].get("tardiness_by_model", {})
        if day_tardiness and task_idx + 1 < len(ordered_tasks):
            for code, tard in day_tardiness.items():
                tardiness_carryover[code] = tardiness_carryover.get(code, 0) + tard
                print(f"    [REZAGO] {code}: {tard}p pendientes -> se pasan al siguiente dia")

        # --- Track completed ops for multi-day pipeline ---
        day_completed = results[day_name]["summary"].get("completed_ops_by_model", {})
        if day_completed and task_idx + 1 < len(ordered_tasks):
            for code, completed_indices in day_completed.items():
                prev_done = cumulative_completed_fracs.get(code, set())
                # Map completed op indices back to fraccion numbers
                model_entry = None
                for m in models_day:
                    if m["codigo"] == code:
                        model_entry = m
                        break
                if model_entry:
                    for ci in completed_indices:
                        if ci < len(model_entry["operations"]):
                            frac = model_entry["operations"][ci].get("fraccion", ci)
                            prev_done.add(frac)
                    cumulative_completed_fracs[code] = prev_done
                    print(f"    [PIPELINE] {code}: cumulative completed fracs: {prev_done}")

        # --- Accumulate per-operation production for cross-day pipeline cap ---
        day_produced = results[day_name]["summary"].get("produced_by_op", {})
        for code, op_prod in day_produced.items():
            if code not in cumulative_produced_by_op:
                cumulative_produced_by_op[code] = {}
            for frac, pares in op_prod.items():
                cumulative_produced_by_op[code][frac] = (
                    cumulative_produced_by_op[code].get(frac, 0) + pares
                )

        # --- Enforce cascade in cumulative production ---
        # After each day, cap downstream fracs to not exceed upstream.
        # This prevents the pipeline cap from seeing inflated downstream
        # numbers on the next day, which would trigger unnecessary caps.
        for code, frac_prod in cumulative_produced_by_op.items():
            if len(frac_prod) < 2:
                continue
            sorted_fracs = sorted(frac_prod.keys())
            # Running min: each frac can't exceed the min of all previous fracs
            running_min = float('inf')
            for f in sorted_fracs:
                running_min = min(running_min, frac_prod[f])
                if frac_prod[f] > running_min:
                    print(f"    [CASCADE-FIX] {code} F{f}: capping cumulative "
                          f"{frac_prod[f]} -> {running_min}")
                    frac_prod[f] = running_min

        # --- Overproduction: solo logear, NO convertir en adelanto_credits ---
        # La sobreproduccion es un artefacto de discretizacion del solver (completar
        # un bloque al rate exacto), no un adelanto intencional. Convertirla en
        # creditos destruia los pares de dias posteriores.
        day_over = results[day_name]["summary"].get("overproduction_by_model", {})
        if day_over:
            for code, over in day_over.items():
                print(f"    [OVERPROD] {code}: +{over}p sobreproducidos (no se descuentan)")

        # --- Adelanto deshabilitado ---
        # El adelanto robaba trabajo del dia siguiente sin garantizar que se completara,
        # dejando dias posteriores vacíos. El rezago (tardiness carryover) es más confiable:
        # cada dia produce lo que puede, lo que falta pasa al siguiente.
        continue  # skip adelanto

        # --- Detectar capacidad ociosa y adelantar del dia siguiente ---
        if task_idx + 1 >= len(ordered_tasks):
            continue  # ultimo dia, no hay dia siguiente

        summary = results[day_name]["summary"]
        plantilla = day_params["plantilla"]
        block_hc = summary.get("block_hc", [])
        time_blocks = day_params["time_blocks"]

        # Calcular horas-hombre ociosas (bloques productivos solamente)
        idle_hh = 0
        for b_idx, tb in enumerate(time_blocks):
            if tb["minutes"] <= 0:
                continue
            if b_idx < len(block_hc):
                used_hc = block_hc[b_idx]
                idle_hh += max(0, plantilla - used_hc) * (tb["minutes"] / 60)

        print(f"    [ADELANTO] {day_name}: HC ocioso = {idle_hh:.1f} horas-hombre")

        # Si hay al menos 3 horas-hombre ociosas, vale la pena adelantar
        if idle_hh < 3:
            continue

        next_day_name, (next_models, next_params) = ordered_tasks[task_idx + 1]
        print(f"    [ADELANTO] Intentando adelantar modelos de {next_day_name}...")

        # Seleccionar modelos del dia siguiente que se pueden adelantar.
        # Priorizar modelos que YA estan en el dia actual (mismas operaciones,
        # robots ya configurados) para minimizar cambios.
        current_codes = {m["codigo"] for m in models_day}
        adelanto_models = []
        step = day_params.get("lot_step", 100)

        # Robots reservados por bloque en el schedule principal
        reserved_robots_map = {}  # {robot_name: set(block_indices)}
        for entry in results[day_name].get("schedule", []):
            for r in entry.get("robots_used", []) or []:
                if not r:
                    continue
                bp = entry.get("block_pares", [])
                for b_idx, p in enumerate(bp):
                    if p > 0:
                        reserved_robots_map.setdefault(r, set()).add(b_idx)

        for nm in next_models:
            code = nm["codigo"]
            credit = adelanto_credits.get(code, 0)
            pares_available = nm["pares_dia"] - credit
            if pares_available <= 0:
                continue

            model_data = model_lookup.get(code)
            if not model_data:
                continue

            # Excluir operaciones MAQUILA
            internal_ops = [
                op for op in model_data["operations"]
                if op.get("recurso") != "MAQUILA"
            ]
            if not internal_ops:
                continue

            # Sin limite fijo — adelantar todo lo que quepa en las horas ociosas
            max_adelanto = pares_available
            # Redondear al step
            max_adelanto = (max_adelanto // step) * step
            if max_adelanto <= 0:
                continue

            priority = 0 if code in current_codes else 1  # primero los que ya corren hoy
            adelanto_models.append((priority, code, nm, max_adelanto, internal_ops))

        adelanto_models.sort(key=lambda t: t[0])

        if not adelanto_models:
            continue

        # Construir models_day para 2da pasada: modelos originales + adelantos
        # Los modelos originales mantienen sus pares (ya resueltos), pero para
        # la 2da pasada solo corremos los adelantos como un schedule_day aparte.
        adelanto_day = []
        hh_budget = idle_hh * 3600  # convertir a segundos
        for _, code, nm, max_pares, internal_ops in adelanto_models:
            if hh_budget <= 0:
                break
            # Estimar consumo: usar cuello de botella (op mas lenta) ya que
            # operaciones corren en paralelo. El solver decidira cuanto cabe.
            bottleneck_sec = max(
                (op["sec_per_pair"] for op in internal_ops), default=60
            )
            pares_fit = min(max_pares, int(hh_budget / max(1, bottleneck_sec)))
            pares_fit = (pares_fit // step) * step
            if pares_fit <= 0:
                continue

            adelanto_day.append({
                "codigo": code,
                "fabrica": nm.get("fabrica", ""),
                "suela": nm.get("suela", ""),
                "pares_dia": pares_fit,
                "operations": internal_ops,
            })
            hh_budget -= pares_fit * bottleneck_sec
            print(f"      [ADELANTO] {code}: adelantar {pares_fit}p de {next_day_name}")

        if not adelanto_day:
            continue

        # Correr schedule_day solo con los modelos de adelanto
        try:
            adelanto_result = schedule_day(
                adelanto_day, day_params, compiled,
                reserved_robots=reserved_robots_map if reserved_robots_map else None,
            )
            a_summary = adelanto_result["summary"]
            pares_adelantados = a_summary["total_pares"]
            print(f"    [ADELANTO] Resultado: {pares_adelantados} pares adelantados para {next_day_name}")

            if pares_adelantados > 0:
                # Marcar entradas como adelanto y agregar al schedule del dia
                for entry in adelanto_result["schedule"]:
                    entry["adelanto"] = True
                    entry["adelanto_de"] = next_day_name
                results[day_name]["schedule"].extend(adelanto_result["schedule"])

                # Sumar pares al summary del dia
                results[day_name]["summary"]["total_pares"] += pares_adelantados
                results[day_name]["summary"]["pares_adelantados"] = pares_adelantados

                # Accumulate adelanto production for pipeline cap
                adel_produced = a_summary.get("produced_by_op", {})
                for code_a, op_prod_a in adel_produced.items():
                    if code_a not in cumulative_produced_by_op:
                        cumulative_produced_by_op[code_a] = {}
                    for frac_a, pares_a in op_prod_a.items():
                        cumulative_produced_by_op[code_a][frac_a] = (
                            cumulative_produced_by_op[code_a].get(frac_a, 0) + pares_a
                        )

                # Registrar creditos para descontar del dia siguiente
                for m in adelanto_day:
                    code = m["codigo"]
                    # Buscar cuantos pares realmente se produjeron
                    produced = sum(
                        e["total_pares"] for e in adelanto_result["schedule"]
                        if e["modelo"] == code
                    )

                    if produced > 0:
                        adelanto_credits[code] = adelanto_credits.get(code, 0) + produced

        except Exception as e:
            print(f"    [ADELANTO] Error: {e}")

    # Reordenar por el orden logico de la semana (params["days"])
    ordered = {d: results[d] for d in day_order if d in results}
    return ordered


def _extract_day_schedule(solver, x, y, active, hc_used, robot_ops_idx,
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

            # HC por bloque: leer directamente del solver (entero, no fraccionario)
            hc_block_values = [
                solver.Value(hc_used[m_idx, op_idx, b])
                for b in range(num_blocks)
            ]
            max_hc_val = max(hc_block_values) if hc_block_values else 0

            # Para operaciones con robots, extraer uso por robot POR BLOQUE
            robots_used = []
            robot_per_block = [None] * num_blocks
            if (m_idx, op_idx) in robot_ops_set:
                robots = op.get("robots", [])
                for r in robots:
                    r_pares = sum(
                        solver.Value(y[m_idx, op_idx, r, b])
                        for b in range(num_blocks)
                    )
                    if r_pares > 0:
                        robots_used.append(r)
                # Determinar qué robot se usa en cada bloque
                for b in range(num_blocks):
                    for r in robots:
                        if solver.Value(y[m_idx, op_idx, r, b]) > 0:
                            robot_per_block[b] = r
                            break

            # Si usa multiples robots, generar una fila por robot
            distinct_robots = list(dict.fromkeys(r for r in robot_per_block if r is not None))
            if len(distinct_robots) > 1:
                for robot in distinct_robots:
                    r_block_pares = [
                        block_pares[b] if robot_per_block[b] == robot else 0
                        for b in range(num_blocks)
                    ]
                    r_total = sum(r_block_pares)
                    r_hc = [
                        hc_block_values[b] if robot_per_block[b] == robot else 0
                        for b in range(num_blocks)
                    ]
                    r_max_hc = max(r_hc) if r_hc else 0
                    schedule.append({
                        "modelo": model["codigo"],
                        "fabrica": model["fabrica"],
                        "fraccion": op["fraccion"],
                        "operacion": op["operacion"],
                        "recurso": op["recurso"],
                        "rate": op["rate"],
                        "hc": r_max_hc,
                        "block_pares": r_block_pares,
                        "total_pares": r_total,
                        "hc_per_block": r_hc,
                        "robots_used": [robot],
                        "robot_per_block": [robot if robot_per_block[b] == robot else None for b in range(num_blocks)],
                        "robots_eligible": op.get("robots", []),
                        "hc_multiplier": op.get("max_hc", 1),
                    })
            else:
                schedule.append({
                    "modelo": model["codigo"],
                    "fabrica": model["fabrica"],
                    "fraccion": op["fraccion"],
                    "operacion": op["operacion"],
                    "recurso": op["recurso"],
                    "rate": op["rate"],
                    "hc": max_hc_val,
                    "block_pares": block_pares,
                    "total_pares": total_pares,
                    "hc_per_block": hc_block_values,
                    "robots_used": robots_used,
                    "robot_per_block": robot_per_block,
                    "robots_eligible": op.get("robots", []),
                    "hc_multiplier": op.get("max_hc", 1),
                })

    # Validar exclusividad de robots post-solve
    robot_block_owner = {}  # (robot, block) -> (modelo, fraccion, operacion)
    conflicts = []
    for entry in schedule:
        rpb = entry.get("robot_per_block", [])
        for b, r in enumerate(rpb):
            if r is None:
                continue
            key = (r, b)
            owner = (entry["modelo"], entry["fraccion"], entry["operacion"])
            if key in robot_block_owner:
                prev = robot_block_owner[key]
                conflicts.append(f"  CONFLICTO robot {r} bloque {b}: "
                                 f"{prev[0]} F{prev[1]} ({prev[2]}) vs "
                                 f"{owner[0]} F{owner[1]} ({owner[2]})")
            else:
                robot_block_owner[key] = owner
    if conflicts:
        print(f"  [ROBOT VALIDATION] {len(conflicts)} conflictos detectados:")
        for c in conflicts:
            print(c)
    else:
        print(f"  [ROBOT VALIDATION] OK - sin conflictos de robots")

    # Ordenar por modelo, fraccion
    schedule.sort(key=lambda r: (r["modelo"], r["fraccion"]))
    return schedule


def _build_day_summary(solver, x, tardiness, overproduction, models_day,
                        time_blocks, plantilla, resource_cap, status,
                        op_tardiness=None):
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

    # Tardiness por modelo y total
    tardiness_by_model = {}
    total_tard = 0
    for m_idx, model in enumerate(models_day):
        t = solver.Value(tardiness[m_idx])
        total_tard += t
        if t > 0:
            tardiness_by_model[model["codigo"]] = t

    # Overproduction por modelo y total (pares extra para completar bloques al rate)
    overproduction_by_model = {}
    total_over = 0
    for m_idx, model in enumerate(models_day):
        o = solver.Value(overproduction[m_idx])
        total_over += o
        if o > 0:
            overproduction_by_model[model["codigo"]] = o

    # Per-op completion tracking: which ops completed for multi-day pipeline rezago
    # completed_ops_by_model: {codigo: [op_indices that completed]}
    # remaining_ops_by_model: {codigo: [op_indices still pending]}
    completed_ops_by_model = {}
    remaining_ops_by_model = {}
    if op_tardiness:
        for m_idx, model in enumerate(models_day):
            code = model["codigo"]
            completed = []
            remaining = []
            for op_idx in range(len(model["operations"])):
                ot = solver.Value(op_tardiness[m_idx, op_idx])
                if ot == 0:
                    completed.append(op_idx)
                else:
                    remaining.append(op_idx)
            if completed and remaining:
                # Partial completion: some ops done, some pending
                completed_ops_by_model[code] = completed
                remaining_ops_by_model[code] = remaining
                print(f"    [PIPELINE] {code}: completed ops {completed}, "
                      f"remaining ops {remaining}")

    # Per-op production tracking: actual pairs produced per operation (for cross-day pipeline cap)
    produced_by_op = {}  # {codigo: {fraccion: pares_produced}}
    for m_idx, model in enumerate(models_day):
        code = model["codigo"]
        op_production = {}
        for op_idx, op in enumerate(model["operations"]):
            total_op_pares = sum(solver.Value(x[m_idx, op_idx, b]) for b in range(num_blocks))
            frac = op.get("fraccion", op_idx)
            op_production[frac] = total_op_pares
        if op_production:
            produced_by_op[code] = op_production

    # Pares totales (reales producidos = pares_dia - tardiness + overproduction)
    total_pares = sum(m["pares_dia"] for m in models_day) - total_tard + total_over

    return {
        "status": solver.StatusName(status),
        "total_pares": total_pares,
        "total_tardiness": total_tard,
        "tardiness_by_model": tardiness_by_model,
        "total_overproduction": total_over,
        "overproduction_by_model": overproduction_by_model,
        "plantilla": plantilla,
        "block_hc": block_hc,
        "block_pares": block_pares,
        "block_labels": [tb["label"] for tb in time_blocks],
        "completed_ops_by_model": completed_ops_by_model,
        "remaining_ops_by_model": remaining_ops_by_model,
        "produced_by_op": produced_by_op,
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
