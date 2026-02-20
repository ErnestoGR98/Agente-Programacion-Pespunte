"""
operator_assignment.py - Asignacion de operarios en cascada + relevo (post-proceso).

FASE 1 - Cascada secuencial por bloques (0..9):
  1. Libera operarios cuya tarea ya termino (ultimo bloque activo < bloque actual)
  2. Asigna operarios libres a tareas sin operario que tengan pares en este bloque
  3. Al asignar, el operario se COMPROMETE a TODA la tarea restante
     -> NO puede tomar otra tarea hasta que termine la actual

FASE 2 - Relevo (post-cascada):
  Para tareas que quedaron SIN ASIGNAR (ningun operario con el recurso correcto):
  1. Busca op idle A que pueda hacer la tarea T_B de op ocupado B
  2. Si B puede hacer la tarea sin asignar U: A releva a B en T_B, B toma U
  Ejemplo: HUGO (MESA) releva a DIANA (MESA+PLANA) en su tarea
           MESA, liberando a DIANA para hacer la tarea PLANA sin asignar.

REGLA FUNDAMENTAL: un operario NUNCA tiene dos tareas simultaneas.
Cascada = operario termina tarea A, queda libre, toma tarea B.
Relevo = operario idle toma tarea de operario ocupado, liberandolo para otra.
"""


# ---------------------------------------------------------------------------
# API publica
# ---------------------------------------------------------------------------

def assign_operators_week(daily_results: dict, operarios: list,
                          time_blocks: list) -> dict:
    """Ejecuta cascada para cada dia de la semana."""
    results = {}
    for day_name, day_data in daily_results.items():
        schedule = day_data.get("schedule", [])
        if not schedule:
            continue
        results[day_name] = assign_operators_day(
            schedule, operarios, day_name, time_blocks
        )
    return results


