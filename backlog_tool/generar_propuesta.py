"""
Generador de propuesta optimizada de distribución semanal de un backlog.

USO:
    python scripts/generar_propuesta_backlog.py --input <archivo.xlsx>

OPCIONES:
    --input PATH            Excel del backlog (formato Andrea)
    --output PATH           Salida (default: <input>_OPTIMIZADO.xlsx)
    --template PATH         Template Excel con estructura/imágenes/fórmulas
                            (default: Matriz_Horas_Backlog_Andrea_Propuesta.xlsx)
    --max-modelos N         Máx modelos activos por semana (default: 5)
    --semanas A-B           Rango de semanas (default: lee del Excel)
    --excluir LIST          Modelos a excluir, separados por coma
    --fijar M:S1,S2         Fijar modelo M en semanas S1,S2 (repetible)
    --no-aislar M           No aislar el modelo robot-restringido M
    --max-sem N             Máx semanas por modelo (default: 3)
    --no-overrides          Ignorar overrides.yaml
    --dry-run               No escribir Excel, solo imprimir distribución

REGLAS APLICADAS (playbook):
    R1) Lotes contiguos: <=1500 -> 1 sem, <=2200 -> 2 sem, >2200 -> 3 sem
    R2) Mezcla baja: max 5 modelos activos por semana
    R3) Capacidad robot no excedida (9 robots PESPUNTE x 50h/sem = 450 h)
    R4) Modelos con robots restringidos se aíslan primero
    R5) Modelos neutros (sin catálogo o solo MAQUILA) como relleno

PRECEDENCIA DE OVERRIDES:
    1. Flags CLI
    2. scripts/overrides.yaml (si existe y activo)
    3. Restricciones activas en Supabase (FECHA_LIMITE, ROBOT_NO_DISPONIBLE, etc.)
    4. Defaults del playbook
"""
import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import date, datetime
from pathlib import Path

import openpyxl
from openpyxl.utils import get_column_letter

# ============================================================
# CONFIGURACIÓN SUPABASE
# ============================================================
SUPABASE_URL = "https://folmyddedsdzlbegumbo.supabase.co"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvbG15ZGRlZHNkemxiZWd1bWJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MDcwNDYsImV4cCI6MjA4NzE4MzA0Nn0.RwCvujunSKA-zc704OlrEDkWlpWkOEIaavQAMD6-ewU"
HEADERS = {
    "apikey": ANON_KEY,
    "Authorization": f"Bearer {ANON_KEY}",
    "Content-Type": "application/json",
}

# ============================================================
# DEFAULTS DEL PLAYBOOK
# ============================================================
HRS_SEM_POR_ROBOT = 50         # L-V 9h*5 + Sab 5h
MAX_MOD_SEM_DEF = 5
MAX_SEM_MOD_DEF = 3
ROBOT_RESTRINGIDO_THRESHOLD = 3  # operación con <=3 robots compatibles = restringida

# ============================================================
# UTILIDADES SUPABASE (HTTP plano, sin sdk)
# ============================================================
def sb_get(table, params=""):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{params}"
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(f"[ERROR Supabase] {e.code} en {table}: {e.read().decode()[:200]}", file=sys.stderr)
        return []
    except Exception as e:
        print(f"[ERROR red] {e}", file=sys.stderr)
        return []

def fetch_robots_activos():
    """Robots PESPUNTE activos compatibles con la familia general."""
    rows = sb_get("robots", "select=id,nombre,estado,area")
    return [r for r in rows if r["estado"] == "ACTIVO" and r["area"] == "PESPUNTE"]

