"""
data_manager.py - Persistencia de datos y generacion de templates Excel.

Maneja:
  - Catalogo de operaciones: guardado/carga en JSON, importacion desde Excel
  - Pedidos semanales: guardado/carga en JSON, importacion desde Excel template
  - Resultados de optimizacion: guardado/carga en JSON para acceso multi-equipo
  - Generacion de templates Excel vacios para que el usuario los llene
"""

import json
import re
import io
from pathlib import Path
from copy import deepcopy
from datetime import datetime

import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

# Directorio base de datos (pespunte-agent/data/)
DATA_DIR = Path(__file__).parent.parent.parent / "data"
CATALOG_JSON = DATA_DIR / "catalogo.json"
PEDIDOS_DIR = DATA_DIR / "pedidos"
RESULTADOS_DIR = DATA_DIR / "resultados"
OPERARIOS_JSON = DATA_DIR / "operarios.json"

# Tipos de recurso validos (categorias fisicas, no cambian)
VALID_RESOURCES = {"MESA", "ROBOT", "PLANA", "POSTE-LINEA", "MESA-LINEA", "PLANA-LINEA"}


def _get_valid_robots() -> set:
    """Lee robots validos desde config.json."""
    from config_manager import get_physical_robots
    return set(get_physical_robots())


def _get_robot_aliases() -> dict:
    """Lee aliases de robots desde config.json."""
    from config_manager import get_robot_aliases
    return get_robot_aliases()

# Estilos comunes para templates Excel
_HEADER_FONT = Font(bold=True, color="FFFFFF", size=11)
_HEADER_FILL = PatternFill(start_color="2E4057", end_color="2E4057", fill_type="solid")
_HEADER_ALIGN = Alignment(horizontal="center", vertical="center", wrap_text=True)
_THIN_BORDER = Border(
    left=Side(style="thin"),
    right=Side(style="thin"),
    top=Side(style="thin"),
    bottom=Side(style="thin"),
)


# ---------------------------------------------------------------------------
# Catalogo: persistencia JSON
# ---------------------------------------------------------------------------

