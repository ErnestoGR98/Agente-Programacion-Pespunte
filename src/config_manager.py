"""
config_manager.py - Configuracion persistida en JSON.

Maneja la configuracion del sistema que antes estaba hardcodeada:
  - Robots fisicos y aliases
  - Capacidades por tipo de recurso
  - Lista de fabricas
  - Dias de la semana con plantilla y overtime
"""

import json
from pathlib import Path

CONFIG_PATH = Path(__file__).parent.parent / "data" / "config.json"


def get_default_config() -> dict:
    """Retorna la configuracion por defecto (valores actuales hardcodeados)."""
    return {
        "supabase": {
            "url": "",
            "anon_key": "",
        },
        "llm": {
            "api_key": "",
            "model": "claude-sonnet-4-5-20250929",
        },
        "robots": {
            "physical": [
                "2A-3020-M1", "2A-3020-M2", "3020-M4", "3020-M6",
                "6040-M4", "6040-M5", "CHACHE 048", "CHACHE 049",
            ],
            "aliases": {
                "3020 M-4": "3020-M4",
                "6040-M5 (PARCIAL)": "6040-M5",
            },
        },
        "resource_capacity": {
            "MESA": 15,
            "ROBOT": 8,
            "PLANA": 8,
            "POSTE": 6,
            "MAQUILA": 1,
            "GENERAL": 10,
        },
        "optimizer_params": {
            "lote_minimo": 50,
            "lote_preferido": 100,
            "factor_eficiencia": 0.90,
            "factor_contiguidad": 0.80,
            "timeout_solver": 90,
            "lead_time_maquila": 3,
        },
        "fabricas": ["FABRICA 1", "FABRICA 2", "FABRICA 3"],
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


def load_config() -> dict:
    """Carga config desde JSON. Si no existe, crea con defaults."""
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            saved = json.load(f)
        # Merge con defaults para campos nuevos que no existan en el JSON guardado
        defaults = get_default_config()
        for key in defaults:
            if key not in saved:
                saved[key] = defaults[key]
        # Migrar tipos compuestos de recurso a tipos base
        if _migrate_resource_capacity(saved):
            save_config(saved)
        return saved

    # Primera vez: crear con defaults
    config = get_default_config()
    save_config(config)
    return config


_COMPOUND_TO_BASE = {
    "MESA-LINEA": "MESA",
    "PLANA-LINEA": "PLANA",
    "POSTE-LINEA": "POSTE",
}


def _migrate_resource_capacity(config: dict) -> bool:
    """Migra tipos compuestos de recurso a tipos base. Retorna True si migro."""
    cap = config.get("resource_capacity", {})
    migrated = False
    for compound, base in _COMPOUND_TO_BASE.items():
        if compound in cap:
            cap.pop(compound)
            migrated = True
    # Asegurar que existan los tipos base
    defaults = get_default_config()["resource_capacity"]
    for key, val in defaults.items():
        if key not in cap:
            cap[key] = val
            migrated = True
    if migrated:
        config["resource_capacity"] = cap
    return migrated


def save_config(config: dict):
    """Guarda config a JSON."""
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)


def get_physical_robots(config: dict = None) -> list:
    """Retorna lista de robots fisicos."""
    if config is None:
        config = load_config()
    return config["robots"]["physical"]


def get_robot_aliases(config: dict = None) -> dict:
    """Retorna aliases de robots."""
    if config is None:
        config = load_config()
    return config["robots"]["aliases"]


def get_fabricas(config: dict = None) -> list:
    """Retorna lista de fabricas."""
    if config is None:
        config = load_config()
    return config["fabricas"]


def get_resource_capacity(config: dict = None) -> dict:
    """Retorna capacidades por recurso."""
    if config is None:
        config = load_config()
    return config["resource_capacity"]