def fetch_catalogo():
    """{modelo_num: {alternativas, seg_par por etapa, robots_restringido, imagen_url}}"""
    modelos = sb_get("catalogo_modelos", "select=id,modelo_num,alternativas,total_sec_per_pair,imagen_url,alternativas_imagenes")
    out = {}
    for m in modelos:
        out[m["modelo_num"]] = {
            "id": m["id"],
            "alternativas": m.get("alternativas") or [],
            "total_sec_per_pair": m.get("total_sec_per_pair") or 0,
            "imagen_url": m.get("imagen_url") or "",
            "alternativas_imagenes": m.get("alternativas_imagenes") or {},
            "PRE": 0, "ROB": 0, "POST": 0, "NA": 0, "MAQ": 0,
            "ops": [],
            "robot_restringido": False,
        }
    # operaciones
    ops = sb_get("catalogo_operaciones", "select=id,modelo_id,etapa,fraccion,operacion,recurso,sec_per_pair")
    op_by_modelo = {}
    for op in ops:
        op_by_modelo.setdefault(op["modelo_id"], []).append(op)
    # robots por operación
    cor = sb_get("catalogo_operacion_robots", "select=operacion_id,robot_id")
    robots_per_op = {}
    for c in cor:
        robots_per_op.setdefault(c["operacion_id"], []).append(c["robot_id"])

    PROC_MAP = {
        "MAQUILA": "MAQ",
        "PLANA": "POST", "POSTE": "POST", "PLANA,POSTE": "POST",
        "MESA": "PRE",
        "ROBOT": "ROB",
    }
    for num, m in out.items():
        for op in op_by_modelo.get(m["id"], []):
            recurso = (op.get("recurso") or "").upper()
            seg = op.get("sec_per_pair") or 0
            etapa_key = None
            if "ROBOT" in recurso:
                etapa_key = "ROB"
            elif "MAQUILA" in recurso:
                etapa_key = "MAQ"
            elif "POST" in (op.get("etapa") or "").upper() or "POSTE" in recurso:
                etapa_key = "POST"
            elif "PLANA" in recurso:
                etapa_key = "POST"
            elif "MESA" in recurso:
                etapa_key = "PRE"
            else:
                etapa_key = "PRE"
            m[etapa_key] += seg
            m["ops"].append(op)
            # restricción robots
            if etapa_key == "ROB":
                rids = robots_per_op.get(op["id"], [])
                if 0 < len(rids) <= ROBOT_RESTRINGIDO_THRESHOLD:
                    m["robot_restringido"] = True
    return out

def fetch_restricciones_activas():
    rows = sb_get("restricciones", "select=tipo,modelo_num,semana,parametros&activa=eq.true")
    return rows

# ============================================================
# OVERRIDES YAML
# ============================================================
def load_overrides():
    # Está en la misma carpeta que este script (backlog_tool/)
    p = Path(__file__).parent / "overrides.yaml"
    if not p.exists():
        return {}
    try:
        import yaml
    except ImportError:
        print("[WARN] PyYAML no instalado, ignorando overrides.yaml. pip install pyyaml", file=sys.stderr)
        return {}
    data = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    if not data.get("activo", True):
        return {}
    fecha_exp = data.get("fecha_expira")
    if fecha_exp:
        if isinstance(fecha_exp, str):
            fecha_exp = datetime.fromisoformat(fecha_exp).date()
        if date.today() > fecha_exp:
            print(f"[WARN] overrides.yaml expirado el {fecha_exp}, ignorando.", file=sys.stderr)
            return {}
    return data.get("overrides", {})