def save_catalog(catalog: dict):
    """Guarda el catalogo completo a JSON."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(CATALOG_JSON, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)


def load_catalog() -> dict | None:
    """Carga el catalogo desde JSON. Retorna None si no existe."""
    if not CATALOG_JSON.exists():
        return None
    with open(CATALOG_JSON, "r", encoding="utf-8") as f:
        return json.load(f)


def delete_catalog_model(model_num: str) -> bool:
    """Elimina un modelo del catalogo. Retorna True si se elimino."""
    catalog = load_catalog()
    if catalog and model_num in catalog:
        del catalog[model_num]
        save_catalog(catalog)
        return True
    return False


def save_catalog_model(model_num: str, model_data: dict):
    """Guarda o actualiza un modelo individual en el catalogo."""
    catalog = load_catalog() or {}
    catalog[model_num] = model_data
    save_catalog(catalog)


# ---------------------------------------------------------------------------
# Catalogo: importacion desde Excel existente (formato CATALOGO DE FRACCIONES)
# ---------------------------------------------------------------------------

def import_catalog_from_existing_excel(file_or_path) -> dict:
    """
    Importa catalogo desde el Excel existente (formato CATALOGO DE FRACCIONES).
    Usa la misma logica de catalog_loader.py pero guarda como JSON.

    Args:
        file_or_path: ruta a archivo o UploadedFile de Streamlit

    Returns:
        dict con el catalogo parseado
    """
    import sys
    src_dir = str(Path(__file__).parent.parent)
    if src_dir not in sys.path:
        sys.path.insert(0, src_dir)
    from catalog_loader import load_catalog_v2

    # Si es un UploadedFile de Streamlit, guardar temporalmente
    if hasattr(file_or_path, "read"):
        import tempfile, os
        suffix = os.path.splitext(file_or_path.name)[1] if hasattr(file_or_path, "name") else ".xlsx"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(file_or_path.read())
            tmp_path = tmp.name
        file_or_path.seek(0)  # Reset para posibles lecturas futuras
        catalog = load_catalog_v2(tmp_path)
        os.unlink(tmp_path)
    else:
        catalog = load_catalog_v2(str(file_or_path))

    # Guardar como JSON
    save_catalog(catalog)
    return catalog


# ---------------------------------------------------------------------------
# Catalogo: importacion desde template propio
# ---------------------------------------------------------------------------

def import_catalog_from_template(file_or_bytes) -> tuple:
    """
    Importa catalogo desde el template Excel propio.

    Template tiene columnas: MODELO, FRACCION, OPERACION, RECURSO, RATE,
    ROBOT_1, ROBOT_2, ..., ROBOT_8

    Returns:
        (catalog_dict, errors_list)
    """
    if hasattr(file_or_bytes, "read"):
        wb = openpyxl.load_workbook(file_or_bytes, data_only=True)
    else:
        wb = openpyxl.load_workbook(io.BytesIO(file_or_bytes), data_only=True)

    ws = wb.active
    errors = []
    raw_ops = {}

    for row in range(2, ws.max_row + 1):
        modelo = ws.cell(row=row, column=1).value
        fabrica_val = ws.cell(row=row, column=2).value
        fraccion = ws.cell(row=row, column=3).value
        operacion = ws.cell(row=row, column=4).value
        recurso = ws.cell(row=row, column=5).value
        rate = ws.cell(row=row, column=6).value

        if not modelo or not fraccion:
            continue

        modelo_str = str(modelo).strip()
        model_num = re.match(r"^(\d+)", modelo_str)
        if not model_num:
            errors.append(f"Fila {row}: MODELO '{modelo_str}' no inicia con numero")
            continue
        model_num = model_num.group(1)

        fabrica_str = str(fabrica_val).strip() if fabrica_val else ""

        # Validar recurso
        recurso_str = str(recurso).strip().upper() if recurso else ""
        if recurso_str and recurso_str not in VALID_RESOURCES:
            errors.append(f"Fila {row}: RECURSO '{recurso_str}' no valido. "
                          f"Debe ser: {', '.join(sorted(VALID_RESOURCES))}")
            continue

        # Validar rate
        try:
            rate_val = float(rate)
            if rate_val <= 0:
                raise ValueError()
        except (TypeError, ValueError):
            errors.append(f"Fila {row}: RATE '{rate}' debe ser numerico > 0")
            continue

        # Parsear robots (columnas 7-14)
        robots = []
        for col in range(7, 15):
            val = ws.cell(row=row, column=col).value
            robot = _normalize_robot(val)
            if robot and robot not in robots:
                robots.append(robot)

        sec_per_pair = round(3600.0 / rate_val)

        if model_num not in raw_ops:
            raw_ops[model_num] = {"codigo_full": modelo_str, "fabrica": fabrica_str, "ops": []}
        elif fabrica_str and not raw_ops[model_num].get("fabrica"):
            raw_ops[model_num]["fabrica"] = fabrica_str

        raw_ops[model_num]["ops"].append({
            "fraccion": int(fraccion),
            "operacion": str(operacion).strip() if operacion else f"OP-{fraccion}",
            "etapa": "",
            "recurso": recurso_str or "GENERAL",
            "recurso_raw": recurso_str,
            "robots": robots,
            "rate": round(rate_val, 2),
            "sec_per_pair": sec_per_pair,
        })

    # Construir catalogo final
    catalog = {}
    for model_num, data in raw_ops.items():
        ops = sorted(data["ops"], key=lambda x: x["fraccion"])
        # Deduplicar por fraccion
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
            "fabrica": data.get("fabrica", ""),
            "operations": unique_ops,
            "total_sec_per_pair": total_sec,
            "num_ops": len(unique_ops),
            "resource_summary": resource_summary,
            "robot_ops": robot_ops,
            "robots_used": sorted(all_robots),
        }

    if catalog:
        save_catalog(catalog)

    return catalog, errors


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


# ---------------------------------------------------------------------------
# Pedidos: persistencia JSON
# ---------------------------------------------------------------------------

def save_pedido(name: str, pedido: list):
    """
    Guarda un pedido semanal.

    Args:
        name: nombre del pedido (ej: "sem_8_2025")
        pedido: lista de dicts con keys: modelo, fabrica, volumen
    """
    PEDIDOS_DIR.mkdir(parents=True, exist_ok=True)
    filepath = PEDIDOS_DIR / f"{name}.json"
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(pedido, f, ensure_ascii=False, indent=2)


def load_pedido(name: str) -> list | None:
    """Carga un pedido por nombre. Migra formato viejo si es necesario."""
    filepath = PEDIDOS_DIR / f"{name}.json"
    if not filepath.exists():
        return None
    with open(filepath, "r", encoding="utf-8") as f:
        pedido = json.load(f)
    # Migrar formato viejo: si 'modelo' contiene "77525 NE" y 'color' es "NE",
    # separar para que 'modelo' sea solo "77525"
    migrated = False
    for item in pedido:
        modelo = item.get("modelo", "")
        color = item.get("color", "")
        m = re.match(r"^(\d{5})\s+([A-Z]{2})$", modelo)
        if m and m.group(2) == color:
            item["modelo"] = m.group(1)
            migrated = True
    if migrated:
        save_pedido(name, pedido)
    return pedido


def list_pedidos() -> list:
    """Lista los nombres de pedidos guardados."""
    PEDIDOS_DIR.mkdir(parents=True, exist_ok=True)
    return sorted([
        f.stem for f in PEDIDOS_DIR.glob("*.json")
    ])


def delete_pedido(name: str) -> bool:
    """Elimina un pedido guardado."""
    filepath = PEDIDOS_DIR / f"{name}.json"
    if filepath.exists():
        filepath.unlink()
        return True
    return False


_DRAFT_NAME = "_borrador"


def save_pedido_draft(pedido: list):
    """Guarda el borrador actual del pedido (auto-save)."""
    save_pedido(_DRAFT_NAME, pedido)


def load_pedido_draft() -> list:
    """Carga el borrador del pedido. Retorna lista vacia si no existe."""
    return load_pedido(_DRAFT_NAME) or []


def clear_pedido_draft():
    """Elimina el borrador del pedido."""
    delete_pedido(_DRAFT_NAME)


# ---------------------------------------------------------------------------
# Pedido: importacion desde template Excel
# ---------------------------------------------------------------------------

def import_pedido_from_template(file_or_bytes) -> tuple:
    """
    Importa pedido semanal desde template Excel.

    Template: MODELO | ALTERNATIVA | CLAVE MATERIAL | FABRICA | VOLUMEN

    Returns:
        (pedido_list, errors_list)
    """
    if hasattr(file_or_bytes, "read"):
        wb = openpyxl.load_workbook(file_or_bytes, data_only=True)
    else:
        wb = openpyxl.load_workbook(io.BytesIO(file_or_bytes), data_only=True)

    ws = wb.active
    errors = []
    pedido = []

    for row in range(2, ws.max_row + 1):
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

        # Validar fabrica
        fabrica_str = str(fabrica).strip() if fabrica else "FABRICA 1"

        # Validar volumen
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

    return pedido, errors


# ---------------------------------------------------------------------------
# Conversion: pedido + catalogo -> modelos listos para optimizador
# ---------------------------------------------------------------------------

def build_matched_models(pedido: list, catalog: dict) -> tuple:
    """
    Cruza pedido con catalogo para construir la lista de modelos
    con la misma estructura que espera el optimizador.

    Returns:
        (matched, unmatched) donde:
        - matched: lista de dicts compatibles con optimizer_weekly/v2
        - unmatched: lista de dicts de modelos sin match en catalogo
    """
    matched = []
    unmatched = []

    for item in pedido:
        modelo_str = item["modelo"]
        color = item.get("color", "")
        clave_material = item.get("clave_material", "")
        # Extraer numero de modelo (por si viene con texto extra)
        m = re.match(r"^(\d+)", modelo_str)
        model_num = m.group(1) if m else modelo_str
        # Construir codigo de display: numero + alternativa
        codigo_display = f"{model_num} {color}".strip() if color else model_num

        if model_num in catalog:
            cat = catalog[model_num]
            model = {
                "codigo": codigo_display,
                "modelo_num": model_num,
                "color": color,
                "clave_material": clave_material,
                "suela": "",
                "volumen_declarado": item["volumen"],
                "total_producir": item["volumen"],
                "fabrica": item["fabrica"],
                "daily_prs_original": {},
                "operations": deepcopy(cat["operations"]),
                "total_sec_per_pair": cat["total_sec_per_pair"],
                "num_ops": cat["num_ops"],
                "catalog_code": cat["codigo_full"],
                "resource_summary": cat.get("resource_summary", {}),
            }
            matched.append(model)
        else:
            unmatched.append({
                "codigo": codigo_display,
                "modelo_num": model_num,
                "color": color,
                "clave_material": clave_material,
                "total_producir": item["volumen"],
                "fabrica": item["fabrica"],
            })

    return matched, unmatched


# ---------------------------------------------------------------------------
# Generacion de Templates Excel
# ---------------------------------------------------------------------------

def generate_template_pedido() -> bytes:
    """Genera template Excel vacio para pedido semanal. Retorna bytes."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Pedido Semanal"

    headers = ["MODELO", "ALTERNATIVA", "CLAVE MATERIAL", "FABRICA", "VOLUMEN"]
    col_widths = [15, 12, 16, 15, 12]

    # Encabezados
    for col, (header, width) in enumerate(zip(headers, col_widths), 1):
        cell = ws.cell(row=1, column=col, value=header)
        cell.font = _HEADER_FONT
        cell.fill = _HEADER_FILL
        cell.alignment = _HEADER_ALIGN
        cell.border = _THIN_BORDER
        ws.column_dimensions[openpyxl.utils.get_column_letter(col)].width = width

    # Filas de ejemplo
    examples = [
        ("65413", "NE", "SLI", "FABRICA 1", 1700),
        ("95420", "BL", "SLI", "FABRICA 2", 800),
        ("91721", "CA", "SLI", "FABRICA 1", 450),
    ]
    for row, (modelo, color, clave, fab, vol) in enumerate(examples, 2):
        ws.cell(row=row, column=1, value=modelo).font = Font(italic=True, color="999999")
        ws.cell(row=row, column=2, value=color).font = Font(italic=True, color="999999")
        ws.cell(row=row, column=3, value=clave).font = Font(italic=True, color="999999")
        ws.cell(row=row, column=4, value=fab).font = Font(italic=True, color="999999")
        ws.cell(row=row, column=5, value=vol).font = Font(italic=True, color="999999")
        for col in range(1, 6):
            ws.cell(row=row, column=col).border = _THIN_BORDER

    # Instrucciones
    ws_inst = wb.create_sheet("Instrucciones")
    ws_inst.column_dimensions["A"].width = 80
    instructions = [
        "TEMPLATE - PEDIDO SEMANAL",
        "",
        "Llene la hoja 'Pedido Semanal' con los modelos a producir esta semana.",
        "",
        "Columnas:",
        "  MODELO  - Codigo del modelo (debe existir en el catalogo). Ej: 65413 NE",
        "  FABRICA - Fabrica asignada. Ej: FABRICA 1, FABRICA 2, FABRICA 3",
        "  VOLUMEN - Pares totales a producir en la semana. Debe ser > 0",
        "",
        "Notas:",
        "  - Las filas de ejemplo (en gris) se pueden sobreescribir",
        "  - El MODELO debe coincidir con el catalogo de operaciones",
        "  - No dejar filas vacias entre modelos",
    ]
    for i, line in enumerate(instructions, 1):
        ws_inst.cell(row=i, column=1, value=line)
    ws_inst.cell(row=1, column=1).font = Font(bold=True, size=14)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()


