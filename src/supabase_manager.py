"""
supabase_manager.py - CRUD para Supabase (equivalente a data_manager.py).

Cada seccion corresponde a una entidad del sistema.
Todas las funciones retornan dicts/listas compatibles con el formato
que el dashboard y los optimizadores esperan.
"""

from supabase_client import get_client


# ============================================================
# HELPERS
# ============================================================

def _sb():
    """Shortcut para el cliente Supabase."""
    return get_client()


def _rows(response) -> list[dict]:
    """Extrae la lista de filas de una respuesta Supabase."""
    return response.data or []


def _first(response) -> dict | None:
    """Extrae la primera fila o None."""
    data = response.data
    return data[0] if data else None


# ============================================================
# ROBOTS
# ============================================================

def get_robots(solo_activos: bool = False) -> list[dict]:
    """Lista robots. Si solo_activos=True, filtra FUERA DE SERVICIO."""
    q = _sb().table("robots").select("*").order("orden")
    if solo_activos:
        q = q.eq("estado", "ACTIVO")
    return _rows(q.execute())


def get_robots_by_area(area: str, solo_activos: bool = True) -> list[dict]:
    """Lista robots de un area especifica."""
    q = _sb().table("robots").select("*").eq("area", area).order("orden")
    if solo_activos:
        q = q.eq("estado", "ACTIVO")
    return _rows(q.execute())


def get_robot_names(solo_activos: bool = True) -> list[str]:
    """Lista solo los nombres de robots (para compatibilidad con rules.py)."""
    robots = get_robots(solo_activos=solo_activos)
    return [r["nombre"] for r in robots]


def upsert_robot(nombre: str, estado: str = "ACTIVO", area: str = "PESPUNTE") -> dict:
    """Crea o actualiza un robot."""
    data = {"nombre": nombre, "estado": estado, "area": area}
    return _first(
        _sb().table("robots").upsert(data, on_conflict="nombre").execute()
    )


def get_robot_aliases() -> dict[str, str]:
    """Retorna {alias: nombre_canonico}."""
    rows = _rows(
        _sb().table("robot_aliases")
        .select("alias, robots(nombre)")
        .execute()
    )
    return {r["alias"]: r["robots"]["nombre"] for r in rows}


# ============================================================
# FABRICAS
# ============================================================

def get_fabricas() -> list[str]:
    """Lista nombres de fabricas."""
    rows = _rows(
        _sb().table("fabricas").select("nombre").order("orden").execute()
    )
    return [r["nombre"] for r in rows]


# ============================================================
# CAPACIDADES DE RECURSO
# ============================================================

def get_resource_capacity() -> dict[str, int]:
    """Retorna {tipo: pares_hora} compatible con rules.py."""
    rows = _rows(
        _sb().table("capacidades_recurso").select("tipo, pares_hora").execute()
    )
    return {r["tipo"]: r["pares_hora"] for r in rows}


def update_resource_capacity(tipo: str, pares_hora: int):
    """Actualiza la capacidad de un tipo de recurso."""
    _sb().table("capacidades_recurso").update(
        {"pares_hora": pares_hora}
    ).eq("tipo", tipo).execute()


# ============================================================
# DIAS LABORALES
# ============================================================

def get_dias_laborales() -> list[dict]:
    """Retorna lista de dias compatible con config.days."""
    rows = _rows(
        _sb().table("dias_laborales").select("*").order("orden").execute()
    )
    return [
        {
            "name": r["nombre"],
            "minutes": r["minutos"],
            "plantilla": r["plantilla"],
            "minutes_ot": r["minutos_ot"],
            "plantilla_ot": r["plantilla_ot"],
            "is_saturday": r["es_sabado"],
        }
        for r in rows
    ]


def update_dia_laboral(nombre: str, **kwargs):
    """Actualiza campos de un dia laboral."""
    field_map = {
        "minutes": "minutos",
        "plantilla": "plantilla",
        "minutes_ot": "minutos_ot",
        "plantilla_ot": "plantilla_ot",
        "is_saturday": "es_sabado",
    }
    data = {}
    for py_key, db_key in field_map.items():
        if py_key in kwargs:
            data[db_key] = kwargs[py_key]
    if data:
        _sb().table("dias_laborales").update(data).eq("nombre", nombre).execute()