# ============================================================
# LECTURA DEL BACKLOG INPUT
# ============================================================
def parse_backlog(path):
    """Devuelve [(modelo_str, total_pares)] y lista de semanas.

    Soporta 2 formatos:
    A) Simple: celdas 'Semana inicio'/'Semana fin' + columna 'Modelo' + 'Total Pares'
    B) Legacy: matriz modelo×semana (suma cada fila para obtener total)
    """
    wb = openpyxl.load_workbook(path, data_only=True)
    # === Formato A: simple ===
    for sn in wb.sheetnames:
        ws = wb[sn]
        sem_ini = sem_fin = None
        for r in range(1, min(ws.max_row + 1, 15)):
            for c in range(1, min(ws.max_column + 1, 10)):
                v = ws.cell(row=r, column=c).value
                if not isinstance(v, str): continue
                low = v.lower().strip()
                if "semana" in low and "inicio" in low:
                    nxt = ws.cell(row=r, column=c+1).value
                    if isinstance(nxt, (int, float)): sem_ini = int(nxt)
                elif "semana" in low and "fin" in low:
                    nxt = ws.cell(row=r, column=c+1).value
                    if isinstance(nxt, (int, float)): sem_fin = int(nxt)
        if sem_ini and sem_fin and sem_fin >= sem_ini:
            # buscar cabecera "Modelo" en alguna fila
            for r in range(1, min(ws.max_row + 1, 20)):
                for c in range(1, min(ws.max_column + 1, 10)):
                    v = ws.cell(row=r, column=c).value
                    if not (isinstance(v, str) and v.strip().lower() == "modelo"):
                        continue
                    # Detectar columnas: revisar las siguientes 1-3 columnas
                    # buscando "alternativas" / "alternativa" y "total pares"
                    col_modelo = c
                    col_alt = None
                    col_total = None
                    for off in range(1, 5):
                        h = ws.cell(row=r, column=c + off).value
                        if not isinstance(h, str): continue
                        hl = h.strip().lower()
                        if "alternativ" in hl and col_alt is None:
                            col_alt = c + off
                        elif "total" in hl and "par" in hl and col_total is None:
                            col_total = c + off
                    if col_total is None:
                        continue  # no es la cabecera buscada
                    # Leer filas
                    modelos = []
                    rr = r + 1
                    while rr <= ws.max_row + 30:
                        nm_raw = ws.cell(row=rr, column=col_modelo).value
                        tot_raw = ws.cell(row=rr, column=col_total).value
                        alt_raw = ws.cell(row=rr, column=col_alt).value if col_alt else None

                        if nm_raw is None and tot_raw is None:
                            rr += 1
                            if rr > r + 60: break
                            continue
                        if isinstance(nm_raw, str) and nm_raw.strip().upper() == "TOTAL":
                            break
                        # Modelo: aceptar número o string. Lo normalizamos a string.
                        if nm_raw is None:
                            rr += 1
                            continue
                        if isinstance(nm_raw, (int, float)):
                            modelo_str = str(int(nm_raw))
                        else:
                            modelo_str = str(nm_raw).strip()
                        if not modelo_str or modelo_str.startswith("("):  # placeholders tipo "(modelo)"
                            rr += 1
                            continue
                        if not isinstance(tot_raw, (int, float)) or tot_raw <= 0:
                            rr += 1
                            continue
                        # Combinar modelo + alternativa
                        alt_str = ""
                        if alt_raw and isinstance(alt_raw, str) and not alt_raw.strip().startswith("("):
                            alt_str = alt_raw.strip()
                        nombre_completo = f"{modelo_str} {alt_str}".strip()
                        modelos.append((nombre_completo, int(tot_raw)))
                        rr += 1
                        if rr > r + 60: break
                    if modelos:
                        semanas = list(range(sem_ini, sem_fin + 1))
                        return modelos, semanas
    # === Formato B: legacy (matriz modelo×semana) ===
    for sn in wb.sheetnames:
        ws = wb[sn]
        for r in range(1, min(ws.max_row + 1, 10)):
            for c in range(1, min(ws.max_column + 1, 15)):
                v = ws.cell(row=r, column=c).value
                if v and isinstance(v, str) and "semana" in v.lower():
                    for rr in range(r, r + 3):
                        nums = []
                        for cc in range(c, ws.max_column + 1):
                            val = ws.cell(row=rr, column=cc).value
                            if isinstance(val, (int, float)) and 1 <= val <= 53:
                                nums.append((cc, int(val)))
                        if len(nums) >= 3:
                            return _read_modelos(ws, rr + 1, nums)
    raise RuntimeError(f"No se encontró tabla de backlog en {path}")

