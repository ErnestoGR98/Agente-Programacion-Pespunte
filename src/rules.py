"""
rules.py - Parametros de configuracion del sistema de pespunte.

Define la estructura de dias, plantilla, bloques horarios y recursos
que alimentan al optimizador semanal (Iter 1) y al scheduler diario (Iter 2).

Cada dia tiene dos tiers de capacidad:
  - Regular: plantilla * minutes (sin penalizacion extra)
  - Overtime: plantilla_ot * minutes_ot (penalizado, solo si se necesita)

Bloques horarios (Iter 2):
  10 bloques por dia, con pausa de comida entre 1:10 y 1:50.
"""


# Bloques horarios del dia (columnas 27-36 en programa diario)
TIME_BLOCKS = [
    {"id": 0, "label": "8-9",     "minutes": 60},
    {"id": 1, "label": "9-10",    "minutes": 60},
    {"id": 2, "label": "10-11",   "minutes": 60},
    {"id": 3, "label": "11-12",   "minutes": 60},
    {"id": 4, "label": "12-1:10", "minutes": 70},
    {"id": 5, "label": "1:50-3",  "minutes": 70},
    {"id": 6, "label": "3-4",     "minutes": 60},
    {"id": 7, "label": "4-5",     "minutes": 60},
    {"id": 8, "label": "5-6",     "minutes": 60},
    {"id": 9, "label": "6-7",     "minutes": 60},
]

# Tipos de recurso canonicos y su mapeo de variantes
RESOURCE_TYPES = ["MESA", "ROBOT", "PLANA", "POSTE-LINEA", "MESA-LINEA", "PLANA-LINEA"]

RESOURCE_ALIASES = {
    "MESA LINEA": "MESA-LINEA",
    "PLANA LINEA": "PLANA-LINEA",
    "POSTE LINEA": "POSTE-LINEA",
    "MEZA": "MESA",
    "ROBBOT": "ROBOT",
}

# Capacidad por tipo de recurso (personas o maquinas disponibles simultaneamente)
# Estos son valores iniciales estimados; se calibraran con datos reales
DEFAULT_RESOURCE_CAPACITY = {
    "MESA": 15,         # mesas de trabajo manuales (muchas disponibles)
    "ROBOT": 8,         # total de robots (ahora manejado por restricciones individuales)
    "PLANA": 8,         # maquinas planas
    "POSTE-LINEA": 6,   # postes de linea
    "MESA-LINEA": 10,   # mesas de linea
    "PLANA-LINEA": 8,   # planas de linea
    "GENERAL": 10,
}

# Robots fisicos individuales con capacidad 1 cada uno
# Cada robot puede procesar una sola fraccion a la vez
PHYSICAL_ROBOTS = [
    "2A-3020-M1",
    "2A-3020-M2",
    "3020-M4",
    "3020-M6",
    "6040-M4",
    "6040-M5",
    "CHACHE 048",
    "CHACHE 049",
]


def get_default_params() -> dict:
    """
    Retorna los parametros por defecto para la semana.

    Returns:
        dict con claves 'days', 'time_blocks', 'resource_capacity', etc.
    """
    return {
        "min_lot_size": 100,
        "lot_step": 50,
        "time_blocks": TIME_BLOCKS,
        "resource_types": RESOURCE_TYPES,
        "resource_capacity": DEFAULT_RESOURCE_CAPACITY.copy(),
        "days": [
            {
                "name": "Sab",
                "minutes": 300,
                "plantilla": 10,
                "minutes_ot": 120,
                "plantilla_ot": 15,
                "is_saturday": True,
            },
            {
                "name": "Lun",
                "minutes": 540,
                "plantilla": 17,
                "minutes_ot": 60,
                "plantilla_ot": 17,
                "is_saturday": False,
            },
            {
                "name": "Mar",
                "minutes": 540,
                "plantilla": 17,
                "minutes_ot": 60,
                "plantilla_ot": 17,
                "is_saturday": False,
            },
            {
                "name": "Mie",
                "minutes": 540,
                "plantilla": 17,
                "minutes_ot": 60,
                "plantilla_ot": 17,
                "is_saturday": False,
            },
            {
                "name": "Jue",
                "minutes": 540,
                "plantilla": 17,
                "minutes_ot": 60,
                "plantilla_ot": 17,
                "is_saturday": False,
            },
            {
                "name": "Vie",
                "minutes": 540,
                "plantilla": 17,
                "minutes_ot": 60,
                "plantilla_ot": 17,
                "is_saturday": False,
            },
        ],
    }