# ============================================================
# HORARIOS
# ============================================================

def get_horario(tipo: str = "SEMANA") -> dict:
    """Retorna horario (SEMANA o FINSEMANA)."""
    row = _first(
        _sb().table("horarios").select("*").eq("tipo", tipo).execute()
    )
    if not row:
        return {}
    return {
        "entrada": row["entrada"],
        "salida": row["salida"],
        "comida_inicio": row["comida_inicio"] or "",
        "comida_fin": row["comida_fin"] or "",
        "bloque_min": row["bloque_min"],
    }


# ============================================================
# PESOS Y PARAMETROS
# ============================================================

def get_pesos() -> dict[str, int]:
    """Retorna {nombre: valor} de pesos de priorizacion."""
    rows = _rows(
        _sb().table("pesos_priorizacion").select("nombre, valor").execute()
    )
    return {r["nombre"]: r["valor"] for r in rows}


def update_peso(nombre: str, valor: int):
    _sb().table("pesos_priorizacion").update(
        {"valor": valor}
    ).eq("nombre", nombre).execute()


def get_optimizer_params() -> dict[str, float]:
    """Retorna {nombre: valor} de parametros del optimizador."""
    rows = _rows(
        _sb().table("parametros_optimizacion").select("nombre, valor").execute()
    )
    return {r["nombre"]: float(r["valor"]) for r in rows}


def update_optimizer_param(nombre: str, valor: float):
    _sb().table("parametros_optimizacion").update(
        {"valor": valor}
    ).eq("nombre", nombre).execute()


# ============================================================
# CATALOGO
# ============================================================

def get_catalogo() -> dict:
    """
    Retorna catalogo en formato compatible con data_manager.py:
    {modelo_num: {codigo_full, alternativas, operations: [...], ...}}
    """
    modelos = _rows(
        _sb().table("catalogo_modelos").select("*").execute()
    )

    catalogo = {}
    for m in modelos:
        modelo_id = m["id"]
        modelo_num = m["modelo_num"]

        # Cargar operaciones
        ops_rows = _rows(
            _sb().table("catalogo_operaciones")
            .select("*, catalogo_operacion_robots(robot_id, robots(nombre))")
            .eq("modelo_id", modelo_id)
            .order("fraccion")
            .execute()
        )

        operations = []
        resource_summary = {}
        robots_used = set()
        for op in ops_rows:
            # Extraer robots permitidos
            robot_names = []
            for rel in (op.get("catalogo_operacion_robots") or []):
                rname = rel.get("robots", {}).get("nombre", "")
                if rname:
                    robot_names.append(rname)
                    robots_used.add(rname)

            recurso = op["recurso"]
            resource_summary[recurso] = resource_summary.get(recurso, 0) + 1

            operations.append({
                "fraccion": op["fraccion"],
                "operacion": op["operacion"],
                "input_o_proceso": op["input_o_proceso"],
                "etapa": op["etapa"] or "",
                "recurso": recurso,
                "recurso_raw": op["recurso_raw"] or "",
                "robots": sorted(robot_names),
                "rate": float(op["rate"]),
                "sec_per_pair": op["sec_per_pair"],
            })

        catalogo[modelo_num] = {
            "codigo_full": m["codigo_full"] or modelo_num,
            "alternativas": m["alternativas"] or [],
            "clave_material": m["clave_material"] or "",
            "operations": operations,
            "total_sec_per_pair": m["total_sec_per_pair"] or 0,
            "num_ops": len(operations),
            "resource_summary": resource_summary,
            "robot_ops": resource_summary.get("ROBOT", 0),
            "robots_used": sorted(robots_used),
        }

    return catalogo