def _read_modelos(ws, start_row, sem_cols):
    """Desde start_row hacia abajo, lee filas con modelo+pares."""
    modelos = []
    semanas = [s for _, s in sem_cols]
    cols = [c for c, _ in sem_cols]
    # columna de modelo: la inmediatamente anterior a la primera col de semana
    col_modelo = cols[0] - 1
    while col_modelo > 0:
        v = ws.cell(row=start_row, column=col_modelo).value
        if v and isinstance(v, str):
            break
        col_modelo -= 1
    if col_modelo < 1:
        col_modelo = cols[0] - 1
    r = start_row
    while r <= ws.max_row + 5:
        nm = ws.cell(row=r, column=col_modelo).value
        if not nm or not isinstance(nm, str) or nm.strip() in ("", "TOTAL"):
            r += 1
            if r > start_row + 30:
                break
            continue
        nm = nm.strip()
        # sumar pares de las columnas semana
        total = 0
        for c in cols:
            v = ws.cell(row=r, column=c).value
            if isinstance(v, (int, float)):
                total += int(v)
        if total > 0:
            modelos.append((nm, total))
        r += 1
        if len(modelos) >= 50:
            break
    return modelos, semanas

# ============================================================
# MATCHING modelo_str -> modelo_num
# ============================================================
def match_modelo(nm, catalogo_db):
    """Extrae el modelo_num del string '68127 NE/RO SLI'."""
    import re
    m = re.match(r"(\d{4,6})", nm.strip())
    if not m: return None
    num = m.group(1)
    return num if num in catalogo_db else None

# ============================================================
# ALGORITMO GREEDY (playbook)
# ============================================================
def n_sem_por_volumen(t, max_sem):
    if t <= 1500: return 1
    if t <= 2200: return min(2, max_sem)
    return min(3, max_sem)

def horas_robot_total(seg_par_rob, total):
    return total * seg_par_rob / 3600