def generate_template_catalogo() -> bytes:
    """Genera template Excel vacio para catalogo de operaciones. Retorna bytes."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Catalogo"

    headers = [
        "MODELO", "FABRICA", "FRACCION", "OPERACION", "RECURSO", "RATE",
        "ROBOT_1", "ROBOT_2", "ROBOT_3", "ROBOT_4",
        "ROBOT_5", "ROBOT_6", "ROBOT_7", "ROBOT_8",
    ]
    col_widths = [20, 15, 12, 30, 15, 10, 15, 15, 15, 15, 15, 15, 15, 15]

    # Encabezados
    for col, (header, width) in enumerate(zip(headers, col_widths), 1):
        cell = ws.cell(row=1, column=col, value=header)
        cell.font = _HEADER_FONT
        cell.fill = _HEADER_FILL
        cell.alignment = _HEADER_ALIGN
        cell.border = _THIN_BORDER
        ws.column_dimensions[openpyxl.utils.get_column_letter(col)].width = width

    # Filas de ejemplo
    examples = [
        ("65413 NE", "FABRICA 1", 1, "PEGAR FELPA", "MESA", 120, "", "", "", "", "", "", "", ""),
        ("65413 NE", "FABRICA 1", 2, "COSER PUNTERA", "ROBOT", 80, "3020-M4", "3020-M6", "", "", "", "", "", ""),
        ("65413 NE", "FABRICA 1", 3, "ADORNAR COSTADOS", "PLANA", 90, "", "", "", "", "", "", "", ""),
        ("95420 NE", "FABRICA 2", 1, "PEGAR FORRO", "MESA", 110, "", "", "", "", "", "", "", ""),
        ("95420 NE", "FABRICA 2", 2, "COSER LATERAL", "ROBOT", 75, "6040-M4", "6040-M5", "", "", "", "", "", ""),
    ]
    for row, vals in enumerate(examples, 2):
        for col, val in enumerate(vals, 1):
            cell = ws.cell(row=row, column=col, value=val if val != "" else None)
            cell.font = Font(italic=True, color="999999")
            cell.border = _THIN_BORDER

    # Instrucciones
    ws_inst = wb.create_sheet("Instrucciones")
    ws_inst.column_dimensions["A"].width = 80
    instructions = [
        "TEMPLATE - CATALOGO DE OPERACIONES",
        "",
        "Llene la hoja 'Catalogo' con las operaciones de cada modelo.",
        "",
        "Columnas:",
        "  MODELO    - Codigo del modelo. Ej: 65413 NE",
        "  FABRICA   - Fabrica asignada. Ej: FABRICA 1, FABRICA 2, FABRICA 3",
        "  FRACCION  - Numero secuencial de la operacion (1, 2, 3...)",
        "  OPERACION - Descripcion de la operacion. Ej: PEGAR FELPA",
        "  RECURSO   - Tipo de recurso. Debe ser uno de:",
        "              MESA, ROBOT, PLANA, POSTE-LINEA, MESA-LINEA, PLANA-LINEA",
        "  RATE      - Pares por hora (numerico, > 0)",
        "  ROBOT_1 a ROBOT_8 - Robots que pueden procesar esta operacion (opcional)",
        "",
        "Robots validos:",
        "  2A-3020-M1, 2A-3020-M2, 3020-M4, 3020-M6,",
        "  6040-M4, 6040-M5, CHACHE 048, CHACHE 049",
        "",
        "Notas:",
        "  - Las filas de ejemplo (en gris) se pueden sobreescribir",
        "  - Las fracciones deben ser secuenciales por modelo (1, 2, 3...)",
        "  - Solo llenar ROBOT_x para operaciones que usan robot",
        "  - El MODELO se repite en cada fila de fraccion",
    ]
    for i, line in enumerate(instructions, 1):
        ws_inst.cell(row=i, column=1, value=line)
    ws_inst.cell(row=1, column=1).font = Font(bold=True, size=14)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()


def export_catalog_to_template(catalog: dict) -> bytes:
    """Exporta el catalogo actual al formato template Excel."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Catalogo"

    headers = [
        "MODELO", "FABRICA", "FRACCION", "OPERACION", "RECURSO", "RATE",
        "ROBOT_1", "ROBOT_2", "ROBOT_3", "ROBOT_4",
        "ROBOT_5", "ROBOT_6", "ROBOT_7", "ROBOT_8",
    ]
    col_widths = [20, 15, 12, 30, 15, 10, 15, 15, 15, 15, 15, 15, 15, 15]

    for col, (header, width) in enumerate(zip(headers, col_widths), 1):
        cell = ws.cell(row=1, column=col, value=header)
        cell.font = _HEADER_FONT
        cell.fill = _HEADER_FILL
        cell.alignment = _HEADER_ALIGN
        cell.border = _THIN_BORDER
        ws.column_dimensions[openpyxl.utils.get_column_letter(col)].width = width

    row = 2
    for model_num in sorted(catalog.keys()):
        model_data = catalog[model_num]
        fabrica = model_data.get("fabrica", "")
        for op in model_data["operations"]:
            ws.cell(row=row, column=1, value=model_data["codigo_full"])
            ws.cell(row=row, column=2, value=fabrica)
            ws.cell(row=row, column=3, value=op["fraccion"])
            ws.cell(row=row, column=4, value=op["operacion"])
            ws.cell(row=row, column=5, value=op["recurso"])
            ws.cell(row=row, column=6, value=op["rate"])
            for i, robot in enumerate(op.get("robots", [])[:8]):
                ws.cell(row=row, column=7 + i, value=robot)
            for c in range(1, 15):
                ws.cell(row=row, column=c).border = _THIN_BORDER
            row += 1

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Resultados de Optimizacion: persistencia JSON
# ---------------------------------------------------------------------------

