"""
template_generator.py - Genera template Excel para importar pedido semanal.

Crea un archivo .xlsx con 2 hojas:
  - INSTRUCCIONES: explicacion de columnas y formato esperado
  - PEDIDO: headers + ejemplos para importar pedido semanal

El formato generado coincide EXACTAMENTE con lo que espera _parse_pedido_sheet():
  Fila 1: A1="SEMANA", B1=nombre de la semana
  Fila 2: (vacia)
  Fila 3: headers (MODELO, COLOR, CLAVE_MATERIAL, FABRICA, VOLUMEN)
  Fila 4: indicadores requerido/opcional
  Fila 5+: datos del pedido
"""

from io import BytesIO
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side


# Estilos
_HEADER_FONT = Font(bold=True, color="FFFFFF", size=11)
_HEADER_FILL = PatternFill(start_color="2563EB", end_color="2563EB", fill_type="solid")
_EXAMPLE_FILL = PatternFill(start_color="F3F4F6", end_color="F3F4F6", fill_type="solid")
_THIN_BORDER = Border(
    left=Side(style="thin"), right=Side(style="thin"),
    top=Side(style="thin"), bottom=Side(style="thin"),
)


def _style_header(ws, row, cols):
    for c in range(1, cols + 1):
        cell = ws.cell(row=row, column=c)
        cell.font = _HEADER_FONT
        cell.fill = _HEADER_FILL
        cell.alignment = Alignment(horizontal="center", wrap_text=True)
        cell.border = _THIN_BORDER


def _style_example(ws, row, cols):
    for c in range(1, cols + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = _EXAMPLE_FILL
        cell.border = _THIN_BORDER


def _build_instrucciones(wb):
    ws = wb.create_sheet("INSTRUCCIONES", 0)
    ws.sheet_properties.tabColor = "10B981"
    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 80

    rows = [
        ("TEMPLATE DE IMPORTACION - PEDIDO SEMANAL", ""),
        ("", ""),
        ("Este archivo contiene la hoja PEDIDO", "donde se ingresan los modelos y volumenes a producir en la semana."),
        ("", ""),
        ("=" * 50, ""),
        ("FORMATO DE LA HOJA PEDIDO", ""),
        ("=" * 50, ""),
        ("", ""),
        ("Fila 1", "Celda A1 = 'SEMANA', celda B1 = nombre de la semana (ej: sem_8_2026)."),
        ("", "El nombre de la semana se usa como identificador del pedido."),
        ("Fila 2", "Dejar vacia."),
        ("Fila 3", "Headers: MODELO | COLOR | CLAVE_MATERIAL | FABRICA | VOLUMEN"),
        ("", "NO modificar los nombres de los headers."),
        ("Fila 4", "Indicadores de requerido/opcional (solo referencia, no se procesan)."),
        ("Fila 5 en adelante", "Datos del pedido, una fila por item."),
        ("", ""),
        ("=" * 50, ""),
        ("COLUMNAS", ""),
        ("=" * 50, ""),
        ("", ""),
        ("MODELO", "Numero del modelo (ej: 65413). REQUERIDO."),
        ("", "Debe coincidir con un modelo del catalogo cargado en el sistema."),
        ("COLOR", "Color o variante (ej: NEGRO). Opcional."),
        ("CLAVE_MATERIAL", "Clave de material (ej: MAT-001). Opcional."),
        ("FABRICA", "Fabrica asignada (ej: FABRICA 1). Opcional. Default: FABRICA 1."),
        ("VOLUMEN", "Cantidad de pares a producir. Entero mayor a 0. REQUERIDO."),
        ("", ""),
        ("=" * 50, ""),
        ("NOTAS IMPORTANTES", ""),
        ("=" * 50, ""),
        ("", ""),
        ("1.", "Las filas de ejemplo (fondo gris) deben ELIMINARSE antes de importar."),
        ("2.", "No dejar filas vacias entre los datos."),
        ("3.", "El MODELO debe existir previamente en el catalogo del sistema."),
        ("4.", "El VOLUMEN debe ser un numero entero positivo (ej: 100, 200, 500)."),
        ("5.", "Si no se especifica FABRICA, se asigna 'FABRICA 1' por defecto."),
        ("6.", "Se puede importar el mismo pedido varias veces; los datos se reemplazan."),
    ]

    for i, (a, b) in enumerate(rows, 1):
        ws.cell(row=i, column=1, value=a)
        ws.cell(row=i, column=2, value=b)
        if a and a.startswith("="):
            ws.cell(row=i, column=1).font = Font(color="999999")
        elif i == 1:
            ws.cell(row=i, column=1).font = Font(bold=True, size=14)
        elif a in ("MODELO", "COLOR", "CLAVE_MATERIAL", "FABRICA", "VOLUMEN",
                    "Fila 1", "Fila 2", "Fila 3", "Fila 4", "Fila 5 en adelante"):
            ws.cell(row=i, column=1).font = Font(bold=True)
        elif a in ("1.", "2.", "3.", "4.", "5.", "6."):
            ws.cell(row=i, column=1).font = Font(bold=True)


def _build_pedido(wb):
    ws = wb.create_sheet("PEDIDO")
    ws.sheet_properties.tabColor = "F59E0B"

    # Row 1: SEMANA (parser lee B1 para el nombre)
    ws.cell(row=1, column=1, value="SEMANA")
    ws.cell(row=1, column=1).font = Font(bold=True)
    ws.cell(row=1, column=2, value="sem_XX_2026")

    # Row 2: vacia (parser la ignora)

    # Row 3: Headers (parser no lee esta fila, pero documenta las columnas)
    headers = ["MODELO", "COLOR", "CLAVE_MATERIAL", "FABRICA", "VOLUMEN"]
    for c, h in enumerate(headers, 1):
        ws.cell(row=3, column=c, value=h)
    _style_header(ws, 3, len(headers))

    # Row 4: requerido/opcional (parser no lee esta fila)
    markers = ["requerido", "opcional", "opcional", "opcional", "requerido"]
    for c, m in enumerate(markers, 1):
        cell = ws.cell(row=4, column=c, value=m)
        cell.font = Font(italic=True, color="999999", size=9)
        cell.alignment = Alignment(horizontal="center")

    # Filas de ejemplo (fila 5+, parser lee desde fila 5)
    examples = [
        ["65413", "NEGRO", "MAT-001", "FABRICA 1", 500],
        ["77525", "CAFE", "MAT-002", "FABRICA 2", 300],
        ["88190", "", "", "FABRICA 1", 200],
    ]
    for row_idx, data in enumerate(examples, 5):
        for c, val in enumerate(data, 1):
            ws.cell(row=row_idx, column=c, value=val)
        _style_example(ws, row_idx, len(headers))

    # Anchos de columna
    widths = [12, 12, 16, 14, 10]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = w


def generate_template() -> BytesIO:
    """Genera template Excel para pedido y retorna como BytesIO buffer."""
    wb = Workbook()
    # Eliminar hoja default
    wb.remove(wb.active)

    _build_instrucciones(wb)
    _build_pedido(wb)

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf
