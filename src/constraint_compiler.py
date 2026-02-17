"""
constraint_compiler.py - Traduce restricciones del usuario a parametros del optimizer.

El compilador convierte restricciones genericas (JSON) + avance de produccion
en un objeto CompiledConstraints que los optimizadores consumen directamente.

Patron extensible: cada tipo de restriccion tiene un handler en _HANDLERS.
Agregar un tipo nuevo = escribir 1 funcion + registrarla.
"""

from dataclasses import dataclass, field

# Hora de inicio de cada bloque horario (h, m) -> block index
# Debe coincidir con TIME_BLOCKS en rules.py
_BLOCK_START_TIMES = [
    (8, 0),    # block 0: 8-9
    (9, 0),    # block 1: 9-10
    (10, 0),   # block 2: 10-11
    (11, 0),   # block 3: 11-12
    (12, 0),   # block 4: 12-1
    (13, 0),   # block 5: 1-2
    (14, 0),   # block 6: COMIDA (2-3)
    (15, 0),   # block 7: 3-4
    (16, 0),   # block 8: 4-5
    (17, 0),   # block 9: 5-6
    (18, 0),   # block 10: 6-7
]


def _hour_to_first_block(hora_str: str) -> int:
    """Convierte 'HH:MM' a indice del primer bloque disponible.

    Retorna el indice del primer bloque cuya hora de inicio >= hora_str.
    Ej: '10:00' -> 2 (bloque 10-11 es el primero permitido).
    """
    parts = hora_str.split(":")
    h = int(parts[0])
    m = int(parts[1]) if len(parts) > 1 else 0
    target_min = h * 60 + m
    for idx, (bh, bm) in enumerate(_BLOCK_START_TIMES):
        block_start_min = bh * 60 + bm
        if block_start_min >= target_min:
            return idx
    return len(_BLOCK_START_TIMES)


@dataclass
class CompiledConstraints:
    """Restricciones pre-procesadas listas para el optimizer."""

    # {modelo_num: float} - multiplicador de W_TARDINESS (default 1.0)
    tardiness_weights: dict = field(default_factory=dict)

    # {modelo_num: set_de_indices_dias} - dias permitidos para producir
    day_availability: dict = field(default_factory=dict)

    # [(idx_modelo_antes, idx_modelo_despues)] - secuencias obligatorias
    sequences: list = field(default_factory=list)

    # set de indices de dias congelados (ya tienen avance > 0)
    frozen_days: set = field(default_factory=set)

    # {modelo_num: {dia: pares}} - avance ya producido
    avance: dict = field(default_factory=dict)

    # {modelo_num: pares_a_maquila} - para restar del volumen
    maquila: dict = field(default_factory=dict)

    # {modelo_num: nuevo_volumen} - override de volumen
    volume_overrides: dict = field(default_factory=dict)

    # {(modelo_num, day_name): set_de_block_indices} - bloques permitidos en un dia
    # Solo se usa cuando hay hora especifica (ej: material llega a las 10am)
    block_availability: dict = field(default_factory=dict)

    # {robot_name: {day_name: set_de_block_indices}} - robots deshabilitados
    disabled_robots: dict = field(default_factory=dict)

    # {day_name: int} - ajuste acumulado a plantilla (negativo = ausencias)
    plantilla_adjustments: dict = field(default_factory=dict)

    # {day_name: int} - override absoluto de plantilla
    plantilla_overrides: dict = field(default_factory=dict)

    # {modelo_num: int} - indice del dia limite (deadline)
    deadlines: dict = field(default_factory=dict)

    # [(idx_modelo_a, idx_modelo_b)] - modelos que deben producirse juntos
    model_groups: list = field(default_factory=list)

    # {modelo_num: int} - override de lote minimo por modelo
    lot_min_overrides: dict = field(default_factory=dict)

    # [(modelo, frac_origen, frac_destino, buffer_pares)]
    # Precedencia entre operaciones: origen debe llevar buffer pares de ventaja
    operation_precedences: list = field(default_factory=list)

    # Warnings generados durante compilacion
    warnings: list = field(default_factory=list)