def save_optimization_results(name: str, weekly_schedule: list,
                               weekly_summary: dict, daily_results: dict,
                               pedido: list = None, params: dict = None):
    """
    Guarda resultados de optimizacion a JSON.

    Args:
        name: nombre del resultado (ej: "sem_7_2026")
        weekly_schedule: salida de optimizer_weekly
        weekly_summary: resumen semanal
        daily_results: salida de optimizer_v2 (dict por dia)
        pedido: pedido original (opcional, para referencia)
        params: parametros usados (opcional, para referencia)
    """
    RESULTADOS_DIR.mkdir(parents=True, exist_ok=True)
    filepath = RESULTADOS_DIR / f"{name}.json"

    data = {
        "nombre": name,
        "fecha_optimizacion": datetime.now().isoformat(),
        "weekly_schedule": weekly_schedule,
        "weekly_summary": weekly_summary,
        "daily_results": daily_results,
    }
    if pedido is not None:
        data["pedido"] = pedido
    if params is not None:
        # Solo guardar parametros serializables (excluir objetos complejos)
        safe_params = {
            "min_lot_size": params.get("min_lot_size"),
            "lot_step": params.get("lot_step"),
            "resource_capacity": params.get("resource_capacity"),
            "days": params.get("days"),
        }
        data["params"] = safe_params

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load_optimization_results(name: str) -> dict | None:
    """
    Carga resultados de optimizacion por nombre.

    Returns:
        dict con keys: nombre, fecha_optimizacion, weekly_schedule,
        weekly_summary, daily_results, pedido (opcional), params (opcional).
        None si no existe.
    """
    filepath = RESULTADOS_DIR / f"{name}.json"
    if not filepath.exists():
        return None
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


