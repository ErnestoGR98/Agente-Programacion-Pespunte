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
            "POSTE-LINEA": 6,
            "MESA-LINEA": 10,
            "PLANA-LINEA": 8,
            "GENERAL": 10,
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
        return saved

    # Primera vez: crear con defaults
    config = get_default_config()
    save_config(config)
    return config


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