def distribuir(modelos, semanas, catalogo_db, cap_robot_sem, opts):
    """
    modelos: [(nombre_str, total_pares)]
    Retorna: dict {nombre: {sem: pares}}, dict {sem: carga_robot}
    """
    asig = {n: {s: 0 for s in semanas} for n, _ in modelos}
    carga = {s: 0.0 for s in semanas}
    mods = {s: 0 for s in semanas}

    # info por modelo
    info = {}
    for n, t in modelos:
        num = match_modelo(n, catalogo_db)
        if num and num in catalogo_db:
            cat = catalogo_db[num]
            info[n] = {
                "ROB": cat["ROB"],
                "PRE": cat["PRE"],
                "POST": cat["POST"],
                "NA": cat["NA"],
                "MAQ": cat["MAQ"],
                "robot_restringido": cat["robot_restringido"],
                "neutro": cat["ROB"] == 0,
                "sin_catalogo": False,
            }
        else:
            info[n] = {"ROB":0,"PRE":0,"POST":0,"NA":0,"MAQ":0,
                       "robot_restringido": False, "neutro": True, "sin_catalogo": True}

    # aplicar fijaciones
    fijar = opts.get("fijar", {})
    for n, _ in modelos:
        if n in fijar:
            asig[n] = {s: 0 for s in semanas}

    # orden: restringidos -> robot-share por h-robot desc -> neutros
    def prio(item):
        n, t = item
        i = info[n]
        if n in fijar: return (-1, 0)
        if i["robot_restringido"] and n not in opts.get("no_aislar", set()):
            return (0, 0)
        if i["neutro"]:
            return (2, -t)
        return (1, -horas_robot_total(i["ROB"], t))

    orden = sorted(modelos, key=prio)
    max_sem = opts.get("max_sem", MAX_SEM_MOD_DEF)
    max_mod = opts.get("max_mod", MAX_MOD_SEM_DEF)

    for n, total in orden:
        # si está fijado, distribuir parejo en sus semanas
        if n in fijar:
            sems_fijas = [s for s in fijar[n] if s in semanas]
            if not sems_fijas:
                continue
            base = total // len(sems_fijas)
            resto = total - base * len(sems_fijas)
            for i, s in enumerate(sems_fijas):
                v = base + (1 if i < resto else 0)
                v = round(v / 100) * 100
                asig[n][s] = v
                if not info[n]["neutro"]:
                    carga[s] += v * info[n]["ROB"] / 3600
                mods[s] += 1
            # ajuste exacto
            diff = total - sum(asig[n].values())
            if diff:
                asig[n][sems_fijas[0]] += diff
            continue

        N = n_sem_por_volumen(total, max_sem)
        base = total // N
        bloques = [base] * N
        for i in range(total - base * N): bloques[i] += 1
        rb = [round(b / 100) * 100 for b in bloques]
        diff = total - sum(rb)
        if diff: rb[0] += diff
        bloques = rb

        is_neutro = info[n]["neutro"]
        h_par = info[n]["ROB"] / 3600 if not is_neutro else 0
        es_restringido = info[n]["robot_restringido"] and n not in opts.get("no_aislar", set())

        mejor = None
        mejor_score = float("inf")
        for st in range(len(semanas) - N + 1):
            vent = semanas[st:st + N]
            if any(mods[s] >= max_mod for s in vent): continue
            if is_neutro:
                score = sum(mods[s] for s in vent) * 1000 - sum(carga[s] for s in vent)
            elif es_restringido:
                score = sum(carga[s] for s in vent)
            else:
                pico = max(carga[vent[k]] + bloques[k] * h_par for k in range(N))
                score = pico * (10 if pico > cap_robot_sem else 1)
            if score < mejor_score:
                mejor_score = score; mejor = vent

        if mejor is None:
            mejor = sorted(sorted(semanas, key=lambda s: (mods[s] >= max_mod, carga[s]))[:N])

        for k, s in enumerate(mejor):
            asig[n][s] += bloques[k]
            if not is_neutro:
                carga[s] += bloques[k] * h_par
            mods[s] += 1

    return asig, carga, info

# ============================================================
# ESCRITURA EXCEL
# ============================================================
def safe_set(ws, r, c, v):
    try:
        ws.cell(row=r, column=c).value = v
    except AttributeError:
        coord = f"{get_column_letter(c)}{r}"
        for rng in list(ws.merged_cells.ranges):
            if coord in rng:
                ws.unmerge_cells(str(rng)); break
        ws.cell(row=r, column=c).value = v

