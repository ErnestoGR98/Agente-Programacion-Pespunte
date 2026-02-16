"""
operator_assignment.py - Asignacion de operarios en cascada (post-proceso).

Algoritmo secuencial por bloques (0..9):
  1. Libera operarios cuya tarea ya termino (ultimo bloque activo < bloque actual)
  2. Asigna operarios libres a tareas sin operario que tengan pares en este bloque
  3. Al asignar, el operario se COMPROMETE a TODA la tarea restante
     -> NO puede tomar otra tarea hasta que termine la actual

REGLA FUNDAMENTAL: un operario NUNCA tiene dos tareas simultaneas.
Cascada = operario termina tarea A, queda libre, toma tarea B.
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
            _commit_operator(task, b, num_blocks, op_states, robot_usage)

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

def _commit_operator(task, start_block, num_blocks, op_states, robot_usage):
    """
    Busca un operario libre y lo COMPROMETE a toda la tarea restante.
    El operario queda ocupado desde start_block hasta el ultimo bloque activo.
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
    # Span completo: operario ocupado desde start_block hasta last_active
    # (incluyendo huecos intermedios donde el optimizer puso 0 pares)
    span_blocks = list(range(start_block, last_active + 1))

    # Buscar candidatos
    candidates = []
    for op_id, op_st in op_states.items():
        if op_st["current_task"] is not None:
            continue  # OCUPADO - no puede tomar otra tarea
        if recurso not in op_st["recursos"]:
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
            # Ya trabajo pero tiene gap: priorizar para cerrar el hueco
            gap = start_block - op_st["prev_end_block"] - 1
            score += 150 - gap * 10  # menor gap = mayor puntaje
        elif start_block > 0:
            score -= 50   # fresco entrando tarde: penalizar (crea idle al inicio)
        if op_st["prev_modelo"] == task["modelo"]:
            score += 50   # continuidad de modelo
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

    # Reservar robot para todo el span
    if best_robot:
        if best_robot not in robot_usage:
            robot_usage[best_robot] = set()
        robot_usage[best_robot].update(span_blocks)


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
    """Convierte schedule del optimizer en tareas asignables."""
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
            "block_pares": list(block_pares),
            "total_pares": total,
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
    Esto evita que parezca que un operario hace dos cosas a la vez.
    """
    task_by_idx = {t["schedule_idx"]: t for t in tasks}
    augmented = []

    for i, entry in enumerate(day_schedule):
        task = task_by_idx.get(i)
        if not task:
            aug = dict(entry)
            aug["operario"] = ""
            aug["robot_asignado"] = ""
            aug["pendiente"] = 0
            augmented.append(aug)
            continue

        num_bp = len(entry.get("block_pares", []))
        pendiente = task["pares_dia_modelo"] - task["total_pares"]

        # Agrupar bloques activos por operario
        op_groups = {}  # {op_name: {"blocks": {idx: pares}, "robot": str}}
        for b in range(num_bp):
            bp = task["block_pares"][b] if b < num_bp else 0
            if bp <= 0:
                continue
            ba = task["block_assignments"].get(b)
            op_name = ba["op_name"] if ba else "SIN ASIGNAR"
            robot = (ba.get("robot") or "") if ba else ""
            if op_name not in op_groups:
                op_groups[op_name] = {"blocks": {}, "robot": robot}
            op_groups[op_name]["blocks"][b] = bp
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