def save_catalogo(catalogo: dict):
    """
    Guarda catalogo completo (reemplaza todo).
    Input: dict en formato data_manager.py.
    """
    sb = _sb()

    # Obtener mapa de robots nombre -> id
    robot_map = {r["nombre"]: r["id"] for r in get_robots()}

    for modelo_num, data in catalogo.items():
        # Upsert modelo
        modelo_row = _first(
            sb.table("catalogo_modelos").upsert({
                "modelo_num": modelo_num,
                "codigo_full": data.get("codigo_full", modelo_num),
                "alternativas": data.get("alternativas", []),
                "clave_material": data.get("clave_material", ""),
                "total_sec_per_pair": data.get("total_sec_per_pair", 0),
                "num_ops": len(data.get("operations", [])),
            }, on_conflict="modelo_num").execute()
        )
        modelo_id = modelo_row["id"]

        # Borrar operaciones viejas (cascade borra catalogo_operacion_robots)
        sb.table("catalogo_operaciones").delete().eq(
            "modelo_id", modelo_id
        ).execute()

        # Insertar operaciones nuevas
        for op in data.get("operations", []):
            op_row = _first(
                sb.table("catalogo_operaciones").insert({
                    "modelo_id": modelo_id,
                    "fraccion": op["fraccion"],
                    "operacion": op["operacion"],
                    "input_o_proceso": op.get("input_o_proceso", "PRELIMINARES"),
                    "etapa": op.get("etapa", ""),
                    "recurso": op["recurso"],
                    "recurso_raw": op.get("recurso_raw", ""),
                    "rate": op.get("rate", 0),
                    "sec_per_pair": op.get("sec_per_pair", 0),
                }).execute()
            )

            # Insertar relaciones con robots
            for robot_name in op.get("robots", []):
                robot_id = robot_map.get(robot_name)
                if robot_id:
                    sb.table("catalogo_operacion_robots").insert({
                        "operacion_id": op_row["id"],
                        "robot_id": robot_id,
                    }).execute()


# ============================================================
# MODELO <-> FABRICA
# ============================================================

def get_modelo_fabrica() -> dict[str, list[str]]:
    """Retorna {fabrica: [modelo_nums]} compatible con config.modelo_fabrica."""
    rows = _rows(
        _sb().table("modelo_fabrica")
        .select("catalogo_modelos(modelo_num), fabricas(nombre)")
        .execute()
    )
    result = {}
    for r in rows:
        fab = r["fabricas"]["nombre"]
        mod = r["catalogo_modelos"]["modelo_num"]
        result.setdefault(fab, []).append(mod)
    return result


def set_modelo_fabrica(fabrica_nombre: str, modelo_nums: list[str]):
    """Asigna modelos a una fabrica (reemplaza asignaciones anteriores de esa fabrica)."""
    sb = _sb()

    # Obtener fabrica_id
    fab = _first(
        sb.table("fabricas").select("id").eq("nombre", fabrica_nombre).execute()
    )
    if not fab:
        return
    fab_id = fab["id"]

    # Borrar asignaciones existentes de esta fabrica
    sb.table("modelo_fabrica").delete().eq("fabrica_id", fab_id).execute()

    # Insertar nuevas
    for mn in modelo_nums:
        mod = _first(
            sb.table("catalogo_modelos").select("id").eq("modelo_num", mn).execute()
        )
        if mod:
            sb.table("modelo_fabrica").insert({
                "modelo_id": mod["id"],
                "fabrica_id": fab_id,
            }).execute()


# ============================================================
# OPERARIOS
# ============================================================

def get_operarios() -> list[dict]:
    """Retorna lista de operarios en formato compatible."""
    sb = _sb()
    rows = _rows(
        sb.table("operarios")
        .select("*, fabricas(nombre)")
        .order("nombre")
        .execute()
    )

    result = []
    for r in rows:
        op_id = r["id"]

        # Recursos habilitados
        recursos = _rows(
            sb.table("operario_recursos")
            .select("recurso")
            .eq("operario_id", op_id)
            .execute()
        )

        # Robots habilitados
        robots = _rows(
            sb.table("operario_robots")
            .select("robots(nombre)")
            .eq("operario_id", op_id)
            .execute()
        )

        # Dias disponibles
        dias = _rows(
            sb.table("operario_dias")
            .select("dia")
            .eq("operario_id", op_id)
            .execute()
        )

        result.append({
            "id": op_id,
            "nombre": r["nombre"],
            "fabrica": r.get("fabricas", {}).get("nombre", "") if r.get("fabricas") else "",
            "recursos_habilitados": [x["recurso"] for x in recursos],
            "robots_habilitados": [x["robots"]["nombre"] for x in robots],
            "eficiencia": float(r["eficiencia"]),
            "dias_disponibles": [x["dia"] for x in dias],
            "activo": r["activo"],
        })

    return result