def compile_constraints(restricciones: list, avance_data: dict,
                        models: list, days: list) -> CompiledConstraints:
    """
    Compila restricciones + avance en parametros del optimizer.

    Args:
        restricciones: lista de dicts de restricciones.json
        avance_data: dict de avance.json (puede ser vacio)
        models: matched_models con modelo_num, total_producir, etc.
        days: lista de day configs [{name, ...}]

    Returns:
        CompiledConstraints listo para pasar a optimize() y schedule_week()
    """
    cc = CompiledConstraints()

    day_names = [d["name"] for d in days]
    day_index = {name: i for i, name in enumerate(day_names)}
    model_nums = {m.get("modelo_num", m.get("codigo", "")) for m in models}
    model_idx_by_num = {}
    for i, m in enumerate(models):
        num = m.get("modelo_num", m.get("codigo", ""))
        model_idx_by_num[num] = i

    # Procesar restricciones activas
    active = [r for r in restricciones if r.get("activa", True)]
    for r in active:
        tipo = r.get("tipo", "")
        modelo = r.get("modelo", "*")
        params = r.get("parametros", {})

        handler = _HANDLERS.get(tipo)
        if handler:
            handler(cc, modelo, params, day_names, day_index,
                    model_nums, model_idx_by_num)
        else:
            cc.warnings.append(
                f"Tipo de restriccion desconocido: '{tipo}' (id={r.get('id', '?')})")

    # Procesar avance
    if avance_data and avance_data.get("modelos"):
        _apply_avance(cc, avance_data, model_nums, day_names, day_index)

    return cc


# ---------------------------------------------------------------------------
# Handlers por tipo de restriccion
# ---------------------------------------------------------------------------

def _handle_prioridad(cc, modelo, params, day_names, day_index,
                      model_nums, model_idx_by_num):
    if modelo not in model_nums:
        cc.warnings.append(f"PRIORIDAD: modelo '{modelo}' no esta en el pedido")
        return
    peso = params.get("peso", 1)
    multiplier = {1: 1.0, 2: 2.0, 3: 5.0}.get(peso, 1.0)
    cc.tardiness_weights[modelo] = multiplier


def _handle_maquila(cc, modelo, params, day_names, day_index,
                    model_nums, model_idx_by_num):
    if modelo not in model_nums:
        cc.warnings.append(f"MAQUILA: modelo '{modelo}' no esta en el pedido")
        return
    pares = params.get("pares_maquila", 0)
    if pares > 0:
        cc.maquila[modelo] = pares


def _handle_retraso_material(cc, modelo, params, day_names, day_index,
                             model_nums, model_idx_by_num):
    if modelo not in model_nums:
        cc.warnings.append(f"RETRASO_MATERIAL: modelo '{modelo}' no esta en el pedido")
        return
    desde = params.get("disponible_desde", "")
    if desde not in day_index:
        cc.warnings.append(f"RETRASO_MATERIAL: dia '{desde}' no valido")
        return
    desde_idx = day_index[desde]
    allowed = set(range(desde_idx, len(day_names)))
    if modelo in cc.day_availability:
        cc.day_availability[modelo] &= allowed
    else:
        cc.day_availability[modelo] = allowed

    # Hora opcional: si se especifica, en el dia 'desde' solo permite bloques
    # a partir de esa hora (bloques anteriores quedan bloqueados)
    hora = params.get("hora_disponible", "")
    if hora:
        first_block = _hour_to_first_block(hora)
        num_blocks = len(_BLOCK_START_TIMES)
        allowed_blocks = set(range(first_block, num_blocks))
        cc.block_availability[(modelo, desde)] = allowed_blocks


def _handle_fijar_dia(cc, modelo, params, day_names, day_index,
                      model_nums, model_idx_by_num):
    if modelo not in model_nums:
        cc.warnings.append(f"FIJAR_DIA: modelo '{modelo}' no esta en el pedido")
        return
    dias = params.get("dias", [])
    modo = params.get("modo", "PERMITIR")
    if modo == "PERMITIR":
        allowed = {day_index[d] for d in dias if d in day_index}
    else:
        excluded = {day_index[d] for d in dias if d in day_index}
        allowed = set(range(len(day_names))) - excluded
    if modelo in cc.day_availability:
        cc.day_availability[modelo] &= allowed
    else:
        cc.day_availability[modelo] = allowed


def _handle_secuencia(cc, modelo, params, day_names, day_index,
                      model_nums, model_idx_by_num):
    antes = params.get("modelo_antes", "")
    despues = params.get("modelo_despues", "")
    if antes not in model_idx_by_num:
        cc.warnings.append(f"SECUENCIA: modelo '{antes}' no esta en el pedido")
        return
    if despues not in model_idx_by_num:
        cc.warnings.append(f"SECUENCIA: modelo '{despues}' no esta en el pedido")
        return
    cc.sequences.append((model_idx_by_num[antes], model_idx_by_num[despues]))


def _handle_ajuste_volumen(cc, modelo, params, day_names, day_index,
                           model_nums, model_idx_by_num):
    if modelo not in model_nums:
        cc.warnings.append(f"AJUSTE_VOLUMEN: modelo '{modelo}' no esta en el pedido")
        return
    nuevo = params.get("nuevo_volumen", 0)
    cc.volume_overrides[modelo] = nuevo


# --- Frecuentes (operativas) ---

def _handle_robot_no_disponible(cc, modelo, params, day_names, day_index,
                                 model_nums, model_idx_by_num):
    robot = params.get("robot", "")
    if not robot:
        cc.warnings.append("ROBOT_NO_DISPONIBLE: no se especifico robot")
        return
    dias = params.get("dias", list(day_names))
    all_blocks = set(range(len(_BLOCK_START_TIMES)))
    for dia in dias:
        if dia in day_index:
            if robot not in cc.disabled_robots:
                cc.disabled_robots[robot] = {}
            cc.disabled_robots[robot][dia] = all_blocks


def _handle_ausencia_operario(cc, modelo, params, day_names, day_index,
                               model_nums, model_idx_by_num):
    dia = params.get("dia", "")
    if dia not in day_index:
        cc.warnings.append(f"AUSENCIA_OPERARIO: dia '{dia}' no valido")
        return
    cantidad = params.get("cantidad", 1)
    cc.plantilla_adjustments[dia] = cc.plantilla_adjustments.get(dia, 0) - cantidad


def _handle_capacidad_dia(cc, modelo, params, day_names, day_index,
                           model_nums, model_idx_by_num):
    dia = params.get("dia", "")
    if dia not in day_index:
        cc.warnings.append(f"CAPACIDAD_DIA: dia '{dia}' no valido")
        return
    nueva_plantilla = params.get("nueva_plantilla", 0)
    if nueva_plantilla > 0:
        cc.plantilla_overrides[dia] = nueva_plantilla


# --- Menos frecuentes (negocio) ---

def _handle_fecha_limite(cc, modelo, params, day_names, day_index,
                          model_nums, model_idx_by_num):
    if modelo not in model_nums:
        cc.warnings.append(f"FECHA_LIMITE: modelo '{modelo}' no esta en el pedido")
        return
    dia_limite = params.get("dia_limite", "")
    if dia_limite not in day_index:
        cc.warnings.append(f"FECHA_LIMITE: dia '{dia_limite}' no valido")
        return
    deadline_idx = day_index[dia_limite]
    # Restringir a dias hasta el deadline (inclusive)
    allowed = set(range(0, deadline_idx + 1))
    if modelo in cc.day_availability:
        cc.day_availability[modelo] &= allowed
    else:
        cc.day_availability[modelo] = allowed
    cc.deadlines[modelo] = deadline_idx
    # Aumentar peso de tardiness para que el deadline sea casi-duro
    cc.tardiness_weights[modelo] = max(
        cc.tardiness_weights.get(modelo, 1.0), 10.0
    )