def assign_operators_day(day_schedule: list, operarios: list,
                         day_name: str, time_blocks: list) -> dict:
    """Asigna operarios a un dia usando cascada secuencial por bloques."""
    warnings = []
    num_blocks = len(time_blocks)

    # 1. Filtrar operarios disponibles
    available = _filter_available(operarios, day_name)
    if not available:
        warnings.append(f"No hay operarios disponibles para {day_name}")
        return _empty_result(day_schedule)

    # 2. Construir tareas desde el schedule del optimizer
    tasks = _build_tasks(day_schedule, num_blocks)
    _compute_eligibility(tasks, available)

    # 3. Estado por operario
    op_states = {}
    for op in available:
        op_id = op.get("id", op.get("nombre", ""))
        op_states[op_id] = {
            "id": op_id,
            "nombre": op.get("nombre", ""),
            "recursos": set(op.get("recursos_habilitados", [])),
            "robots": set(op.get("robots_habilitados", [])),
            "eficiencia": op.get("eficiencia", 1.0),
            "current_task": None,     # tarea actual (referencia)
            "task_end_block": -1,     # ultimo bloque activo de tarea actual
            "prev_end_block": -1,     # para score de cascada
            "prev_modelo": None,      # para score de continuidad
        }
    robot_usage = {}  # {robot_name: set(bloques reservados)}
    op_block_map = {}  # {op_nombre: set(bloques asignados)} - previene doble asignacion

    # ===================================================================
    # CASCADA: bloque por bloque, secuencial
    # ===================================================================
    for b in range(num_blocks):
        # --- Liberar operarios cuya tarea ya termino ---
        for op_st in op_states.values():
            if op_st["current_task"] is not None and op_st["task_end_block"] < b:
                op_st["prev_end_block"] = op_st["task_end_block"]
                op_st["prev_modelo"] = op_st["current_task"]["modelo"]
                op_st["current_task"] = None
                op_st["task_end_block"] = -1

        # --- Tareas que necesitan operario en este bloque ---
        needy = []
        for task in tasks:
            bp = task["block_pares"][b] if b < len(task["block_pares"]) else 0
            if bp <= 0:
                continue
            if b in task["block_assignments"]:
                continue  # ya tiene operario
            needy.append(task)

        # Prioridad: menos elegibles primero (MRV), luego fraccion
        needy.sort(key=lambda t: (t["eligible_count"], t["fraccion"]))

        # --- Asignar un operario libre a cada tarea ---
        for task in needy:
            _commit_operator(task, b, num_blocks, op_states, robot_usage,
                             op_block_map)

    # ===================================================================
    # RELEVO: reasignar operarios via intercambio (post-cascada)
    # ===================================================================
    _relay_pass(tasks, op_states, num_blocks, robot_usage, op_block_map)

    # ===================================================================
    # VALIDACION: eliminar asignaciones dobles (safety net)
    # ===================================================================
    _validate_no_overlap(tasks, num_blocks)

    # Marcar bloques activos sin operario como SIN ASIGNAR
    for task in tasks:
        for bl in range(num_blocks):
            bp = task["block_pares"][bl] if bl < len(task["block_pares"]) else 0
            if bp > 0 and bl not in task["block_assignments"]:
                task["block_assignments"][bl] = {
                    "op_name": "SIN ASIGNAR", "pares": bp, "robot": None,
                }

    # 4. Construir salida
    assignments = _build_augmented_schedule(day_schedule, tasks)
    timelines = _build_operator_timelines(tasks, time_blocks)
    unassigned = _collect_unassigned(tasks, num_blocks)

    return {
        "assignments": assignments,
        "operator_timelines": timelines,
        "unassigned": unassigned,
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# Asignacion con compromiso total
# ---------------------------------------------------------------------------

def _commit_operator(task, start_block, num_blocks, op_states, robot_usage,
                     op_block_map):
    """
    Busca un operario libre y lo COMPROMETE a toda la tarea restante.
    El operario queda ocupado desde start_block hasta el ultimo bloque activo.
    Usa op_block_map para verificar que no haya doble asignacion.
    """
    recurso = task["recurso"]
    robots_needed = task["robots_available"]

    # Bloques activos restantes (desde start_block)
    remaining_active = [
        fb for fb in range(start_block, num_blocks)
        if fb < len(task["block_pares"]) and task["block_pares"][fb] > 0
    ]
    if not remaining_active:
        return

    last_active = max(remaining_active)
    span_blocks = list(range(start_block, last_active + 1))

    # Buscar candidatos
    candidates = []
    for op_id, op_st in op_states.items():
        if op_st["current_task"] is not None:
            continue  # OCUPADO - no puede tomar otra tarea
        if recurso not in op_st["recursos"]:
            continue

        # Verificar que no tenga bloques ocupados (doble asignacion)
        used = op_block_map.get(op_st["nombre"], set())
        if used.intersection(remaining_active):
            continue

        # Verificar robot si es necesario
        robot = None
        if robots_needed:
            robot = _find_robot(op_st, robots_needed, robot_usage, span_blocks)
            if robot is None:
                continue

        # Scoring: priorizar operarios que ya trabajaron para evitar huecos
        score = 0
        if op_st["prev_end_block"] == start_block - 1:
            score += 200  # cascada perfecta: recien liberado, sin hueco
        elif op_st["prev_end_block"] >= 0:
            gap = start_block - op_st["prev_end_block"] - 1
            score += 150 - gap * 10
        elif start_block > 0:
            score -= 50
        if op_st["prev_modelo"] == task["modelo"]:
            score += 50
        score += int(op_st["eficiencia"] * 10)

        candidates.append((score, op_id, robot))

    if not candidates:
        return  # nadie disponible, quedara SIN ASIGNAR

    candidates.sort(key=lambda c: -c[0])
    _, best_op_id, best_robot = candidates[0]
    op_st = op_states[best_op_id]

    # === COMPROMISO: operario toma toda la tarea restante ===
    op_st["current_task"] = task
    op_st["task_end_block"] = last_active

    task["assigned_op"] = best_op_id
    task["assigned_op_name"] = op_st["nombre"]
    task["assigned_robot"] = best_robot

    for fb in remaining_active:
        task["block_assignments"][fb] = {
            "op_name": op_st["nombre"],
            "pares": task["block_pares"][fb],
            "robot": best_robot,
        }

    # Registrar bloques usados
    op_block_map.setdefault(op_st["nombre"], set()).update(remaining_active)

    # Reservar robot para todo el span
    if best_robot:
        if best_robot not in robot_usage:
            robot_usage[best_robot] = set()
        robot_usage[best_robot].update(span_blocks)


# ---------------------------------------------------------------------------
# Relevo (Fase 2 post-cascada)
# ---------------------------------------------------------------------------

def _relay_pass(tasks, op_states, num_blocks, robot_usage, op_block_map):
    """
    Fase 2: relevo — reasigna operarios via intercambio para reducir SIN ASIGNAR.

    Si op idle A puede hacer tarea T_B de op ocupado B, y B puede hacer tarea
    sin asignar U: A releva a B en T_B, B toma U.
    Usa op_block_map para prevenir doble asignacion.
    """
    pending = []
    for task in tasks:
        ua = [
            b for b in range(num_blocks)
            if (task["block_pares"][b] if b < len(task["block_pares"]) else 0) > 0
            and b not in task["block_assignments"]
        ]
        if ua:
            pending.append(task)

    if not pending:
        return

    # MRV: menos elegibles primero
    pending.sort(key=lambda t: (t["eligible_count"], t["fraccion"]))

    for task_u in pending:
        # Recalcular bloques sin asignar (relevos previos pueden haber resuelto)
        ua_blocks = [
            b for b in range(num_blocks)
            if (task_u["block_pares"][b] if b < len(task_u["block_pares"]) else 0) > 0
            and b not in task_u["block_assignments"]
        ]
        if not ua_blocks:
            continue

        relay_b = ua_blocks[0]
        recurso_u = task_u["recurso"]
        robots_u = task_u["robots_available"]

        remaining_u = [b for b in ua_blocks if b >= relay_b]
        if not remaining_u:
            continue
        last_u = max(remaining_u)
        span_u = list(range(relay_b, last_u + 1))

        # Liberar operarios cuya tarea termino antes de relay_b
        for op_st in op_states.values():
            if op_st["current_task"] is not None and op_st["task_end_block"] < relay_b:
                op_st["prev_end_block"] = op_st["task_end_block"]
                op_st["prev_modelo"] = op_st["current_task"]["modelo"]
                op_st["current_task"] = None
                op_st["task_end_block"] = -1

        # --- Asignacion directa (red de seguridad post-cascada) ---
        direct_done = False
        for op_id, op_st in op_states.items():
            if op_st["current_task"] is not None:
                continue
            if recurso_u not in op_st["recursos"]:
                continue
            # Verificar no overlap
            used = op_block_map.get(op_st["nombre"], set())
            if used.intersection(remaining_u):
                continue
            robot = None
            if robots_u:
                robot = _find_robot(op_st, robots_u, robot_usage, span_u)
                if robot is None:
                    continue
            op_st["current_task"] = task_u
            op_st["task_end_block"] = last_u
            for fb in remaining_u:
                task_u["block_assignments"][fb] = {
                    "op_name": op_st["nombre"],
                    "pares": task_u["block_pares"][fb],
                    "robot": robot,
                }
            op_block_map.setdefault(op_st["nombre"], set()).update(remaining_u)
            if robot:
                robot_usage.setdefault(robot, set()).update(span_u)
            direct_done = True
            break

        if direct_done:
            continue

        # --- Buscar pares (idle, busy) factibles para relevo ---
        relay_candidates = []
        for idle_id, idle_st in op_states.items():
            if idle_st["current_task"] is not None:
                continue
            for busy_id, busy_st in op_states.items():
                if busy_st["current_task"] is None:
                    continue
                if busy_st["task_end_block"] < relay_b:
                    continue

                task_b = busy_st["current_task"]
                recurso_b = task_b["recurso"]

                # idle puede hacer tarea de busy?
                if recurso_b not in idle_st["recursos"]:
                    continue
                # busy puede hacer tarea sin asignar?
                if recurso_u not in busy_st["recursos"]:
                    continue

                # Bloques de B en task_b desde relay_b (calcular PRIMERO)
                remaining_b = [
                    fb for fb in range(relay_b, num_blocks)
                    if fb < len(task_b["block_pares"])
                    and task_b["block_pares"][fb] > 0
                    and task_b["block_assignments"].get(fb, {}).get(
                        "op_name") == busy_st["nombre"]
                ]
                if not remaining_b:
                    continue

                # Verificar que idle no tenga overlap con bloques de task_b
                idle_used = op_block_map.get(idle_st["nombre"], set())
                if idle_used.intersection(remaining_b):
                    continue

                # Verificar que busy no tenga overlap con task_u
                # EXCLUIR remaining_b porque esos bloques se liberan en el relevo
                busy_used = op_block_map.get(busy_st["nombre"], set())
                busy_after_relay = busy_used - set(remaining_b)
                if busy_after_relay.intersection(remaining_u):
                    continue

                score = int(busy_st["eficiencia"] * 10)
                if busy_st.get("prev_modelo") == task_u["modelo"]:
                    score += 50
                relay_candidates.append(
                    (score, idle_id, busy_id, task_b, remaining_b))

        relay_candidates.sort(key=lambda c: -c[0])

        for _, idle_id, busy_id, task_b, remaining_b in relay_candidates:
            idle_st = op_states[idle_id]
            busy_st = op_states[busy_id]
            last_b = max(remaining_b)
            span_b = list(range(relay_b, last_b + 1))
            robots_b = task_b["robots_available"]
            old_robot = task_b.get("assigned_robot")

            # Liberar temporalmente robot de B desde relay_b
            released = set()
            if old_robot and old_robot in robot_usage:
                for fb in span_b:
                    if fb in robot_usage[old_robot]:
                        robot_usage[old_robot].discard(fb)
                        released.add(fb)

            robot_for_idle = None
            if robots_b:
                robot_for_idle = _find_robot(
                    idle_st, robots_b, robot_usage, span_b)
                if robot_for_idle is None:
                    if old_robot:
                        robot_usage.setdefault(old_robot, set()).update(
                            released)
                    continue

            robot_for_busy = None
            if robots_u:
                robot_for_busy = _find_robot(
                    busy_st, robots_u, robot_usage, span_u)
                if robot_for_busy is None:
                    if old_robot:
                        robot_usage.setdefault(old_robot, set()).update(
                            released)
                    continue

            # === EJECUTAR RELEVO ===

            # 1. Quitar B de task_b y actualizar op_block_map
            for fb in remaining_b:
                if fb in task_b["block_assignments"]:
                    del task_b["block_assignments"][fb]
            busy_blocks = op_block_map.get(busy_st["nombre"], set())
            busy_blocks -= set(remaining_b)

            # 2. idle toma task_b desde relay_b
            idle_st["current_task"] = task_b
            idle_st["task_end_block"] = last_b
            for fb in remaining_b:
                task_b["block_assignments"][fb] = {
                    "op_name": idle_st["nombre"],
                    "pares": task_b["block_pares"][fb],
                    "robot": robot_for_idle,
                }
            op_block_map.setdefault(idle_st["nombre"], set()).update(
                remaining_b)
            if robot_for_idle:
                robot_usage.setdefault(robot_for_idle, set()).update(span_b)

            # 3. B toma task_u desde relay_b
            busy_st["prev_end_block"] = relay_b - 1
            busy_st["prev_modelo"] = task_b["modelo"]
            busy_st["current_task"] = task_u
            busy_st["task_end_block"] = last_u
            for fb in remaining_u:
                task_u["block_assignments"][fb] = {
                    "op_name": busy_st["nombre"],
                    "pares": task_u["block_pares"][fb],
                    "robot": robot_for_busy,
                }
            op_block_map.setdefault(busy_st["nombre"], set()).update(
                remaining_u)
            if robot_for_busy:
                robot_usage.setdefault(robot_for_busy, set()).update(span_u)

            break  # Relevo ejecutado, pasar a siguiente tarea


# ---------------------------------------------------------------------------
# Validacion anti-overlap
# ---------------------------------------------------------------------------

def _validate_no_overlap(tasks, num_blocks):
    """Safety net: elimina asignaciones dobles de operarios en el mismo bloque.

    Itera tareas en orden (prioridad implicita). Si un operario ya esta
    asignado en un bloque por otra tarea, se elimina la asignacion duplicada
    (quedara como SIN ASIGNAR en el paso siguiente).
    """
    # {op_name: set(bloques ya ocupados)}
    seen = {}
    for task in tasks:
        for b in range(num_blocks):
            ba = task["block_assignments"].get(b)
            if not ba or ba.get("op_name") == "SIN ASIGNAR":
                continue
            op_name = ba["op_name"]
            if op_name not in seen:
                seen[op_name] = set()
            if b in seen[op_name]:
                # CONFLICTO: este operario ya tiene otra tarea en este bloque
                del task["block_assignments"][b]
            else:
                seen[op_name].add(b)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _filter_available(operarios, day_name):
    """Filtra operarios activos y disponibles para el dia."""
    result = []
    day_prefix = day_name.split()[0] if day_name else ""
    for op in operarios:
        if not op.get("activo", True):
            continue
        dias = op.get("dias_disponibles", [])
        if not dias:
            result.append(op)
            continue
        for d in dias:
            if d == day_name or day_name.startswith(d) or d.startswith(day_prefix):
                result.append(op)
                break
    return result


def _build_tasks(day_schedule, num_blocks):
    """Convierte schedule del optimizer en tareas asignables.

    Si una entry tiene hc_multiplier=2 (cuello de botella), se crean
    2 tareas con la mitad de block_pares cada una para que la cascada
    asigne 2 operarios trabajando en simultaneo.
    """
    tasks = []
    model_totals = {}
    for entry in day_schedule:
        model_totals[entry["modelo"]] = (
            model_totals.get(entry["modelo"], 0) + entry.get("total_pares", 0)
        )

    for i, entry in enumerate(day_schedule):
        block_pares = entry.get("block_pares", [0] * num_blocks)
        total = entry.get("total_pares", 0)
        if total <= 0:
            continue

        first_block = num_blocks
        last_block = -1
        for b in range(num_blocks):
            bp = block_pares[b] if b < len(block_pares) else 0
            if bp > 0:
                first_block = min(first_block, b)
                last_block = max(last_block, b)
        if first_block >= num_blocks:
            continue

        hc_mult = entry.get("hc_multiplier", 1)
        copies = hc_mult if hc_mult > 1 else 1

        for copy_idx in range(copies):
            if copies == 2:
                # Dividir pares entre las 2 copias
                if copy_idx == 0:
                    bp_copy = [p // 2 for p in block_pares]
                else:
                    bp_copy = [p - p // 2 for p in block_pares]
                total_copy = sum(bp_copy)
            else:
                bp_copy = list(block_pares)
                total_copy = total

            tasks.append({
                "schedule_idx": i,
                "modelo": entry["modelo"],
                "fabrica": entry.get("fabrica", ""),
                "fraccion": entry.get("fraccion", 0),
                "operacion": entry.get("operacion", ""),
                "recurso": entry.get("recurso", "GENERAL"),
                "rate": entry.get("rate", 100),
                "hc": entry.get("hc", 1),
                "robots_available": entry.get("robots_eligible",
                                              entry.get("robots_used", [])),
                "block_pares": bp_copy,
                "total_pares": total_copy,
                "pares_dia_modelo": model_totals.get(entry["modelo"], total),
                "first_block": first_block,
                "last_block": last_block,
                "eligible_count": 999,
                "assigned_op": None,
                "assigned_op_name": None,
                "assigned_robot": None,
                "block_assignments": {},
            })
    return tasks


def _compute_eligibility(tasks, available_ops):
    """Cuenta operarios elegibles por tarea (MRV = Most Restricted Variable)."""
    for task in tasks:
        count = 0
        recurso = task["recurso"]
        robots = task["robots_available"]
        for op in available_ops:
            recursos_op = set(op.get("recursos_habilitados", []))
            if recurso not in recursos_op:
                continue
            if robots:
                robots_op = set(op.get("robots_habilitados", []))
                if not robots_op.intersection(robots):
                    continue
            count += 1
        task["eligible_count"] = count if count > 0 else 999


def _find_robot(op_state, robots_needed, robot_usage, blocks):
    """Busca un robot que el operario pueda usar y este libre en los bloques."""
    available = op_state["robots"].intersection(robots_needed)
    for r in available:
        used = robot_usage.get(r, set())
        if not used.intersection(blocks):
            return r
    return None


def _build_augmented_schedule(day_schedule, tasks):
    """Aumenta schedule con info de operario.

    Si un operario solo trabaja PARTE de los bloques de una tarea
    (cascada mid-task), la fila se divide: una fila por segmento de operario.
    Soporta multiples tasks por schedule_idx (hc_multiplier=2).
    """
    # Agrupar tasks por schedule_idx (puede haber 2 si hc_multiplier=2)
    tasks_by_idx = {}
    for t in tasks:
        idx = t["schedule_idx"]
        if idx not in tasks_by_idx:
            tasks_by_idx[idx] = []
        tasks_by_idx[idx].append(t)
    augmented = []

    for i, entry in enumerate(day_schedule):
        task_list = tasks_by_idx.get(i)
        if not task_list:
            aug = dict(entry)
            aug["operario"] = ""
            aug["robot_asignado"] = ""
            aug["pendiente"] = 0
            augmented.append(aug)
            continue

        num_bp = len(entry.get("block_pares", []))
        pendiente = task_list[0]["pares_dia_modelo"] - sum(
            t["total_pares"] for t in task_list)

        # Agrupar bloques activos por operario (fusiona todas las tasks del entry)
        op_groups = {}  # {op_name: {"blocks": {idx: pares}, "robot": str}}
        for task in task_list:
            for b in range(num_bp):
                bp = task["block_pares"][b] if b < len(task["block_pares"]) else 0
                if bp <= 0:
                    continue
                ba = task["block_assignments"].get(b)
                op_name = ba["op_name"] if ba else "SIN ASIGNAR"
                robot = (ba.get("robot") or "") if ba else ""
                if op_name not in op_groups:
                    op_groups[op_name] = {"blocks": {}, "robot": robot}
                op_groups[op_name]["blocks"][b] = (
                    op_groups[op_name]["blocks"].get(b, 0) + bp)
                if robot:
                    op_groups[op_name]["robot"] = robot

        if len(op_groups) <= 1:
            # Caso simple: un solo operario (o todos SIN ASIGNAR)
            aug = dict(entry)
            op_name = next(iter(op_groups), "SIN ASIGNAR")
            aug["operario"] = op_name
            aug["robot_asignado"] = op_groups[op_name]["robot"] if op_groups else ""
            aug["pendiente"] = pendiente
            augmented.append(aug)
        else:
            # Caso cascada: dividir en una fila por operario
            # Orden: operarios nombrados primero, SIN ASIGNAR al final
            sorted_ops = sorted(
                op_groups.keys(),
                key=lambda n: (1 if n == "SIN ASIGNAR" else 0, n),
            )
            for op_name in sorted_ops:
                info = op_groups[op_name]
                aug = dict(entry)
                # Reemplazar block_pares con solo los bloques de este operario
                new_bp = [0] * num_bp
                for b, p in info["blocks"].items():
                    new_bp[b] = p
                aug["block_pares"] = new_bp
                aug["total_pares"] = sum(info["blocks"].values())
                aug["operario"] = op_name
                aug["robot_asignado"] = info.get("robot", "")
                aug["pendiente"] = pendiente
                augmented.append(aug)

    return augmented


def _build_operator_timelines(tasks, time_blocks):
    """Timeline por operario para vista cascada."""
    timelines = {}
    num_blocks = len(time_blocks)
    for task in tasks:
        for b in range(num_blocks):
            ba = task["block_assignments"].get(b)
            if not ba or ba["pares"] <= 0:
                continue
            op_name = ba["op_name"]
            if op_name == "SIN ASIGNAR":
                continue
            if op_name not in timelines:
                timelines[op_name] = []
            timelines[op_name].append({
                "block": b,
                "label": time_blocks[b]["label"] if b < len(time_blocks) else f"B{b}",
                "modelo": task["modelo"],
                "fraccion": task["fraccion"],
                "operacion": task["operacion"],
                "recurso": task["recurso"],
                "pares": ba["pares"],
                "robot": ba.get("robot") or "",
            })
    for name in timelines:
        timelines[name].sort(key=lambda e: e["block"])
    return timelines


def _collect_unassigned(tasks, num_blocks):
    """Tareas/bloques que quedaron sin operario asignado.

    Incluye tanto tareas completamente sin asignar como bloques parciales
    donde el operario aun no habia llegado (cascada mid-task).
    """
    unassigned = []
    for t in tasks:
        active = [
            b for b in range(num_blocks)
            if (t["block_pares"][b] if b < len(t["block_pares"]) else 0) > 0
        ]
        if not active:
            continue
        sin_blocks = [
            b for b in active
            if t["block_assignments"].get(b, {}).get("op_name") == "SIN ASIGNAR"
        ]
        if not sin_blocks:
            continue
        pares_sin = sum(
            t["block_pares"][b] for b in sin_blocks
        )
        unassigned.append({
            "modelo": t["modelo"],
            "fraccion": t["fraccion"],
            "operacion": t["operacion"],
            "recurso": t["recurso"],
            "total_pares": pares_sin,
            "parcial": len(sin_blocks) < len(active),
        })
    return unassigned


def _empty_result(day_schedule):
    """Resultado cuando no hay operarios disponibles."""
    augmented = []
    for entry in day_schedule:
        aug = dict(entry)
        aug["operario"] = "SIN ASIGNAR"
        aug["robot_asignado"] = ""
        aug["pendiente"] = 0
        augmented.append(aug)
    return {
        "assignments": augmented,
        "operator_timelines": {},
        "unassigned": [
            {
                "modelo": e["modelo"],
                "fraccion": e.get("fraccion", 0),
                "operacion": e.get("operacion", ""),
                "recurso": e.get("recurso", ""),
                "total_pares": e.get("total_pares", 0),
            }
            for e in day_schedule
        ],
        "warnings": ["No hay operarios disponibles"],
    }
