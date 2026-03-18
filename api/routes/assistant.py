"""
Endpoint del asistente LLM (Claude API).

Recibe mensajes del chat, construye contexto desde Supabase,
y retorna la respuesta del modelo.
Soporta attachments: imagenes (Claude Vision) y Excel (openpyxl).
"""

import os
import io
import base64
import requests
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import openpyxl

from llm_assistant import SYSTEM_PROMPT, build_context

router = APIRouter()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "") or os.environ.get("SUPABASE_KEY", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")


def _sb_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _sb_get(table: str, query: str = "") -> list:
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}?{query}",
        headers=_sb_headers(),
    )
    if r.status_code == 400:
        return []
    r.raise_for_status()
    return r.json()


def _build_state_from_supabase(pedido_nombre: str, semana: str = "") -> dict:
    """Construye un dict compatible con build_context() desde Supabase."""
    state = {}

    # Pedido (con color y clave_material)
    items = []
    ped = _sb_get("pedidos", f"select=id&nombre=eq.{pedido_nombre}")
    if ped:
        items = _sb_get("pedido_items", f"select=*&pedido_id=eq.{ped[0]['id']}")
        state["pedido_rows"] = [
            {
                "modelo": it["modelo_num"],
                "color": it.get("color", ""),
                "clave_material": it.get("clave_material", ""),
                "volumen": it["volumen"],
                "fabrica": it.get("fabrica", ""),
            }
            for it in items
        ]

    # Resultado mas reciente
    q = "select=*&order=fecha_optimizacion.desc&limit=1"
    if semana:
        q = f"select=*&base_name=eq.{semana}&order=version.desc&limit=1"
    resultados = _sb_get("resultados", q)

    if resultados:
        res = resultados[0]
        state["weekly_schedule"] = res.get("weekly_schedule")
        state["weekly_summary"] = res.get("weekly_summary")
        state["daily_results"] = res.get("daily_results")
        state["params"] = res.get("params_snapshot")

    # Restricciones temporales (de la semana)
    restricciones = []
    if semana:
        rq = f"select=*&activa=eq.true&semana=eq.{semana}&order=created_at"
        restricciones = _sb_get("restricciones", rq)

    # Reglas permanentes (semana IS NULL)
    reglas = _sb_get("restricciones", "select=*&activa=eq.true&semana=is.null&order=created_at")

    all_constraints = []
    for r in restricciones:
        all_constraints.append({
            "tipo": r["tipo"],
            "modelo": r.get("modelo_num", ""),
            "activa": r["activa"],
            "parametros": r.get("parametros", {}),
            "nota": r.get("nota", ""),
            "categoria": "temporal",
        })
    for r in reglas:
        all_constraints.append({
            "tipo": r["tipo"],
            "modelo": r.get("modelo_num", ""),
            "activa": r["activa"],
            "parametros": r.get("parametros", {}),
            "nota": r.get("nota", ""),
            "categoria": "permanente",
        })
    state["restricciones"] = all_constraints

    # Catalogo (modelos + operaciones + robots)
    cat_modelos = _sb_get("catalogo_modelos", "select=id,modelo_num,alternativas,total_sec_per_pair,num_ops&order=modelo_num")
    if cat_modelos:
        cat_ops = _sb_get("catalogo_operaciones", "select=modelo_id,fraccion,operacion,input_o_proceso,recurso,etapa,rate,sec_per_pair&order=fraccion")
        robots_activos = _sb_get("robots", "select=id,nombre&estado=eq.ACTIVO&order=orden")
        robot_rels = _sb_get("catalogo_operacion_robots", "select=operacion_id,robot_id")

        # Build robot id->name map
        robot_name_map = {r["id"]: r["nombre"] for r in robots_activos}
        # Build op_id -> robot names
        op_robots = {}
        for rel in robot_rels:
            oid = rel["operacion_id"]
            rname = robot_name_map.get(rel["robot_id"], "")
            if rname:
                op_robots.setdefault(oid, []).append(rname)

        # Build ops by modelo_id
        ops_by_modelo = {}
        for op in cat_ops:
            mid = op["modelo_id"]
            ops_by_modelo.setdefault(mid, []).append(op)

        state["catalogo"] = []
        for m in cat_modelos:
            ops = ops_by_modelo.get(m["id"], [])
            state["catalogo"].append({
                "modelo_num": m["modelo_num"],
                "alternativas": m.get("alternativas", []),
                "total_sec_per_pair": m.get("total_sec_per_pair", 0),
                "num_ops": m.get("num_ops", 0),
                "operaciones": [
                    {
                        "fraccion": op["fraccion"],
                        "operacion": op["operacion"],
                        "input_o_proceso": op.get("input_o_proceso", ""),
                        "recurso": op["recurso"],
                        "etapa": op.get("etapa", ""),
                        "rate": op.get("rate", 0),
                        "robots": op_robots.get(op.get("id", ""), []),
                    }
                    for op in ops
                ],
            })
        state["robots_activos"] = [r["nombre"] for r in robots_activos]

    # Configuracion (capacidades, dias laborales, fabricas)
    capacidades = _sb_get("capacidades_recurso", "select=tipo,pares_hora&order=tipo")
    if capacidades:
        state["capacidades"] = capacidades

    dias_lab = _sb_get("dias_laborales", "select=dia,activo,minutos,minutos_ot,plantilla&order=dia")
    if dias_lab:
        state["dias_laborales"] = dias_lab

    fabricas = _sb_get("fabricas", "select=nombre,es_maquila,orden&order=orden")
    if fabricas:
        state["fabricas"] = [
            {"nombre": f["nombre"], "es_maquila": f.get("es_maquila", False)}
            for f in fabricas
        ]

    # Pesos de priorizacion y parametros de optimizacion
    pesos = _sb_get("pesos_priorizacion", "select=nombre,valor&order=nombre")
    if pesos:
        state["pesos"] = {p["nombre"]: p["valor"] for p in pesos}
    params_opt = _sb_get("parametros_optimizacion", "select=nombre,valor&order=nombre")
    if params_opt:
        state["parametros_opt"] = {p["nombre"]: p["valor"] for p in params_opt}

    # Operarios con habilidades y disponibilidad
    operarios_raw = _sb_get("operarios", "select=id,nombre,eficiencia,activo&activo=eq.true&order=nombre")
    if operarios_raw:
        # Habilidades
        habs = _sb_get("operario_habilidades", "select=operario_id,habilidad,nivel")
        habs_by_op = {}
        for h in habs:
            habs_by_op.setdefault(h["operario_id"], []).append(
                {"habilidad": h["habilidad"], "nivel": h.get("nivel", 2)}
            )
        # Dias disponibles
        dias_raw = _sb_get("operario_dias", "select=operario_id,dia")
        dias_by_op = {}
        for d in dias_raw:
            dias_by_op.setdefault(d["operario_id"], []).append(d["dia"])

        state["operarios"] = [
            {
                "nombre": op["nombre"],
                "eficiencia": op.get("eficiencia", 1.0),
                "habilidades": habs_by_op.get(op["id"], []),
                "dias_disponibles": dias_by_op.get(op["id"], []),
            }
            for op in operarios_raw
        ]

    # Asignaciones maquila (si hay pedido)
    if ped:
        items_ids = [it["id"] for it in items] if items else []
        if items_ids:
            # Fetch maquila assignments for pedido items
            maquila_raw = _sb_get("asignaciones_maquila", f"select=*&order=id")
            # Filter to our pedido items
            item_id_set = set(items_ids)
            maquila_filtered = [a for a in maquila_raw if a.get("pedido_item_id") in item_id_set]
            if maquila_filtered:
                # Map item_id -> modelo
                item_modelo = {it["id"]: it["modelo_num"] for it in items}
                state["asignaciones_maquila"] = [
                    {
                        "modelo": item_modelo.get(a["pedido_item_id"], "?"),
                        "maquila": a.get("maquila", ""),
                        "pares": a.get("pares", 0),
                        "fecha_entrega": str(a.get("fecha_entrega", "")) if a.get("fecha_entrega") else None,
                    }
                    for a in maquila_filtered
                ]

    # Avance
    if semana:
        av = _sb_get("avance", f"select=*&semana=eq.{semana}")
        if av:
            detalles = _sb_get("avance_detalle", f"select=*&avance_id=eq.{av[0]['id']}")
            modelos = {}
            for d in detalles:
                mn = d["modelo_num"]
                if mn not in modelos:
                    modelos[mn] = {}
                modelos[mn][d["dia"]] = d["pares"]
            state["avance"] = {"modelos": modelos}

    return state