def _handle_agrupar_modelos(cc, modelo, params, day_names, day_index,
                             model_nums, model_idx_by_num):
    modelo_a = params.get("modelo_a", "")
    modelo_b = params.get("modelo_b", "")
    if modelo_a not in model_idx_by_num:
        cc.warnings.append(f"AGRUPAR_MODELOS: modelo '{modelo_a}' no esta en el pedido")
        return
    if modelo_b not in model_idx_by_num:
        cc.warnings.append(f"AGRUPAR_MODELOS: modelo '{modelo_b}' no esta en el pedido")
        return
    cc.model_groups.append((model_idx_by_num[modelo_a], model_idx_by_num[modelo_b]))


def _handle_lote_minimo(cc, modelo, params, day_names, day_index,
                         model_nums, model_idx_by_num):
    if modelo not in model_nums:
        cc.warnings.append(f"LOTE_MINIMO_CUSTOM: modelo '{modelo}' no esta en el pedido")
        return
    nuevo_min = params.get("lote_minimo", 50)
    cc.lot_min_overrides[modelo] = nuevo_min


def _handle_precedencia_operacion(cc, modelo, params, day_names, day_index,
                                   model_nums, model_idx_by_num):
    """Precedencia entre operaciones (fracciones) del mismo modelo.

    Fuerza que fraccion_origen lleve al menos buffer_pares de ventaja
    acumulativa sobre fraccion_destino en cada bloque horario.
    Buffer=0 implica simultaneidad, buffer alto implica desfase temporal.
    """
    if modelo not in model_nums:
        cc.warnings.append(
            f"PRECEDENCIA_OPERACION: modelo '{modelo}' no esta en el pedido")
        return
    frac_origen = params.get("fraccion_origen")
    frac_destino = params.get("fraccion_destino")
    buffer_pares = params.get("buffer_pares", 0)

    if frac_origen is None or frac_destino is None:
        cc.warnings.append(
            "PRECEDENCIA_OPERACION: faltan fraccion_origen o fraccion_destino")
        return
    if frac_origen == frac_destino:
        cc.warnings.append(
            f"PRECEDENCIA_OPERACION: origen y destino iguales ({frac_origen})")
        return

    cc.operation_precedences.append(
        (modelo, int(frac_origen), int(frac_destino), max(0, int(buffer_pares)))
    )


# ---------------------------------------------------------------------------
# Avance
# ---------------------------------------------------------------------------

def _apply_avance(cc, avance_data, model_nums, day_names, day_index):
    """Procesa avance de produccion: congela dias completados, ajusta volumenes."""
    for modelo, day_pairs in avance_data.get("modelos", {}).items():
        if modelo not in model_nums:
            continue
        avance_modelo = {}
        for day_name, pares_done in day_pairs.items():
            if isinstance(pares_done, (int, float)) and pares_done > 0:
                avance_modelo[day_name] = int(pares_done)
                # Congelar este dia para este modelo
                if day_name in day_index:
                    cc.frozen_days.add(day_index[day_name])
        if avance_modelo:
            cc.avance[modelo] = avance_modelo


# ---------------------------------------------------------------------------
# Registro de handlers (extensible)
# ---------------------------------------------------------------------------

_HANDLERS = {
    # Frecuentes
    "PRIORIDAD": _handle_prioridad,
    "RETRASO_MATERIAL": _handle_retraso_material,
    "MAQUILA": _handle_maquila,
    "ROBOT_NO_DISPONIBLE": _handle_robot_no_disponible,
    "AUSENCIA_OPERARIO": _handle_ausencia_operario,
    "CAPACIDAD_DIA": _handle_capacidad_dia,
    # Menos frecuentes
    "FIJAR_DIA": _handle_fijar_dia,
    "FECHA_LIMITE": _handle_fecha_limite,
    "SECUENCIA": _handle_secuencia,
    "AGRUPAR_MODELOS": _handle_agrupar_modelos,
    "AJUSTE_VOLUMEN": _handle_ajuste_volumen,
    "LOTE_MINIMO_CUSTOM": _handle_lote_minimo,
    "PRECEDENCIA_OPERACION": _handle_precedencia_operacion,
}