def escribir_excel(template_path, output_path, asig, info, semanas):
    wb = openpyxl.load_workbook(template_path)

    # Backlog
    if "Backlog" in wb.sheetnames:
        ws = wb["Backlog"]
        safe_set(ws, 1, 1, "PROPUESTA OPTIMIZADA - data-driven")
        safe_set(ws, 2, 1, f"Generado por scripts/generar_propuesta_backlog.py")
        for r in range(5, 25):
            nm = ws.cell(row=r, column=2).value
            if not nm: continue
            nm = str(nm).strip()
            if nm == "TOTAL" or nm not in asig: continue
            for j, s in enumerate(semanas):
                v = asig[nm][s]
                safe_set(ws, r, 3 + j, v if v > 0 else None)

    # Backlog Original
    if "Backlog Original" in wb.sheetnames:
        ws = wb["Backlog Original"]
        for r in range(4, 25):
            nm = ws.cell(row=r, column=3).value
            if not nm: continue
            nm = str(nm).strip()
            if nm not in asig: continue
            for j, s in enumerate(semanas):
                v = asig[nm][s]
                safe_set(ws, r, 5 + j, v if v > 0 else None)

    # Hojas semanales
    # IMPORTANTE: limpiar TODAS las hojas Sem* del template (no solo las del rango)
    # para evitar datos huérfanos que generen referencias circulares.
    for sn_clean in [s for s in wb.sheetnames if s.startswith("Sem ")]:
        ws_c = wb[sn_clean]
        for r in range(5, ws_c.max_row + 5):
            for c in range(2, 21):
                safe_set(ws_c, r, c, None)
    for s in semanas:
        sn = f"Sem {s}"
        if sn not in wb.sheetnames: continue
        ws = wb[sn]
        activos = [(n, asig[n][s]) for n in asig if asig[n][s] > 0]
        r = 6
        for n, pares in activos:
            safe_set(ws, r, 2, n)
            safe_set(ws, r, 3, pares)
            i = info.get(n, {})
            if i.get("sin_catalogo"):
                safe_set(ws, r, 4, "SIN CATALOGO")
                safe_set(ws, r, 20, "—")
            else:
                if i.get("PRE", 0) > 0:
                    safe_set(ws, r, 4, i["PRE"])
                    safe_set(ws, r, 5, f"=C{r}*D{r}/3600")
                    safe_set(ws, r, 6, f"=E{r}/$F$2")
                    safe_set(ws, r, 7, f"=F{r}/$C$2")
                else: safe_set(ws, r, 4, "—")
                if i.get("ROB", 0) > 0:
                    safe_set(ws, r, 8, i["ROB"])
                    safe_set(ws, r, 9, f"=C{r}*H{r}/3600")
                    safe_set(ws, r, 10, f"=I{r}/$J$2")
                    safe_set(ws, r, 11, f"=J{r}/$C$2")
                else: safe_set(ws, r, 8, "—")
                if i.get("POST", 0) > 0:
                    safe_set(ws, r, 12, i["POST"])
                    safe_set(ws, r, 13, f"=C{r}*L{r}/3600")
                    safe_set(ws, r, 14, f"=M{r}/$N$2")
                    safe_set(ws, r, 15, f"=N{r}/$C$2")
                else: safe_set(ws, r, 12, "—")
                if i.get("NA", 0) > 0:
                    safe_set(ws, r, 16, i["NA"])
                    safe_set(ws, r, 17, f"=C{r}*P{r}/3600")
                else: safe_set(ws, r, 16, "—")
                if i.get("MAQ", 0) > 0:
                    safe_set(ws, r, 18, i["MAQ"])
                    safe_set(ws, r, 19, f"=C{r}*R{r}/3600")
                else: safe_set(ws, r, 18, "—")
                parts = []
                for col, key in [("E","PRE"),("I","ROB"),("M","POST"),("Q","NA"),("S","MAQ")]:
                    if i.get(key, 0) > 0: parts.append(f"{col}{r}")
                safe_set(ws, r, 20, "=" + "+".join(parts) if parts else 0)
            r += 1
        rt = r; first = 6
        safe_set(ws, rt, 2, "TOTAL")
        if rt > first:
            # Hay al menos un modelo: SUM normal
            safe_set(ws, rt, 3, f"=SUM(C{first}:C{rt-1})")
            for col_letter in ["E","F","G","I","J","K","M","N","O","Q","S","T"]:
                col_idx = openpyxl.utils.column_index_from_string(col_letter)
                safe_set(ws, rt, col_idx, f"=SUM({col_letter}{first}:{col_letter}{rt-1})")
        else:
            # Semana sin modelos: valores fijos en 0 para evitar referencia circular
            safe_set(ws, rt, 3, 0)
            for col_letter in ["E","F","G","I","J","K","M","N","O","Q","S","T"]:
                col_idx = openpyxl.utils.column_index_from_string(col_letter)
                safe_set(ws, rt, col_idx, 0)

    # Resumen Semanal
    if "Resumen Semanal" in wb.sheetnames:
        ws_r = wb["Resumen Semanal"]
        for r in range(5, ws_r.max_row + 2):
            for c in range(2, 21):
                safe_set(ws_r, r, c, None)
        r = 5
        for s in semanas:
            activos_n = sum(1 for n in asig if asig[n][s] > 0)
            rt = 6 + activos_n
            sn_q = f"'Sem {s}'"
            safe_set(ws_r, r, 2, f"Sem {s}")
            for col, letter in [(3,"C"),(5,"E"),(6,"F"),(7,"G"),(9,"I"),(10,"J"),(11,"K"),(13,"M"),(14,"N"),(15,"O"),(17,"Q"),(19,"S"),(20,"T")]:
                safe_set(ws_r, r, col, f"={sn_q}!{letter}{rt}")
            r += 1
        safe_set(ws_r, r, 2, "TOTAL")
        for col, letter in [(3,"C"),(5,"E"),(6,"F"),(7,"G"),(9,"I"),(10,"J"),(11,"K"),(13,"M"),(14,"N"),(15,"O"),(17,"Q"),(19,"S"),(20,"T")]:
            safe_set(ws_r, r, col, f"=SUM({letter}5:{letter}{r-1})")

    # formato 1 decimal
    COLS_DEC = [5,6,7,9,10,11,13,14,15,17,19,20]
    for sn in [f"Sem {s}" for s in semanas] + ["Resumen Semanal"]:
        if sn not in wb.sheetnames: continue
        ws = wb[sn]
        for r in range(5, ws.max_row + 1):
            for c in COLS_DEC:
                cell = ws.cell(row=r, column=c)
                if cell.value is not None: cell.number_format = "0.0"

    wb.save(output_path)