# --- Request/Response models ---

class ChatAttachment(BaseModel):
    type: str  # "image" or "excel"
    filename: str
    mime_type: str
    data: Optional[str] = None  # base64
    preview: Optional[str] = None
    size: int = 0


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str
    attachments: Optional[list[ChatAttachment]] = None


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    pedido_nombre: str = ""
    semana: str = ""
    model: str = "claude-sonnet-4-6"


class ChatResponse(BaseModel):
    response: str


# --- Helpers para attachments ---

def _parse_excel_base64(data_b64: str, filename: str, max_rows: int = 50, max_cols: int = 20) -> str:
    """Parsea un Excel base64 y retorna representacion de texto."""
    try:
        raw = base64.b64decode(data_b64)
        wb = openpyxl.load_workbook(io.BytesIO(raw), data_only=True, read_only=True)

        sections = []
        for sheet_name in wb.sheetnames[:3]:
            ws = wb[sheet_name]
            rows = []
            for i, row in enumerate(ws.iter_rows(values_only=True)):
                if i >= max_rows:
                    rows.append(f"... ({ws.max_row - max_rows} filas mas)")
                    break
                cells = [str(c if c is not None else "") for c in row[:max_cols]]
                rows.append(" | ".join(cells))

            if rows:
                sections.append(f"Hoja '{sheet_name}':\n" + "\n".join(rows))

        wb.close()
        return "\n\n".join(sections) if sections else "Archivo vacio"
    except Exception as e:
        return f"Error al parsear Excel: {str(e)}"


