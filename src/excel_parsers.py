"""
excel_parsers.py - Funciones de parseo de Excel para catalogo y pedido.

Extraido de dashboard/data_manager.py para uso directo desde la API FastAPI.
"""

import re

# Tipos de recurso validos (categorias fisicas base)
VALID_RESOURCES = {"MESA", "ROBOT", "PLANA", "POSTE", "MAQUILA"}

# Mapeo legacy: tipos compuestos -> tipo base
_COMPOUND_TO_BASE = {
    "MESA-LINEA": "MESA",
    "PLANA-LINEA": "PLANA",
    "POSTE-LINEA": "POSTE",
}


_DEFAULT_ROBOTS = {
    "2A-3020-M1", "2A-3020-M2", "3020-M4", "3020-M6",
    "6040-M4", "6040-M5", "CHACHE 048", "CHACHE 049",
}
_DEFAULT_ALIASES = {"3020 M-4": "3020-M4", "6040-M5 (PARCIAL)": "6040-M5"}


def _get_valid_robots() -> set:
    """Lee robots validos desde config.json (con fallback a defaults)."""
    try:
        from config_manager import get_physical_robots
        return set(get_physical_robots())
    except Exception:
        return _DEFAULT_ROBOTS


def _get_robot_aliases() -> dict:
    """Lee aliases de robots desde config.json (con fallback a defaults)."""
    try:
        from config_manager import get_robot_aliases
        return get_robot_aliases()
    except Exception:
        return _DEFAULT_ALIASES


def _normalize_robot(val):
    """Normaliza nombre de robot usando config."""
    if not val:
        return None
    s = str(val).strip()
    if not s:
        return None
    aliases = _get_robot_aliases()
    valid = _get_valid_robots()
    if s in aliases:
        s = aliases[s]
    if s in valid:
        return s
    s_upper = s.upper().replace(" ", "")
    for robot in valid:
        if robot.upper().replace(" ", "") == s_upper:
            return robot
    return None


