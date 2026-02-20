"""
Endpoint del asistente LLM (Claude API).

Recibe mensajes del chat, construye contexto desde Supabase,
y retorna la respuesta del modelo.
"""

import os
import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from llm_assistant import SYSTEM_PROMPT, build_context

router = APIRouter()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
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
    r.raise_for_status()
    return r.json()


def _build_state_from_supabase(pedido_nombre: str, semana: str = "") -> dict:
    """Construye un dict compatible con build_context() desde Supabase."""
    state = {}

    # Pedido
    ped = _sb_get("pedidos", f"select=id&nombre=eq.{pedido_nombre}")
    if ped:
        items = _sb_get("pedido_items", f"select=*&pedido_id=eq.{ped[0]['id']}")
        state["pedido_rows"] = [
            {
                "modelo": it["modelo_num"],
                "color": it.get("color", ""),
                "volumen": it["volumen"],
                "fabrica": it.get("fabrica", ""),
            }
            for it in items
        ]

    # Resultado mas reciente
    q = "select=*&order=created_at.desc&limit=1"
    if semana:
        q = f"select=*&base_name=eq.{semana}&order=version.desc&limit=1"
    resultados = _sb_get("resultados", q)

    if resultados:
        res = resultados[0]
        state["weekly_schedule"] = res.get("weekly_schedule")
        state["weekly_summary"] = res.get("weekly_summary")
        state["daily_results"] = res.get("daily_results")
        state["params"] = res.get("params_snapshot")

    # Restricciones
    rq = "select=*&activa=eq.true&order=created_at"
    if semana:
        rq += f"&semana=eq.{semana}"
    restricciones = _sb_get("restricciones", rq)
    state["restricciones"] = [
        {
            "tipo": r["tipo"],
            "modelo": r.get("modelo_num", ""),
            "activa": r["activa"],
            "parametros": r.get("parametros", {}),
            "nota": r.get("nota", ""),
        }
        for r in restricciones
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

class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    pedido_nombre: str = ""
    semana: str = ""
    model: str = "claude-sonnet-4-5-20250929"


class ChatResponse(BaseModel):
    response: str


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
    from anthropic import Anthropic

    client = Anthropic(api_key=ANTHROPIC_API_KEY)
    messages = [{"role": m.role, "content": m.content} for m in req.messages]

    response = client.messages.create(
        model=req.model,
        max_tokens=2048,
        system=system,
        messages=messages,
    )

    return ChatResponse(response=response.content[0].text)