def save_operario(operario: dict) -> dict:
    """Crea o actualiza un operario."""
    sb = _sb()

    # Buscar fabrica_id
    fab_id = None
    if operario.get("fabrica"):
        fab = _first(
            sb.table("fabricas").select("id")
            .eq("nombre", operario["fabrica"]).execute()
        )
        fab_id = fab["id"] if fab else None

    # Upsert operario
    op_data = {
        "nombre": operario["nombre"],
        "fabrica_id": fab_id,
        "eficiencia": operario.get("eficiencia", 1.0),
        "activo": operario.get("activo", True),
    }

    if operario.get("id"):
        # Update existente
        op_row = _first(
            sb.table("operarios").update(op_data)
            .eq("id", operario["id"]).execute()
        )
    else:
        # Insert nuevo
        op_row = _first(
            sb.table("operarios").insert(op_data).execute()
        )

    op_id = op_row["id"]

    # Reemplazar recursos
    sb.table("operario_recursos").delete().eq("operario_id", op_id).execute()
    for rec in operario.get("recursos_habilitados", []):
        sb.table("operario_recursos").insert({
            "operario_id": op_id, "recurso": rec
        }).execute()

    # Reemplazar robots
    sb.table("operario_robots").delete().eq("operario_id", op_id).execute()
    robot_map = {r["nombre"]: r["id"] for r in get_robots()}
    for rname in operario.get("robots_habilitados", []):
        rid = robot_map.get(rname)
        if rid:
            sb.table("operario_robots").insert({
                "operario_id": op_id, "robot_id": rid
            }).execute()

    # Reemplazar dias
    sb.table("operario_dias").delete().eq("operario_id", op_id).execute()
    for dia in operario.get("dias_disponibles", []):
        sb.table("operario_dias").insert({
            "operario_id": op_id, "dia": dia
        }).execute()

    return op_row


def delete_operario(operario_id: str):
    """Elimina un operario (cascade borra recursos, robots, dias)."""
    _sb().table("operarios").delete().eq("id", operario_id).execute()


# ============================================================
# PEDIDOS
# ============================================================

def get_pedidos_list() -> list[str]:
    """Lista nombres de pedidos disponibles."""
    rows = _rows(
        _sb().table("pedidos").select("nombre").order("created_at", desc=True).execute()
    )
    return [r["nombre"] for r in rows]


def get_pedido(nombre: str) -> list[dict]:
    """Carga items de un pedido por nombre."""
    ped = _first(
        _sb().table("pedidos").select("id").eq("nombre", nombre).execute()
    )
    if not ped:
        return []

    items = _rows(
        _sb().table("pedido_items").select("*").eq("pedido_id", ped["id"]).execute()
    )
    return [
        {
            "modelo": it["modelo_num"],
            "color": it["color"],
            "clave_material": it.get("clave_material", ""),
            "fabrica": it.get("fabrica", ""),
            "volumen": it["volumen"],
        }
        for it in items
    ]


def save_pedido(nombre: str, items: list[dict]):
    """Guarda un pedido (reemplaza si existe)."""
    sb = _sb()

    # Upsert cabecera
    ped = _first(
        sb.table("pedidos").upsert(
            {"nombre": nombre}, on_conflict="nombre"
        ).execute()
    )
    ped_id = ped["id"]

    # Borrar items viejos
    sb.table("pedido_items").delete().eq("pedido_id", ped_id).execute()

    # Insertar nuevos
    for it in items:
        sb.table("pedido_items").insert({
            "pedido_id": ped_id,
            "modelo_num": it["modelo"],
            "color": it.get("color", ""),
            "clave_material": it.get("clave_material", ""),
            "fabrica": it.get("fabrica", ""),
            "volumen": it["volumen"],
        }).execute()


