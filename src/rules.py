"""
rules.py - Parametros de configuracion del sistema de pespunte.

Define la estructura de bloques horarios y recursos que alimentan al
optimizador semanal (Iter 1) y al scheduler diario (Iter 2).

Los valores configurables (robots, capacidades, dias, plantillas) se
leen desde data/config.json via config_manager.py.

Constantes que no cambian (bloques horarios, tipos de recurso, aliases
de parseo) permanecen aqui.
"""

from __future__ import annotations
from copy import deepcopy
from config_manager import load_config


# Fallback hardcodeado (solo se usa si no hay horarios en DB)
_DEFAULT_TIME_BLOCKS = [
    {"id": 0,  "label": "8-9",    "minutes": 60},
    {"id": 1,  "label": "9-10",   "minutes": 60},
    {"id": 2,  "label": "10-11",  "minutes": 60},
    {"id": 3,  "label": "11-12",  "minutes": 60},
    {"id": 4,  "label": "12-1",   "minutes": 60},
    {"id": 5,  "label": "1-2",    "minutes": 60},
    {"id": 6,  "label": "COMIDA", "minutes": 0},
    {"id": 7,  "label": "3-4",    "minutes": 60},
    {"id": 8,  "label": "4-5",    "minutes": 60},
    {"id": 9,  "label": "5-6",    "minutes": 60},
]
TIME_BLOCKS = _DEFAULT_TIME_BLOCKS  # backward compat


def _hour_label(h24: int) -> str:
    """Convierte hora 24h a label legible: 8, 9..12, 1, 2..."""
    return str(h24 if h24 <= 12 else h24 - 12)


def generate_time_blocks(entrada: str, salida: str,
                          comida_inicio: str | None = None,
                          comida_fin: str | None = None,
                          bloque_min: int = 60) -> list[dict]:
    """Genera bloques horarios a partir de horario configurable.

    Args:
        entrada: hora de entrada "HH:MM" (ej "08:00")
        salida:  hora de salida  "HH:MM" (ej "18:00")
        comida_inicio: inicio comida "HH:MM" o None
        comida_fin:    fin comida    "HH:MM" o None
        bloque_min: duracion de cada bloque en minutos (default 60)

    Returns:
        Lista de dicts [{id, label, minutes}, ...] incluyendo COMIDA (0 min).
    """
    def to_min(t: str) -> int:
        parts = t.split(":")
        return int(parts[0]) * 60 + int(parts[1])

    start = to_min(entrada)
    end = to_min(salida)
    comida_s = to_min(comida_inicio) if comida_inicio else None
    comida_e = to_min(comida_fin) if comida_fin else None

    blocks = []
    cursor = start
    idx = 0
    while cursor < end:
        # Insertar COMIDA si toca
        if comida_s is not None and comida_e is not None and cursor == comida_s:
            blocks.append({"id": idx, "label": "COMIDA", "minutes": 0})
            idx += 1
            cursor = comida_e
            continue

        block_end = cursor + bloque_min
        # Si el bloque cae dentro de la comida, cortarlo
        if comida_s is not None and cursor < comida_s < block_end:
            block_end = comida_s

        h_start = cursor // 60
        h_end = block_end // 60
        label = f"{_hour_label(h_start)}-{_hour_label(h_end)}"
        blocks.append({"id": idx, "label": label, "minutes": block_end - cursor})
        idx += 1
        cursor = block_end

    return blocks

# Tipos de recurso canonicos (categorias fisicas fijas)
RESOURCE_TYPES = ["MESA", "ROBOT", "PLANA", "POSTE", "MAQUILA"]

# Configuraciones validas (informativas, no afectan optimizacion)
CONFIGURACION_OPTIONS = ["LINEA", "INDIVIDUAL", ""]

# Aliases para parseo de Excel (logica de normalizacion fija)
RESOURCE_ALIASES = {
    # Legacy: tipos compuestos -> tipo base
    "MESA-LINEA": "MESA",
    "PLANA-LINEA": "PLANA",
    "POSTE-LINEA": "POSTE",
    "MESA LINEA": "MESA",
    "PLANA LINEA": "PLANA",
    "POSTE LINEA": "POSTE",
    # Typos
    "MEZA": "MESA",
    "ROBBOT": "ROBOT",
}


def _get_config():
    """Carga config una vez (cache en modulo no es necesario, JSON es rapido)."""
    return load_config()


# Propiedades que leen de config.json
def get_resource_capacity():
    """Retorna capacidades por recurso desde config."""
    return _get_config()["resource_capacity"].copy()


def get_physical_robots():
    """Retorna lista de robots fisicos desde config."""
    return _get_config()["robots"]["physical"]


# Acceso directo para compatibilidad con codigo existente
# Se evaluan al importar; re-importar el modulo recarga de config.json
DEFAULT_RESOURCE_CAPACITY = get_resource_capacity()
PHYSICAL_ROBOTS = get_physical_robots()


def get_default_params() -> dict:
    """
    Retorna los parametros para la semana, leyendo de config.json.

    Returns:
        dict con claves 'days', 'time_blocks', 'resource_capacity', etc.
    """
    config = _get_config()
    opt = config.get("optimizer_params", {})
    return {
        "min_lot_size": opt.get("lote_minimo", 100),
        "lot_step": 50,
        "time_blocks": TIME_BLOCKS,
        "resource_types": RESOURCE_TYPES,
        "resource_capacity": config["resource_capacity"].copy(),
        "days": deepcopy(config["days"]),
        "lead_time_maquila": opt.get("lead_time_maquila", 3),
    }