def _parse_catalogo_sheet(ws) -> tuple:
    """Parsea hoja CATALOGO del template consolidado.

    Columnas fijas: MODELO | ALTERNATIVAS | FRACCION | OPERACION |
                    INPUT O PROCESO | ETAPA | RECURSO | RATE
    Columnas dinamicas (9+): nombres de robots en header, "OK" en celdas.
    Tambien soporta formato legacy (ROBOT_1..8 con nombres de robot en celdas).

    Returns:
        (catalog_dict, errors_list)
    """
    errors = []
    raw_ops = {}

    # Detectar formato de robots: leer headers desde col 9
    robot_col_map = {}
    is_new_format = False
    valid_robots = _get_valid_robots()
    for col in range(9, ws.max_column + 1):
        header = ws.cell(row=1, column=col).value
        if header and str(header).strip() in valid_robots:
            robot_col_map[col] = str(header).strip()
            is_new_format = True
        elif header and str(header).strip().startswith("ROBOT_"):
            break
    if not is_new_format:
        for col in range(9, ws.max_column + 1):
            header = ws.cell(row=1, column=col).value
            if header:
                normalized = _normalize_robot(str(header).strip())
                if normalized:
                    robot_col_map[col] = normalized
                    is_new_format = True

    for row in range(2, ws.max_row + 1):
        modelo = ws.cell(row=row, column=1).value
        alternativas_raw = ws.cell(row=row, column=2).value
        fraccion = ws.cell(row=row, column=3).value
        operacion = ws.cell(row=row, column=4).value
        input_proceso = ws.cell(row=row, column=5).value
        etapa = ws.cell(row=row, column=6).value
        recurso = ws.cell(row=row, column=7).value
        rate = ws.cell(row=row, column=8).value

        if not modelo or not fraccion:
            continue

        modelo_str = str(modelo).strip()
        model_match = re.match(r"^(\d+)", modelo_str)
        if not model_match:
            errors.append(f"Fila {row}: MODELO '{modelo_str}' no inicia con numero")
            continue

        model_num = model_match.group(1)

        alternativas = []
        if alternativas_raw:
            for a in re.split(r"[,;]", str(alternativas_raw)):
                a_clean = a.strip().upper()
                if a_clean:
                    alternativas.append(a_clean)

        recurso_str = str(recurso).strip().upper() if recurso else "GENERAL"
        recurso_str = _COMPOUND_TO_BASE.get(recurso_str, recurso_str)
        if recurso_str == "GENERAL":
            operacion_name = str(operacion).strip() if operacion else f"OP-{fraccion}"
            errors.append(f"Fila {row}: '{model_num} / {operacion_name}' sin RECURSO asignado (usando GENERAL)")
        elif recurso_str not in VALID_RESOURCES:
            errors.append(f"Fila {row}: RECURSO '{recurso_str}' no valido")
            continue

        try:
            rate_val = float(rate)
            if rate_val <= 0:
                raise ValueError()
        except (TypeError, ValueError):
            errors.append(f"Fila {row}: RATE '{rate}' debe ser numerico > 0")
            continue

        robots = []
        if is_new_format:
            for col, robot_name in robot_col_map.items():
                val = ws.cell(row=row, column=col).value
                if val and str(val).strip().upper() in ("OK", "SI", "X", "1"):
                    if robot_name not in robots:
                        robots.append(robot_name)
        else:
            for col in range(9, 17):
                val = ws.cell(row=row, column=col).value
                robot = _normalize_robot(val)
                if robot and robot not in robots:
                    robots.append(robot)

        if robots and recurso_str != "ROBOT":
            recurso_str = "ROBOT"

        sec_per_pair = round(3600.0 / rate_val)

        if alternativas:
            codigo_full = f"{model_num} {'/'.join(alternativas)}"
        else:
            codigo_full = model_num

        if model_num not in raw_ops:
            raw_ops[model_num] = {
                "codigo_full": codigo_full,
                "alternativas": alternativas,
                "ops": [],
            }
        elif alternativas and not raw_ops[model_num].get("alternativas"):
            raw_ops[model_num]["alternativas"] = alternativas
            raw_ops[model_num]["codigo_full"] = codigo_full

        raw_ops[model_num]["ops"].append({
            "fraccion": int(fraccion),
            "operacion": str(operacion).strip() if operacion else f"OP-{fraccion}",
            "input_o_proceso": str(input_proceso).strip() if input_proceso else "",
            "etapa": str(etapa).strip() if etapa else "",
            "recurso": recurso_str,
            "recurso_raw": recurso_str,
            "robots": robots,
            "rate": round(rate_val, 2),
            "sec_per_pair": sec_per_pair,
        })

    # Construir catalogo
    catalog = {}
    for model_num, data in raw_ops.items():
        ops = sorted(data["ops"], key=lambda x: x["fraccion"])
        seen = set()
        unique_ops = []
        for op in ops:
            if op["fraccion"] not in seen:
                seen.add(op["fraccion"])
                unique_ops.append(op)

        total_sec = sum(op["sec_per_pair"] for op in unique_ops)
        resource_summary = {}
        for op in unique_ops:
            r = op["recurso"]
            resource_summary[r] = resource_summary.get(r, 0) + 1

        robot_ops = sum(1 for op in unique_ops if op.get("robots"))
        all_robots = set()
        for op in unique_ops:
            for r in op.get("robots", []):
                all_robots.add(r)

        catalog[model_num] = {
            "codigo_full": data["codigo_full"],
            "alternativas": data.get("alternativas", []),
            "clave_material": "",
            "fabrica": "",
            "operations": unique_ops,
            "total_sec_per_pair": total_sec,
            "num_ops": len(unique_ops),
            "resource_summary": resource_summary,
            "robot_ops": robot_ops,
            "robots_used": sorted(all_robots),
        }

    return catalog, errors


def _parse_pedido_sheet(ws) -> tuple:
    """Parsea hoja PEDIDO del template consolidado.

    Layout: Fila 1=SEMANA, Fila 2=vacia, Fila 3=headers, Fila 4=req/opt, Fila 5+=datos

    Returns:
        (pedido_list, errors, semana_str)
    """
    errors = []
    pedido = []

    semana_raw = ws.cell(row=1, column=2).value
    semana = str(semana_raw).strip() if semana_raw else ""

    for row in range(5, ws.max_row + 1):
        modelo = ws.cell(row=row, column=1).value
        color = ws.cell(row=row, column=2).value
        clave = ws.cell(row=row, column=3).value
        fabrica = ws.cell(row=row, column=4).value
        volumen = ws.cell(row=row, column=5).value

        if not modelo:
            continue

        modelo_str = str(modelo).strip()
        if not modelo_str:
            continue

        color_str = str(color).strip() if color else ""
        clave_str = str(clave).strip() if clave else ""
        fabrica_str = str(fabrica).strip() if fabrica else "FABRICA 1"

        try:
            vol = int(float(volumen))
            if vol <= 0:
                raise ValueError()
        except (TypeError, ValueError):
            errors.append(f"Fila {row}: VOLUMEN '{volumen}' debe ser entero > 0")
            continue

        pedido.append({
            "modelo": modelo_str,
            "color": color_str,
            "clave_material": clave_str,
            "fabrica": fabrica_str,
            "volumen": vol,
        })

    return pedido, errors, semana