# ============================================================
# MAIN
# ============================================================
def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--input", required=True, help="Excel del backlog (ruta absoluta o nombre dentro de backlog_tool/inputs/)")
    p.add_argument("--output", help="Excel salida (default: backlog_tool/outputs/<nombre>)")
    p.add_argument("--template", help="Plantilla visual (default: backlog_tool/template_visual.xlsx)")
    p.add_argument("--max-modelos", type=int)
    p.add_argument("--max-sem", type=int)
    p.add_argument("--excluir", default="")
    p.add_argument("--fijar", action="append", default=[], help="MODELO_NUM:S1,S2 (repetible)")
    p.add_argument("--no-aislar", default="")
    p.add_argument("--no-overrides", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    TOOL_DIR = Path(__file__).parent
    INPUTS_DIR = TOOL_DIR / "inputs"
    OUTPUTS_DIR = TOOL_DIR / "outputs"
    OUTPUTS_DIR.mkdir(exist_ok=True)

    # Resolver input: ruta absoluta -> tal cual; si no, buscar en inputs/, luego en cwd
    inp = Path(args.input)
    if not inp.is_absolute():
        candidates = [INPUTS_DIR / args.input, Path.cwd() / args.input, inp]
        for c in candidates:
            if c.exists():
                inp = c; break
    if not inp.exists():
        print(f"[ERROR] No existe: {args.input}", file=sys.stderr)
        print(f"        Busqué en: {INPUTS_DIR}, {Path.cwd()}", file=sys.stderr)
        sys.exit(1)

    if args.output:
        out = Path(args.output)
    else:
        import re
        stem = re.sub(r"[_\- ]?MANUAL", "", inp.stem, flags=re.IGNORECASE).strip("_- ")
        now = datetime.now()
        iso_week = now.isocalendar().week
        out = OUTPUTS_DIR / f"{stem}_OPTIMIZADO_S{iso_week:02d}_{now:%Y%m%d_%H%M}.xlsx"

    # 1) Leer overrides yaml
    ov = {} if args.no_overrides else load_overrides()

    # 2) Combinar opts (CLI > YAML > defaults)
    opts = {
        "max_mod": args.max_modelos or ov.get("max_modelos_semana") or MAX_MOD_SEM_DEF,
        "max_sem": args.max_sem or ov.get("max_semanas_modelo") or MAX_SEM_MOD_DEF,
        "excluir": set([s.strip() for s in args.excluir.split(",") if s.strip()]) | set(ov.get("excluir", [])),
        "no_aislar": set([s.strip() for s in args.no_aislar.split(",") if s.strip()]) | set(ov.get("no_aislar", [])),
        "fijar": dict(ov.get("fijar", {})),
    }
    for f in args.fijar:
        if ":" in f:
            k, v = f.split(":", 1)
            opts["fijar"][k.strip()] = [int(x) for x in v.split(",") if x.strip().isdigit()]

    cap_extra = ov.get("capacidad_robot_extra", 0)

    # 3) Leer backlog
    print(f"[1/5] Leyendo backlog: {inp.name}")
    modelos, semanas = parse_backlog(inp)
    print(f"      {len(modelos)} modelos, semanas {semanas}")
    # filtrar excluidos
    if opts["excluir"]:
        modelos = [(n, t) for n, t in modelos if not any(e in n for e in opts["excluir"])]
        print(f"      excluidos: {opts['excluir']} -> {len(modelos)} restantes")

    # 4) Consultar Supabase
    print("[2/5] Consultando Supabase...")
    robots = fetch_robots_activos()
    catalogo = fetch_catalogo()
    restricciones = fetch_restricciones_activas()
    n_robots_compartidos = sum(1 for r in robots if not r["nombre"].lower().startswith(("maq.","remach","perfor","desheb","cabina","m-cod")))
    cap_robot_sem = max(1, n_robots_compartidos * HRS_SEM_POR_ROBOT + cap_extra)
    print(f"      {n_robots_compartidos} robots compartidos activos -> capacidad {cap_robot_sem} h-robot/sem")
    print(f"      {len(catalogo)} modelos en catálogo, {len(restricciones)} restricciones activas (mayoría precedencias intra-modelo)")

    # 5) Distribuir
    print("[3/5] Aplicando algoritmo greedy con reglas del playbook...")
    asig, carga, info = distribuir(modelos, semanas, catalogo, cap_robot_sem, opts)

    # 6) Validar
    print("[4/5] Validando...")
    errores = []
    for n, t in modelos:
        s = sum(asig[n].values())
        if s != t:
            errores.append(f"  FAIL {n}: {s} != {t}")
    for sem in semanas:
        if carga[sem] > cap_robot_sem * 1.05:
            errores.append(f"  FAIL Sem {sem}: {carga[sem]:.1f} h > capacidad {cap_robot_sem}")
    if errores:
        print("\n".join(errores), file=sys.stderr)

    # 7) Reporte
    print("[5/5] Distribución resultante:")
    print(f"  {'Sem':<5} {'Pares':>7} {'h-Robot':>10} {'%Cap':>6} {'#Mod':>6}")
    for s in semanas:
        nm = sum(1 for n in asig if asig[n][s] > 0)
        pct = carga[s] / cap_robot_sem * 100
        print(f"  {s:<5} {sum(asig[n][s] for n in asig):>7} {carga[s]:>10.1f} {pct:>5.0f}% {nm:>6}")
    print(f"\n  Modelos:")
    for n, t in modelos:
        sus = [s for s in semanas if asig[n][s] > 0]
        print(f"    {n:<22} -> {sus}")

    # 8) Escribir Excel
    if args.dry_run:
        print("\n[dry-run] No se escribe Excel.")
        return
    template = Path(args.template) if args.template else (TOOL_DIR / "template_visual.xlsx")
    if not template.exists():
        print(f"[ERROR] Template no existe: {template}", file=sys.stderr); sys.exit(1)
    print(f"\nEscribiendo: {out}")
    escribir_excel(template, out, asig, info, semanas)
    print("OK.")

if __name__ == "__main__":
    main()