def _build_message_content(msg: ChatMessage) -> dict:
    """Construye un mensaje para la API de Claude, manejando attachments multimodal."""
    if not msg.attachments:
        return {"role": msg.role, "content": msg.content}

    content_blocks = []

    for att in msg.attachments:
        if att.type == "image" and att.data:
            content_blocks.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": att.mime_type,
                    "data": att.data,
                },
            })
        elif att.type == "excel" and att.data:
            excel_text = _parse_excel_base64(att.data, att.filename)
            content_blocks.append({
                "type": "text",
                "text": f"[Archivo Excel: {att.filename}]\n{excel_text}",
            })

    if msg.content:
        content_blocks.append({"type": "text", "text": msg.content})

    return {"role": msg.role, "content": content_blocks if content_blocks else msg.content}


# --- Endpoint ---

@router.post("/chat", response_model=ChatResponse)
def chat_endpoint(req: ChatRequest):
    """Chat con el asistente LLM."""
    if not ANTHROPIC_API_KEY:
        raise HTTPException(500, "ANTHROPIC_API_KEY no configurada")

    # Construir contexto desde Supabase
    state = _build_state_from_supabase(req.pedido_nombre, req.semana)
    context = build_context(state)
    system = SYSTEM_PROMPT + "\n\n--- DATOS ACTUALES ---\n" + context

    # Llamar a Claude API
    from anthropic import Anthropic, APIError

    client = Anthropic(api_key=ANTHROPIC_API_KEY)

    # Build messages with multimodal support
    has_attachments = any(m.attachments for m in req.messages if m.attachments)
    messages = [_build_message_content(m) for m in req.messages]
    max_tokens = 4096 if has_attachments else 2048

    try:
        response = client.messages.create(
            model=req.model,
            max_tokens=max_tokens,
            system=system,
            messages=messages,
        )
        return ChatResponse(response=response.content[0].text)
    except APIError as e:
        print(f"[CHAT] Anthropic API error: {e.status_code} {e.message}")
        raise HTTPException(e.status_code or 500, f"Claude API: {e.message}")
    except Exception as e:
        print(f"[CHAT] Error: {e}")
        raise HTTPException(500, f"Error al llamar Claude: {str(e)}")
