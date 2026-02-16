"""
rules.py - Parametros de configuracion del sistema de pespunte.

Define la estructura de bloques horarios y recursos que alimentan al
optimizador semanal (Iter 1) y al scheduler diario (Iter 2).

Los valores configurables (robots, capacidades, dias, plantillas) se
leen desde data/config.json via config_manager.py.

Constantes que no cambian (bloques horarios, tipos de recurso, aliases
de parseo) permanecen aqui.
"""

from copy import deepcopy
from config_manager import load_config


# Bloques horarios del dia (columnas 27-36 en programa diario)
# Esto es el horario fisico de la fabrica - no cambia
TIME_BLOCKS = [
    {"id": 0,  "label": "8-9",    "minutes": 60},
    {"id": 1,  "label": "9-10",   "minutes": 60},
    {"id": 2,  "label": "10-11",  "minutes": 60},
    {"id": 3,  "label": "11-12",  "minutes": 60},
    {"id": 4,  "label": "12-1",   "minutes": 60},
    {"id": 5,  "label": "1-2",    "minutes": 60},
    {"id": 6,  "label": "COMIDA", "minutes": 0},   # 2:00-3:00 (visual, 0 cap)
    {"id": 7,  "label": "3-4",    "minutes": 60},
    {"id": 8,  "label": "4-5",    "minutes": 60},
    {"id": 9,  "label": "5-6",    "minutes": 60},
    {"id": 10, "label": "6-7",    "minutes": 60},
]

# Tipos de recurso canonicos (categorias fisicas fijas)
RESOURCE_TYPES = ["MESA", "ROBOT", "PLANA", "POSTE-LINEA", "MESA-LINEA", "PLANA-LINEA"]

# Aliases para parseo de Excel (logica de normalizacion fija)
RESOURCE_ALIASES = {
    "MESA LINEA": "MESA-LINEA",
    "PLANA LINEA": "PLANA-LINEA",
    "POSTE LINEA": "POSTE-LINEA",
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
    return {
        "min_lot_size": 100,
        "lot_step": 50,
        "time_blocks": TIME_BLOCKS,
        "resource_types": RESOURCE_TYPES,
        "resource_capacity": config["resource_capacity"].copy(),
        "days": deepcopy(config["days"]),
    }
