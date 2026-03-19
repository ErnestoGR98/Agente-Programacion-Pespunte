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
- Tienes acceso al catalogo, operarios, programa diario con asignacion de operarios, y configuracion

CONCEPTOS CLAVE:
- Pares: unidad de produccion (zapatos = pares)
- Modelo: referencia de producto (ej: 65413)
- Fraccion: cada operacion secuencial de costura de un modelo (F1, F2, ... F10+)
- Input/Proceso: etapa general de la fraccion (PRELIMINARES, ROBOT, POST, MAQUILA, N/A PRELIMINAR)
- Etapa: sub-clasificacion (PRE-ROBOT, ROBOT, MESA, POST-LINEA, ZIGZAG-LINEA, etc.)
- Recurso: tipo de maquina/estacion (MESA, ROBOT, PLANA, POSTE, MAQUILA)
- Plantilla/HC: headcount, personas disponibles por dia
- Tardiness: pares que no se alcanzaron a producir
- Overtime: horas extra (sabado o extension de jornada)
- Robot: maquina de costura automatica (capacidad 1 operario por bloque por robot)
- Bloque: periodo de 1 hora (8-9, 9-10, ..., 5-6) con pausa comida 2:00-3:00
- Maquila: enviar produccion a un taller externo (fracciones con recurso=MAQUILA)
- Avance: pares ya producidos (dias congelados al re-optimizar)
- Cascada: asignacion secuencial de operarios bloque a bloque (MRV + relevo)
- Habilidades: cada operario tiene skills con nivel 1(puede), 2(normal), 3(experto)
- Skills: PRELIMINARES, ROBOTS, MAQ_COMPLEMENTARIAS, ZIGZAG, PLANA_RECTA, DOS_AGUJAS, POSTE_CONV, RIBETE, CODO
- Adelanto: produccion adelantada de un dia posterior cuando hay HC ocioso
- Rezago: pares pendientes de un dia anterior que se pasan al siguiente
- Capacidad instalada: techo teorico de produccion usando SOLO restricciones fisicas (robots, maquinas,
  precedencias). NO usa operarios ni skills. La diferencia entre capacidad y produccion actual = gap por HC/skills.
  Si la capacidad es mucho mayor que lo actual, el cuello de botella es personal (capacitar, contratar).
  Si son similares, el cuello de botella es fisico (maquinas, robots).

RESTRICCIONES (13 tipos que el usuario puede crear en la app):
- Temporales (por semana): PRIORIDAD, MAQUILA, RETRASO_MATERIAL, FIJAR_DIA, FECHA_LIMITE,
  ROBOT_NO_DISPONIBLE, AUSENCIA_OPERARIO, CAPACIDAD_DIA, AJUSTE_VOLUMEN
- Permanentes (reglas): PRECEDENCIA_OPERACION, LOTE_MINIMO_CUSTOM, SECUENCIA, AGRUPAR_MODELOS

COMO ANALIZAR LA PROGRAMACION:
El solver semanal (CP-SAT) decide cuantos pares de cada modelo producir por dia, optimizando:
- Minimizar tardiness (prioridad maxima, peso 100,000 por par)
- Respetar lotes minimos (default 50 pares, multiplos de 100 preferidos)
- Balancear carga entre dias (HC uniforme)
- Minimizar modelos por dia (menos cambios = mas eficiente)
- Consolidar modelos en dias consecutivos (menos span)
- Evitar sabado (peso 500)
- Respetar precedencias, secuencias y capacidades por recurso

El solver diario decide el horario bloque-a-bloque:
- Cada fraccion se asigna a bloques respetando rate y recursos
- Las fracciones van en cascada: F1 produce primero, F2 empieza cuando F1 tiene material
- Operarios se asignan por habilidad y disponibilidad (cascada MRV)
- Robots son exclusivos: 1 operario, 1 operacion por bloque por robot

COMO PROPONER SOLUCIONES:
Cuando el usuario pregunte que hacer o pida sugerencias, analiza los datos y propone acciones CONCRETAS:

1. **Si hay tardiness**: Identificar el cuello de botella (recurso saturado, robot insuficiente,
   HC bajo). Sugerir: PRIORIDAD para el modelo, CAPACIDAD_DIA para agregar HC, o MAQUILA para
   enviar parte de la produccion a taller externo.

2. **Si hay SIN ASIGNAR**: Verificar que operarios con la habilidad correcta esten disponibles
   ese dia. Sugerir: agregar operario al dia, o verificar habilidades faltantes.

3. **Si un modelo no cabe en un dia**: Sugerir FIJAR_DIA para moverlo, o AJUSTE_VOLUMEN para
   reducir cantidad, o dividir en mas dias.

4. **Si robots estan saturados**: Identificar cuales robots estan al 100% y cuales tienen bloques
   libres. Sugerir redistribuir o usar ROBOT_NO_DISPONIBLE para liberar.

