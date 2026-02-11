"""
llm_assistant.py - Asistente de lenguaje natural para el sistema de programacion.

Usa la API de Anthropic (Claude) para responder preguntas sobre la programacion
de produccion, restricciones, utilizacion, robots, etc.

El contexto se construye dinamicamente desde el session_state actual.
"""

import json
from anthropic import Anthropic


SYSTEM_PROMPT = """\
Eres el asistente de programacion de produccion de pespunte (costura de calzado).
Tu rol es ayudar al programador de produccion a entender y ajustar la programacion semanal.

REGLAS:
- Responde en espanol, breve y directo
- Usa datos concretos del contexto (numeros, modelos, dias)
- Si no tienes datos suficientes, dilo claramente
- No inventes datos que no esten en el contexto
- Puedes sugerir restricciones o ajustes cuando sea relevante
- Usa formato markdown para tablas y listas cuando ayude a la claridad

CONCEPTOS CLAVE:
- Pares: unidad de produccion (zapatos = pares)
- Modelo: referencia de producto (ej: 65413)
- Fraccion: las operaciones de costura de un modelo
- Plantilla/HC: headcount, personas disponibles por dia
- Tardiness: pares que no se alcanzaron a producir
- Overtime: horas extra (sabado o extension de jornada)
- Robot: maquina de costura automatica (8 fisicas, capacidad 1 por bloque)
- Bloque: periodo de 1 hora (8-9, 9-10, ..., 6-7) con pausa comida 1:10-1:50
- Maquila: enviar produccion a un taller externo
- Avance: pares ya producidos (dias congelados al re-optimizar)
"""


def build_context(state: dict) -> str:
    """Construye el contexto de datos actual para el system prompt."""
    sections = []

    # Pedido
    pedido = state.get("pedido_rows") or []
    if pedido:
        total_vol = sum(r.get("volumen", 0) for r in pedido)
        modelos = sorted({r["modelo"] for r in pedido})
        sections.append(
            f"PEDIDO: {len(modelos)} modelos, {total_vol:,} pares totales\n"
            f"Modelos: {', '.join(modelos)}"
        )
        # Detalle por modelo
        lines = []
        for m in modelos:
            vol = sum(r["volumen"] for r in pedido if r["modelo"] == m)
            fab = next((r.get("fabrica", "") for r in pedido if r["modelo"] == m), "")
            lines.append(f"  {m}: {vol} pares ({fab})")
        sections.append("Detalle pedido:\n" + "\n".join(lines))

    # Resumen semanal
    summary = state.get("weekly_summary")
    if summary:
        sections.append(
            f"RESUMEN SEMANAL:\n"
            f"  Status: {summary['status']}\n"
            f"  Total pares: {summary['total_pares']:,}\n"
            f"  Tardiness: {summary['total_tardiness']} pares sin completar\n"
            f"  Tiempo solver: {summary['wall_time_s']}s"
        )
        # Por dia
        day_lines = []
        for ds in summary.get("days", []):
            ot = f" +{ds['overtime_hrs']}h OT" if ds.get("overtime_hrs", 0) > 0 else ""
            sat = " (SAB)" if ds.get("is_saturday") else ""
            day_lines.append(
                f"  {ds['dia']}{sat}: {ds['pares']} pares, "
                f"HC {ds['hc_necesario']}/{ds['hc_disponible']}, "
                f"{ds['utilizacion_pct']}% util{ot}"
            )
        sections.append("Por dia:\n" + "\n".join(day_lines))

        # Modelos con tardiness
        tard_models = [ms for ms in summary.get("models", []) if ms.get("tardiness", 0) > 0]
        if tard_models:
            tard_lines = [
                f"  {ms['codigo']}: {ms['tardiness']} pares sin completar "
                f"({ms['pct_completado']}% completado)"
                for ms in tard_models
            ]
            sections.append("Modelos con TARDINESS:\n" + "\n".join(tard_lines))

    # Schedule semanal (asignacion por dia)
    schedule = state.get("weekly_schedule")
    if schedule:
        sched_lines = []
        current_day = ""
        for entry in schedule:
            if entry["Dia"] != current_day:
                current_day = entry["Dia"]
                sched_lines.append(f"\n  {current_day}:")
            sched_lines.append(
                f"    {entry['Modelo']} ({entry['Fabrica']}): "
                f"{entry['Pares']} pares, HC={entry['HC_Necesario']}"
            )
        sections.append("SCHEDULE SEMANAL:" + "\n".join(sched_lines))

    # Resultados diarios (resumen)
    daily = state.get("daily_results")
    if daily:
        daily_lines = []
        for day_name, dr in daily.items():
            status = dr.get("status", "?")
            tp = dr.get("total_pares", 0)
            tard = dr.get("total_tardiness", 0)
            plant = dr.get("plantilla", 0)
            daily_lines.append(
                f"  {day_name}: {tp} pares, tardiness={tard}, "
                f"plantilla={plant}, status={status}"
            )
        sections.append("RESULTADOS DIARIOS (bloques):\n" + "\n".join(daily_lines))

    # Restricciones activas
    restricciones = state.get("restricciones") or []
    activas = [r for r in restricciones if r.get("activa", True)]
    if activas:
        rest_lines = []
        for r in activas:
            rest_lines.append(
                f"  [{r['tipo']}] modelo={r.get('modelo','*')} "
                f"params={json.dumps(r.get('parametros', {}), ensure_ascii=False)}"
                f"{' nota=' + r['nota'] if r.get('nota') else ''}"
            )
        sections.append(f"RESTRICCIONES ACTIVAS ({len(activas)}):\n" + "\n".join(rest_lines))

    # Avance
    avance = state.get("avance") or {}
    if avance.get("modelos"):
        avance_lines = []
        for modelo, days_data in avance["modelos"].items():
            total = sum(days_data.values())
            day_detail = ", ".join(f"{d}={p}" for d, p in days_data.items() if p > 0)
            avance_lines.append(f"  {modelo}: {total} pares ({day_detail})")
        sections.append("AVANCE DE PRODUCCION:\n" + "\n".join(avance_lines))

    # Parametros
    params = state.get("params")
    if params:
        day_info = []
        for d in params.get("days", []):
            day_info.append(
                f"  {d['name']}: plantilla={d['plantilla']}, "
                f"{d['minutes']}min + {d.get('minutes_ot',0)}min OT"
            )
        sections.append("PARAMETROS:\n" + "\n".join(day_info))

    if not sections:
        return "No hay datos cargados en el sistema. El usuario debe cargar un pedido y catalogo primero."

    return "\n\n".join(sections)


def chat(messages: list, state: dict, api_key: str, model: str) -> str:
    """
    Envia mensajes al API de Claude y retorna la respuesta.

    Args:
        messages: historial de chat [{role, content}, ...]
        state: session_state dict con datos de produccion
        api_key: Anthropic API key
        model: model ID (ej: claude-sonnet-4-5-20250929)

    Returns:
        Texto de la respuesta del asistente
    """
    client = Anthropic(api_key=api_key)

    context = build_context(state)
    system = SYSTEM_PROMPT + "\n\n--- DATOS ACTUALES ---\n" + context

    response = client.messages.create(
        model=model,
        max_tokens=2048,
        system=system,
        messages=messages,
    )

    return response.content[0].text