def delete_pedido(nombre: str):
    """Elimina un pedido (cascade borra items)."""
    _sb().table("pedidos").delete().eq("nombre", nombre).execute()


# ============================================================
# RESTRICCIONES
# ============================================================

def get_restricciones(semana: str = None) -> list[dict]:
    """Carga restricciones, opcionalmente filtradas por semana."""
    q = _sb().table("restricciones").select("*").order("created_at")
    if semana:
        q = q.eq("semana", semana)
    rows = _rows(q.execute())
    return [
        {
            "id": r["id"],
            "tipo": r["tipo"],
            "modelo": r["modelo_num"],
            "activa": r["activa"],
            "parametros": r["parametros"],
        }
        for r in rows
    ]


def save_restriccion(restriccion: dict) -> dict:
    """Crea o actualiza una restriccion."""
    sb = _sb()
    data = {
        "tipo": restriccion["tipo"],
        "modelo_num": restriccion.get("modelo", "*"),
        "activa": restriccion.get("activa", True),
        "parametros": restriccion.get("parametros", {}),
        "semana": restriccion.get("semana"),
    }

    if restriccion.get("id"):
        return _first(
            sb.table("restricciones").update(data)
            .eq("id", restriccion["id"]).execute()
        )
    return _first(
        sb.table("restricciones").insert(data).execute()
    )


def delete_restriccion(restriccion_id: str):
    _sb().table("restricciones").delete().eq("id", restriccion_id).execute()


def save_restricciones_bulk(restricciones: list[dict], semana: str = None):
    """Reemplaza todas las restricciones de una semana."""
    sb = _sb()

    if semana:
        sb.table("restricciones").delete().eq("semana", semana).execute()
    else:
        sb.table("restricciones").delete().is_("semana", "null").execute()

    for r in restricciones:
        r["semana"] = semana
        save_restriccion(r)


# ============================================================
# AVANCE
# ============================================================

def get_avance(semana: str) -> dict:
    """Carga avance de una semana en formato compatible."""
    sb = _sb()
    av = _first(
        sb.table("avance").select("*").eq("semana", semana).execute()
    )
    if not av:
        return {"semana": semana, "updated_at": "", "modelos": {}}

    detalles = _rows(
        sb.table("avance_detalle").select("*").eq("avance_id", av["id"]).execute()
    )

    modelos = {}
    for d in detalles:
        mn = d["modelo_num"]
        if mn not in modelos:
            modelos[mn] = {}
        modelos[mn][d["dia"]] = d["pares"]

    return {
        "semana": av["semana"],
        "updated_at": av["updated_at"],
        "modelos": modelos,
    }


def save_avance(semana: str, modelos: dict):
    """Guarda avance de produccion."""
    sb = _sb()

    # Upsert cabecera
    av = _first(
        sb.table("avance").upsert(
            {"semana": semana}, on_conflict="semana"
        ).execute()
    )
    av_id = av["id"]

    # Borrar detalle viejo
    sb.table("avance_detalle").delete().eq("avance_id", av_id).execute()

    # Insertar detalle nuevo
    for modelo_num, dias in modelos.items():
        for dia, pares in dias.items():
            if pares > 0:
                sb.table("avance_detalle").insert({
                    "avance_id": av_id,
                    "modelo_num": modelo_num,
                    "dia": dia,
                    "pares": pares,
                }).execute()


# ============================================================
# RESULTADOS
# ============================================================

def get_resultados_list() -> list[dict]:
    """Lista resultados disponibles (sin datos pesados)."""
    rows = _rows(
        _sb().table("resultados")
        .select("id, nombre, base_name, version, nota, fecha_optimizacion")
        .order("fecha_optimizacion", desc=True)
        .execute()
    )
    return rows


def get_resultado(nombre: str) -> dict | None:
    """Carga un resultado completo por nombre."""
    return _first(
        _sb().table("resultados").select("*").eq("nombre", nombre).execute()
    )