5. **Si la carga esta desbalanceada**: Sugerir mover modelos a dias con menor carga usando FIJAR_DIA.

6. **Si hay material retrasado**: Sugerir RETRASO_MATERIAL con el dia de llegada.

Siempre explica POR QUE el solver tomo esa decision y que restriccion crear para cambiarlo.
Usa los nombres exactos de los tipos de restriccion para que el usuario pueda crearlas en la app.
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
        # Detalle por item (modelo + color)
        lines = []
        for r in sorted(pedido, key=lambda x: x["modelo"]):
            color = f" {r.get('color', '')}" if r.get("color") else ""
            fab = r.get("fabrica", "")
            lines.append(f"  {r['modelo']}{color}: {r.get('volumen', 0)} pares ({fab})")
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

    # --- ANALISIS DE DECISIONES DEL SOLVER ---
    # Extraer insights automaticos para que el LLM pueda razonar sobre ellos
    if summary and daily:
        analysis_lines = []

        # 1. Modelos: span (cuantos dias), completitud, dias asignados
        for ms in summary.get("models", []):
            code = ms.get("codigo", "?")
            dias_prod = ms.get("dias_produccion", [])
            span = ms.get("span_dias", 0)
            pct = ms.get("pct_completado", 100)
            tard = ms.get("tardiness", 0)
            vol = ms.get("volumen", 0)
            prod = ms.get("producido", 0)
            dias_str = ", ".join(dias_prod) if isinstance(dias_prod, list) else str(dias_prod)
            status = "COMPLETO" if tard == 0 else f"INCOMPLETO ({tard}p faltantes)"
            analysis_lines.append(
                f"  {code}: {prod}/{vol}p, dias=[{dias_str}], span={span}, {status}"
            )

        # 2. Operaciones SIN ASIGNAR (por dia)
        sin_asignar_total = 0
        sin_asignar_lines = []
        for day_name, dr in daily.items():
            for s in dr.get("schedule", []):
                if s.get("operario") == "SIN ASIGNAR":
                    sin_asignar_total += 1
                    motivo = s.get("motivo_sin_asignar", "sin motivo")
                    sin_asignar_lines.append(
                        f"  {day_name}: {s.get('modelo','?')} F{s.get('fraccion','?')} "
                        f"{s.get('recurso','?')} ({s.get('total',0)}p) — {motivo}"
                    )
        if sin_asignar_lines:
            analysis_lines.append(f"\nOPERACIONES SIN ASIGNAR ({sin_asignar_total}):")
            analysis_lines.extend(sin_asignar_lines[:15])  # limitar
            if len(sin_asignar_lines) > 15:
                analysis_lines.append(f"  ... +{len(sin_asignar_lines) - 15} mas")

        # 3. Utilizacion de recursos por dia (detectar saturacion)
        for day_name, dr in daily.items():
            sched = dr.get("schedule", [])
            if not sched:
                continue
            # Contar HC por recurso
            recurso_hc = {}
            for s in sched:
                r = s.get("recurso", "?")
                recurso_hc[r] = recurso_hc.get(r, 0) + s.get("hc", 0)
            saturated = [f"{r}={hc}HC" for r, hc in sorted(recurso_hc.items()) if hc > 0]
            if saturated:
                analysis_lines.append(f"  {day_name} carga por recurso: {', '.join(saturated)}")

        # 4. Dias con tardiness diaria
        for day_name, dr in daily.items():
            tard = dr.get("total_tardiness", 0)
            if tard > 0:
                analysis_lines.append(
                    f"  {day_name}: {tard}p de tardiness diaria (solver no pudo completar)"
                )

        if analysis_lines:
            sections.append("ANALISIS DE DECISIONES DEL SOLVER:\n" + "\n".join(analysis_lines))

    # Restricciones activas (temporales + reglas permanentes)
    restricciones = state.get("restricciones") or []
    temporales = [r for r in restricciones if r.get("categoria") == "temporal"]
    permanentes = [r for r in restricciones if r.get("categoria") == "permanente"]
    # Fallback para formato anterior (sin categoria)
    sin_cat = [r for r in restricciones if not r.get("categoria")]
    if sin_cat:
        temporales.extend(sin_cat)

    if temporales:
        rest_lines = []
        for r in temporales:
            rest_lines.append(
                f"  [{r['tipo']}] modelo={r.get('modelo','*')} "
                f"params={json.dumps(r.get('parametros', {}), ensure_ascii=False)}"
                f"{' nota=' + r['nota'] if r.get('nota') else ''}"
            )
        sections.append(f"RESTRICCIONES TEMPORALES ({len(temporales)}):\n" + "\n".join(rest_lines))

    if permanentes:
        regla_lines = []
        for r in permanentes:
            regla_lines.append(
                f"  [{r['tipo']}] modelo={r.get('modelo','*')} "
                f"params={json.dumps(r.get('parametros', {}), ensure_ascii=False)}"
                f"{' nota=' + r['nota'] if r.get('nota') else ''}"
            )
        sections.append(f"REGLAS PERMANENTES ({len(permanentes)}):\n" + "\n".join(regla_lines))

    # Avance
    avance = state.get("avance") or {}
    if avance.get("modelos"):
        avance_lines = []
        for modelo, days_data in avance["modelos"].items():
            total = sum(days_data.values())
            day_detail = ", ".join(f"{d}={p}" for d, p in days_data.items() if p > 0)
            avance_lines.append(f"  {modelo}: {total} pares ({day_detail})")
        sections.append("AVANCE DE PRODUCCION:\n" + "\n".join(avance_lines))

    # Catalogo de modelos
    catalogo = state.get("catalogo") or []
    if catalogo:
        robots_activos = state.get("robots_activos", [])
        cat_lines = [f"  Robots activos: {', '.join(robots_activos)}" if robots_activos else ""]
        for m in catalogo:
            alts = f" ({'/'.join(m['alternativas'])})" if m.get("alternativas") else ""
            cat_lines.append(
                f"\n  {m['modelo_num']}{alts}: {m['num_ops']} ops, "
                f"{m['total_sec_per_pair']} sec/par"
            )
            for op in m.get("operaciones", []):
                robots_str = f" [{', '.join(op['robots'])}]" if op.get("robots") else ""
                proceso = op.get("input_o_proceso", "")
                proceso_str = f" ({proceso})" if proceso else ""
                cat_lines.append(
                    f"    F{op['fraccion']} {op['operacion']}: "
                    f"{op['recurso']} rate={op['rate']}"
                    f"{proceso_str}{robots_str}"
                )
        sections.append(f"CATALOGO ({len(catalogo)} modelos):\n" + "\n".join(cat_lines))

    # Operarios (nombres, habilidades, eficiencia, disponibilidad)
    operarios = state.get("operarios") or []
    if operarios:
        op_lines = []
        for op in operarios:
            skills = op.get("habilidades", [])
            skill_str = ", ".join(
                f"{h['habilidad']}(N{h['nivel']})" for h in skills
            ) if skills else "sin habilidades"
            dias = op.get("dias_disponibles", [])
            dias_str = ", ".join(dias) if dias else "todos"
            op_lines.append(
                f"  {op['nombre']}: efic={op.get('eficiencia', 1.0)}, "
                f"dias=[{dias_str}], skills=[{skill_str}]"
            )
        sections.append(f"OPERARIOS ({len(operarios)}):\n" + "\n".join(op_lines))

    # Asignaciones maquila
    maquila_asig = state.get("asignaciones_maquila") or []
    if maquila_asig:
        maq_lines = []
        for a in maquila_asig:
            fecha = a.get("fecha_entrega", "?")
            maq_lines.append(
                f"  {a.get('modelo', '?')}: {a.get('pares', 0)}p -> {a.get('maquila', '?')} "
                f"(entrega: {fecha})"
            )
        sections.append(f"ASIGNACIONES MAQUILA ({len(maquila_asig)}):\n" + "\n".join(maq_lines))

    # Programa diario detallado (operarios asignados por operacion)
    if daily:
        detail_lines = []
        for day_name, dr in daily.items():
            sched = dr.get("schedule", [])
            if not sched:
                continue
            detail_lines.append(f"\n  {day_name}:")
            for s in sched[:30]:  # limitar a 30 entries por dia para no exceder contexto
                operario = s.get("operario", "-")
                sin_asignar = " ⚠SIN ASIGNAR" if operario == "SIN ASIGNAR" else ""
                detail_lines.append(
                    f"    {s.get('modelo', '?')} F{s.get('fraccion', '?')} "
                    f"{s.get('operacion', '?')[:30]} [{s.get('recurso', '?')}] "
                    f"-> {operario}{sin_asignar} ({s.get('total', 0)}p)"
                )
            if len(sched) > 30:
                detail_lines.append(f"    ... +{len(sched) - 30} entries mas")
        sections.append("PROGRAMA DIARIO (operarios asignados):" + "\n".join(detail_lines))

    # Utilizacion de operarios por dia (compacto: % ocupacion + bloques ociosos)
    if daily:
        BLOCK_LABELS = ["8-9", "9-10", "10-11", "11-12", "12-1", "1-2", "COMIDA", "3-4", "4-5", "5-6"]
        PRODUCTIVE_BLOCKS = [i for i, lb in enumerate(BLOCK_LABELS) if lb != "COMIDA"]
        op_util_lines = []
        for day_name, dr in daily.items():
            timelines = dr.get("operator_timelines") or {}
            if not timelines:
                continue
            day_op_lines = []
            for op_name, entries in sorted(timelines.items()):
                # entries puede ser dict {block_idx: [tasks]} o list
                busy_blocks = set()
                if isinstance(entries, dict):
                    for b_str, tasks in entries.items():
                        if tasks:
                            busy_blocks.add(int(b_str))
                elif isinstance(entries, list):
                    for e in entries:
                        if isinstance(e, dict) and e.get("block") is not None:
                            busy_blocks.add(e["block"])
                total_productive = len(PRODUCTIVE_BLOCKS)
                busy_count = len(busy_blocks & set(PRODUCTIVE_BLOCKS))
                pct = int(100 * busy_count / total_productive) if total_productive > 0 else 0
                idle_blocks = [BLOCK_LABELS[i] for i in PRODUCTIVE_BLOCKS if i not in busy_blocks]
                idle_str = f", idle=[{','.join(idle_blocks)}]" if idle_blocks else ""
                day_op_lines.append(f"    {op_name}: {pct}% ({busy_count}/{total_productive} bloques){idle_str}")
            if day_op_lines:
                op_util_lines.append(f"  {day_name}:")
                op_util_lines.extend(day_op_lines)
        if op_util_lines:
            sections.append("UTILIZACION OPERARIOS (por dia):\n" + "\n".join(op_util_lines))

    # Utilizacion de robots por dia (compacto: bloques ocupados/libres)
    if daily:
        robot_util_lines = []
        for day_name, dr in daily.items():
            sched = dr.get("schedule", [])
            if not sched:
                continue
            # Mapear robot -> bloques ocupados
            robot_blocks = {}
            for s in sched:
                robot = s.get("robot") or ""
                if not robot or robot == "MESA" or robot == "PLANA" or robot == "POSTE":
                    continue
                blocks = s.get("blocks", [])
                for bi, p in enumerate(blocks):
                    if p and p > 0:
                        robot_blocks.setdefault(robot, set()).add(bi)
            if robot_blocks:
                day_robot_lines = []
                for rname, busy in sorted(robot_blocks.items()):
                    busy_prod = busy & set(PRODUCTIVE_BLOCKS)
                    pct = int(100 * len(busy_prod) / len(PRODUCTIVE_BLOCKS)) if PRODUCTIVE_BLOCKS else 0
                    free = [BLOCK_LABELS[i] for i in PRODUCTIVE_BLOCKS if i not in busy]
                    free_str = f", libre=[{','.join(free)}]" if free else " LLENO"
                    day_robot_lines.append(f"    {rname}: {pct}%{free_str}")
                robot_util_lines.append(f"  {day_name}:")
                robot_util_lines.extend(day_robot_lines)
        if robot_util_lines:
            sections.append("UTILIZACION ROBOTS (por dia):\n" + "\n".join(robot_util_lines))

    # Configuracion del sistema
    capacidades = state.get("capacidades") or []
    if capacidades:
        cap_lines = [f"  {c['tipo']}: {c['pares_hora']} pares/hora" for c in capacidades]
        sections.append("CAPACIDADES POR RECURSO:\n" + "\n".join(cap_lines))

    dias_lab = state.get("dias_laborales") or []
    if dias_lab:
        dia_lines = []
        for d in dias_lab:
            status = "activo" if d.get("activo") else "inactivo"
            ot = f" +{d.get('minutos_ot', 0)}min OT" if d.get("minutos_ot", 0) > 0 else ""
            dia_lines.append(
                f"  {d['dia']}: {status}, {d.get('minutos', 0)}min, "
                f"plantilla={d.get('plantilla', 0)}{ot}"
            )
        sections.append("DIAS LABORALES:\n" + "\n".join(dia_lines))

    fabricas = state.get("fabricas") or []
    if fabricas:
        if isinstance(fabricas[0], dict):
            fab_lines = [
                f"  {f['nombre']}{' (MAQUILA)' if f.get('es_maquila') else ''}"
                for f in fabricas
            ]
            sections.append("FABRICAS:\n" + "\n".join(fab_lines))
        else:
            sections.append(f"FABRICAS: {', '.join(fabricas)}")

    # Pesos de priorizacion
    pesos = state.get("pesos") or {}
    if pesos:
        pesos_lines = [f"  {k}: {v}" for k, v in sorted(pesos.items())]
        sections.append("PESOS DE PRIORIZACION:\n" + "\n".join(pesos_lines))

    # Parametros de optimizacion
    params_opt = state.get("parametros_opt") or {}
    if params_opt:
        params_lines = [f"  {k}: {v}" for k, v in sorted(params_opt.items())]
        sections.append("PARAMETROS OPTIMIZACION:\n" + "\n".join(params_lines))

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