def list_optimization_results() -> list:
    """
    Lista resultados de optimizacion guardados con metadatos basicos.

    Returns:
        lista de dicts con keys: nombre, fecha_optimizacion, total_pares,
        status, num_modelos
    """
    RESULTADOS_DIR.mkdir(parents=True, exist_ok=True)
    results = []
    for f in sorted(RESULTADOS_DIR.glob("*.json"), reverse=True):
        try:
            with open(f, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            summary = data.get("weekly_summary", {})
            results.append({
                "nombre": f.stem,
                "fecha_optimizacion": data.get("fecha_optimizacion", ""),
                "total_pares": summary.get("total_pares", 0),
                "status": summary.get("status", ""),
                "tardiness": summary.get("total_tardiness", 0),
            })
        except (json.JSONDecodeError, KeyError):
            continue
    return results


def delete_optimization_result(name: str) -> bool:
    """Elimina un resultado de optimizacion guardado."""
    filepath = RESULTADOS_DIR / f"{name}.json"
    if filepath.exists():
        filepath.unlink()
        return True
    return False


# ---------------------------------------------------------------------------
# Operarios: persistencia JSON
# ---------------------------------------------------------------------------

def save_operarios(operarios: list):
    """Guarda la lista completa de operarios a JSON."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(OPERARIOS_JSON, "w", encoding="utf-8") as f:
        json.dump(operarios, f, ensure_ascii=False, indent=2)


def load_operarios() -> list:
    """Carga la lista de operarios desde JSON. Retorna lista vacia si no existe."""
    if not OPERARIOS_JSON.exists():
        return []
    with open(OPERARIOS_JSON, "r", encoding="utf-8") as f:
        return json.load(f)


def _next_operario_id(operarios: list) -> str:
    """Genera el siguiente ID de operario (op_001, op_002, ...)."""
    max_num = 0
    for op in operarios:
        oid = op.get("id", "")
        if oid.startswith("op_"):
            try:
                max_num = max(max_num, int(oid[3:]))
            except ValueError:
                pass
    return f"op_{max_num + 1:03d}"


def save_operario(operario: dict) -> dict:
    """
    Agrega o actualiza un operario individual.
    Si tiene 'id' y ese id existe, actualiza. Si no, agrega nuevo.
    Retorna el operario guardado (con id asignado).
    """
    operarios = load_operarios()
    if operario.get("id"):
        for i, op in enumerate(operarios):
            if op["id"] == operario["id"]:
                operarios[i] = operario
                save_operarios(operarios)
                return operario
    operario["id"] = _next_operario_id(operarios)
    operarios.append(operario)
    save_operarios(operarios)
    return operario


def delete_operario(operario_id: str) -> bool:
    """Elimina un operario por ID. Retorna True si se elimino."""
    operarios = load_operarios()
    filtered = [op for op in operarios if op.get("id") != operario_id]
    if len(filtered) < len(operarios):
        save_operarios(filtered)
        return True
    return False


def compute_headcount_by_resource(operarios: list, day_name: str) -> dict:
    """
    Computa cuantos operarios activos pueden trabajar en cada tipo de recurso
    para un dia dado.

    Returns:
        dict {recurso: count} e.g. {"MESA": 12, "PLANA": 8, ...}
    """
    counts = {}
    for op in operarios:
        if not op.get("activo", True):
            continue
        if day_name not in op.get("dias_disponibles", []):
            continue
        for recurso in op.get("recursos_habilitados", []):
            counts[recurso] = counts.get(recurso, 0) + 1
    return counts