def save_resultado(resultado: dict) -> dict:
    """Guarda un resultado de optimizacion."""
    sb = _sb()

    # Calcular version auto-incrementada
    base = resultado.get("base_name", resultado["nombre"])
    existing = _rows(
        sb.table("resultados").select("version")
        .eq("base_name", base)
        .order("version", desc=True)
        .limit(1)
        .execute()
    )
    next_version = (existing[0]["version"] + 1) if existing else 1
    nombre = f"{base}_v{next_version}"

    data = {
        "nombre": nombre,
        "base_name": base,
        "version": next_version,
        "nota": resultado.get("nota", ""),
        "weekly_schedule": resultado.get("weekly_schedule", []),
        "weekly_summary": resultado.get("weekly_summary", {}),
        "daily_results": resultado.get("daily_results", {}),
        "pedido_snapshot": resultado.get("pedido", []),
        "params_snapshot": resultado.get("params", {}),
    }

    return _first(sb.table("resultados").insert(data).execute())


def delete_resultado(nombre: str):
    _sb().table("resultados").delete().eq("nombre", nombre).execute()


# ============================================================
# MIGRACION JSON -> SUPABASE
# ============================================================

def migrate_from_json():
    """
    Migra datos existentes de JSON local a Supabase.
    Ejecutar una sola vez al configurar Supabase.
    """
    import json
    from pathlib import Path

    data_dir = Path(__file__).parent.parent / "data"

    print("=== Migracion JSON -> Supabase ===")

    # 1. Catalogo
    cat_path = data_dir / "catalogo.json"
    if cat_path.exists():
        with open(cat_path, "r", encoding="utf-8") as f:
            catalogo = json.load(f)
        print(f"  Catalogo: {len(catalogo)} modelos...")
        save_catalogo(catalogo)
        print("  OK")

    # 2. Operarios
    op_path = data_dir / "operarios.json"
    if op_path.exists():
        with open(op_path, "r", encoding="utf-8") as f:
            operarios = json.load(f)
        print(f"  Operarios: {len(operarios)}...")
        for op in operarios:
            save_operario(op)
        print("  OK")

    # 3. Pedidos
    ped_dir = data_dir / "pedidos"
    if ped_dir.exists():
        for ped_file in ped_dir.glob("*.json"):
            with open(ped_file, "r", encoding="utf-8") as f:
                items = json.load(f)
            nombre = ped_file.stem
            print(f"  Pedido '{nombre}': {len(items)} items...")
            save_pedido(nombre, items)
        print("  OK")

    # 4. Restricciones
    res_path = data_dir / "restricciones.json"
    if res_path.exists():
        with open(res_path, "r", encoding="utf-8") as f:
            restricciones = json.load(f)
        print(f"  Restricciones: {len(restricciones)}...")
        save_restricciones_bulk(restricciones)
        print("  OK")

    # 5. Avance
    av_path = data_dir / "avance.json"
    if av_path.exists():
        with open(av_path, "r", encoding="utf-8") as f:
            avance = json.load(f)
        semana = avance.get("semana", "")
        if semana and avance.get("modelos"):
            print(f"  Avance '{semana}'...")
            save_avance(semana, avance["modelos"])
            print("  OK")

    # 6. Resultados
    res_dir = data_dir / "resultados"
    if res_dir.exists():
        for res_file in res_dir.glob("*.json"):
            with open(res_file, "r", encoding="utf-8") as f:
                resultado = json.load(f)
            print(f"  Resultado '{resultado.get('nombre', res_file.stem)}'...")
            save_resultado(resultado)
        print("  OK")

    # 7. Modelo-Fabrica (desde config.json)
    cfg_path = data_dir / "config.json"
    if cfg_path.exists():
        with open(cfg_path, "r", encoding="utf-8") as f:
            config = json.load(f)
        mf = config.get("modelo_fabrica", {})
        for fab, modelos in mf.items():
            if fab != "SIN FABRICA ASIGNADA" and modelos:
                print(f"  Modelo-Fabrica '{fab}': {len(modelos)} modelos...")
                set_modelo_fabrica(fab, modelos)
        print("  OK")

    print("=== Migracion completada ===")


if __name__ == "__main__":
    migrate_from_json()
