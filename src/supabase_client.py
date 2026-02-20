"""
supabase_client.py - Conexion a Supabase.

Lee credenciales de config.json (campo "supabase") o variables de entorno.
Uso:
    from supabase_client import get_client
    sb = get_client()
    sb.table("robots").select("*").execute()
"""

import os
from functools import lru_cache

from supabase import create_client, Client


def _load_credentials() -> tuple[str, str]:
    """Carga URL y key de Supabase desde config.json o env vars."""
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_KEY", "")

    if url and key:
        return url, key

    # Fallback: leer de config.json
    try:
        from config_manager import load_config
        config = load_config()
        sb_cfg = config.get("supabase", {})
        url = sb_cfg.get("url", "")
        key = sb_cfg.get("anon_key", "")
    except Exception:
        pass

    if not url or not key:
        raise ValueError(
            "Supabase no configurado. Agrega SUPABASE_URL y SUPABASE_KEY "
            "como variables de entorno o en config.json -> supabase.url / supabase.anon_key"
        )

    return url, key


@lru_cache(maxsize=1)
def get_client() -> Client:
    """Retorna un cliente Supabase singleton."""
    url, key = _load_credentials()
    return create_client(url, key)


def reset_client():
    """Limpia el cache del cliente (util si cambian credenciales)."""
    get_client.cache_clear()
