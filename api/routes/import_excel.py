"""
Endpoint de importacion de Excel.

Parsea archivos Excel (catalogo, pedido, template consolidado)
y guarda los datos en Supabase.
"""

import os
import tempfile
import requests
from fastapi import APIRouter, UploadFile, File, HTTPException

from dashboard.data_manager import (
    _parse_catalogo_sheet,
    _parse_pedido_sheet,
)

router = APIRouter()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")


def _sb_headers(prefer="return=representation"):
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


def _sb_get(table, query=""):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}?{query}", headers=_sb_headers())
    r.raise_for_status()
    return r.json()


def _sb_post(table, data):
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{table}", headers=_sb_headers(), json=data)
    r.raise_for_status()
    result = r.json()
    return result[0] if isinstance(result, list) and result else result


def _sb_upsert(table, data, on_conflict=""):
    headers = _sb_headers(prefer="return=representation,resolution=merge-duplicates")
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{table}", headers=headers, json=data)
    r.raise_for_status()
    result = r.json()
    return result[0] if isinstance(result, list) and result else result


def _sb_delete(table, query):
    r = requests.delete(
        f"{SUPABASE_URL}/rest/v1/{table}?{query}",
        headers=_sb_headers(),
    )
    r.raise_for_status()


@router.post("/import-catalog")
async def import_catalog(file: UploadFile = File(...)):
    """Importa catalogo desde Excel y guarda en Supabase."""
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Solo se aceptan archivos Excel (.xlsx)")

    # Guardar archivo temporal
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Parsear usando la funcion existente de data_manager
        catalogo = _parse_catalogo_sheet(tmp_path)
        if not catalogo:
            raise HTTPException(400, "No se encontraron modelos en el archivo")

        # Obtener mapa de robots
        robots = _sb_get("robots", "select=id,nombre")
        robot_map = {r["nombre"]: r["id"] for r in robots}

        saved = 0
        for modelo_num, data in catalogo.items():
            # Upsert modelo
            modelo_row = _sb_upsert("catalogo_modelos", {
                "modelo_num": modelo_num,
                "codigo_full": data.get("codigo_full", modelo_num),
                "alternativas": data.get("alternativas", []),
                "clave_material": data.get("clave_material", ""),
                "total_sec_per_pair": data.get("total_sec_per_pair", 0),
                "num_ops": len(data.get("operations", [])),
            })
            modelo_id = modelo_row["id"]

            # Borrar operaciones viejas
            _sb_delete("catalogo_operaciones", f"modelo_id=eq.{modelo_id}")

            # Insertar operaciones nuevas
            for op in data.get("operations", []):
                op_row = _sb_post("catalogo_operaciones", {
                    "modelo_id": modelo_id,
                    "fraccion": op["fraccion"],
                    "operacion": op["operacion"],
                    "input_o_proceso": op.get("input_o_proceso", "PRELIMINARES"),
                    "etapa": op.get("etapa", ""),
                    "recurso": op["recurso"],
                    "recurso_raw": op.get("recurso_raw", ""),
                    "rate": op.get("rate", 0),
                    "sec_per_pair": op.get("sec_per_pair", 0),
                })

                # Insertar robots
                for rname in op.get("robots", []):
                    rid = robot_map.get(rname)
                    if rid:
                        _sb_post("catalogo_operacion_robots", {
                            "operacion_id": op_row["id"],
                            "robot_id": rid,
                        })

            saved += 1

        return {"modelos_importados": saved, "total_operaciones": sum(
            len(d.get("operations", [])) for d in catalogo.values()
        )}

    finally:
        os.unlink(tmp_path)


@router.post("/import-pedido/{nombre}")
async def import_pedido(nombre: str, file: UploadFile = File(...)):
    """Importa pedido desde Excel y guarda en Supabase."""
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Solo se aceptan archivos Excel (.xlsx)")

    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        items = _parse_pedido_sheet(tmp_path)
        if not items:
            raise HTTPException(400, "No se encontraron items en el archivo")

        # Upsert cabecera
        ped = _sb_upsert("pedidos", {"nombre": nombre})
        ped_id = ped["id"]

        # Borrar items viejos
        _sb_delete("pedido_items", f"pedido_id=eq.{ped_id}")

        # Insertar nuevos
        for it in items:
            _sb_post("pedido_items", {
                "pedido_id": ped_id,
                "modelo_num": it["modelo"],
                "color": it.get("color", ""),
                "clave_material": it.get("clave_material", ""),
                "fabrica": it.get("fabrica", ""),
                "volumen": it["volumen"],
            })

        return {"nombre": nombre, "items_importados": len(items)}

    finally:
        os.unlink(tmp_path)
