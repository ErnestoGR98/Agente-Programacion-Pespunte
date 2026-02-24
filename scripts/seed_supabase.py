"""
Seed Supabase DB with data from template_pespunte_v2.xlsx (authoritative source).
Replaces all operations, robots, and operators.
"""
import json
import math
import urllib.request
import urllib.error

SUPABASE_URL = "https://folmyddedsdzlbegumbo.supabase.co"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvbG15ZGRlZHNkemxiZWd1bWJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MDcwNDYsImV4cCI6MjA4NzE4MzA0Nn0.RwCvujunSKA-zc704OlrEDkWlpWkOEIaavQAMD6-ewU"

HEADERS = {
    "apikey": ANON_KEY,
    "Authorization": f"Bearer {ANON_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

MODEL_IDS = {
    "65568": "14ebaaa7-a0b5-47b9-bab9-3535eb016941",
    "68127": "49efafee-43fb-4707-8753-6eff974ae118",
    "65413": "09a4760c-bb6c-4206-956d-3af8e8e4df5e",
    "77525": "145546d1-8730-4d70-ad9f-8c22469018bb",
    "94750": "160c4e18-5cfa-4377-9762-789403351437",
}

# ============================================================
# Helpers
# ============================================================

def sb_request(method, path, data=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            text = resp.read().decode()
            return json.loads(text) if text.strip() else []
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"  ERROR {e.code}: {err}")
        raise

def sb_delete(table, filt):
    print(f"  DELETE {table}?{filt}")
    sb_request("DELETE", f"{table}?{filt}")

def sb_insert(table, rows):
    print(f"  INSERT {table}: {len(rows)} rows")
    return sb_request("POST", table, rows)

def sb_patch(table, filt, data):
    print(f"  PATCH {table}?{filt}")
    return sb_request("PATCH", f"{table}?{filt}", data)

def sec_from_rate(rate):
    return round(3600 / rate) if rate > 0 else 0

# ============================================================
# 1. ROBOTS — from ROBOTS_FISICOS sheet (15 total)
# ============================================================

ROBOTS = [
    {"nombre": "2A-3020-M1",  "estado": "ACTIVO",            "area": "PESPUNTE", "orden": 1},
    {"nombre": "2A-3020-M2",  "estado": "ACTIVO",            "area": "PESPUNTE", "orden": 2},
    {"nombre": "3020-M1",     "estado": "ACTIVO",            "area": "PESPUNTE", "orden": 3},
    {"nombre": "3020-M2",     "estado": "ACTIVO",            "area": "PESPUNTE", "orden": 4},
    {"nombre": "3020-M3",     "estado": "FUERA DE SERVICIO", "area": "PESPUNTE", "orden": 5},
    {"nombre": "3020-M4",     "estado": "ACTIVO",            "area": "AVIOS",    "orden": 6},
    {"nombre": "3020-M5",     "estado": "FUERA DE SERVICIO", "area": "PESPUNTE", "orden": 7},
    {"nombre": "3020-M6",     "estado": "ACTIVO",            "area": "AVIOS",    "orden": 8},
    {"nombre": "6040-M1",     "estado": "FUERA DE SERVICIO", "area": "PESPUNTE", "orden": 9},
    {"nombre": "6040-M2",     "estado": "FUERA DE SERVICIO", "area": "PESPUNTE", "orden": 10},
    {"nombre": "6040-M3",     "estado": "FUERA DE SERVICIO", "area": "PESPUNTE", "orden": 11},
    {"nombre": "6040-M4",     "estado": "ACTIVO",            "area": "PESPUNTE", "orden": 12},
    {"nombre": "6040-M5",     "estado": "ACTIVO",            "area": "PESPUNTE", "orden": 13},
    {"nombre": "CHACHE 048",  "estado": "ACTIVO",            "area": "PESPUNTE", "orden": 14},
    {"nombre": "CHACHE 049",  "estado": "ACTIVO",            "area": "PESPUNTE", "orden": 15},
]

# ============================================================
# 2. OPERATIONS — from CATALOGO sheet (exact template data)
# ============================================================
# (operacion, input_o_proceso, etapa, recurso, rate, [robot_names])

OPS_65568 = [
    ("COSTURA CHINELA",                             "ROBOT",        "ROBOT",           "ROBOT", 100, ["2A-3020-M1","2A-3020-M2","3020-M4"]),
    ("COLOCAR HERRAJE A TALON (1)",                  "PRELIMINARES", "PRE-ROBOT",       "MESA",  100, []),
    ("PEGAR FELPA A TALON (2)",                      "PRELIMINARES", "PRE-ROBOT",       "MESA",  100, []),
    ("COLOCAR GANCHO A TALON (1)",                   "PRELIMINARES", "PRE-ROBOT",       "MESA",  100, []),
    ("COSTURA TALON",                                "ROBOT",        "PRE-ROBOT",       "ROBOT",  65, ["6040-M4","6040-M5","CHACHE 048","CHACHE 049"]),
    ("ESPREADO DE FLOR Y COLOCACION A CHINELA",      "POST",         "POST-LINEA",      "MESA",  100, []),
    ("COSER FLOR A CHINELA",                         "POST",         "POST-PLANA-LINEA","PLANA", 100, []),
    ("DESHEBRADO DE CHINELA",                        "POST",         "POST-LINEA",      "MESA",  100, []),
]

OPS_68127 = [
    ("COSTURA CHINELA INTERNA",       "ROBOT",         "ROBOT",     "ROBOT", 82,  ["CHACHE 048","CHACHE 049"]),
    ("COSTURA CHINELA EXTERNA",       "ROBOT",         "ROBOT",     "ROBOT", 82,  ["CHACHE 048"]),
    ("PEGAR FELPA A LATIGO",          "PRELIMINARES",  "PRE-ROBOT", "MESA",  100, []),
    ("COSTURA GANCHOS",               "ROBOT",         "ROBOT",     "ROBOT", 120, ["2A-3020-M1","2A-3020-M2","6040-M4","6040-M5"]),
    ("PAGAR GANCHO A TALON LATIGO",   "PRELIMINARES",  "PRE-ROBOT", "MESA",  100, []),
    ("COSTURA TALON",                 "ROBOT",         "ROBOT",     "ROBOT", 100, ["2A-3020-M1","2A-3020-M2","6040-M4","6040-M5"]),
    ("COSTURA COMPLEMENTO DE TALON",  "ROBOT",         "ROBOT",     "ROBOT", 118, ["2A-3020-M2","6040-M5","CHACHE 048"]),
    ("PAGAR ARGOLLA A TALON",         "PRELIMINARES",  "PRE-ROBOT", "MESA",  100, []),
    ("COSTURA TALON EXTERNO",         "ROBOT",         "ROBOT",     "ROBOT", 110, ["2A-3020-M1","3020-M4"]),
    ("COSTURA TALON APLICACION",      "ROBOT",         "ROBOT",     "ROBOT",  80, ["3020-M6"]),
    ("DESHEBRADO DE CORTE",           "POST",          "POST-LINEA","MESA",  100, []),
    ("ARMADO DE TALON A CHINELA",     "POST",          "POST-LINEA","MESA",  100, []),
    ("COSER PUNTERA MAQUINA PLANA",   "N/A PRELIMINAR","N/A",       "PLANA", 100, []),
]

OPS_65413 = [
    ("COSTURA DE CHINELA",              "ROBOT", "ROBOT",     "ROBOT", 144, ["2A-3020-M2","6040-M4"]),
    ("COSTURA DE LATIGO",               "ROBOT", "ROBOT",     "ROBOT",  80, ["2A-3020-M1","6040-M4","6040-M5"]),
    ("COSTURA DE HEBILLA",              "ROBOT", "ROBOT",     "ROBOT",  66, ["2A-3020-M1","2A-3020-M2","6040-M4"]),
    ("ARMADO DE CHINELA A PLANTILLA",   "POST",  "POST-LINEA","POSTE", 100, []),
    ("ARMADO DE TALON A PLANTILLA",     "POST",  "POST-LINEA","POSTE", 100, []),
    ("COSTURA DE FALDON",               "POST",  "POST-LINEA","POSTE", 100, []),
    ("ASENTADO DE CORTE",               "POST",  "POST-LINEA","POSTE", 100, []),
    ("DESHEBRADO",                      "POST",  "POST-LINEA","POSTE", 100, []),
]

OPS_77525 = [
    ("Colocar forro de talon en jig y rayar",        "MAQUILA","MAQUILA","MAQUILA", 70.59, []),
    ("Colocar tira corta de talon y esprear",        "MAQUILA","MAQUILA","MAQUILA", 70.59, []),
    ("Empalmar tira corta de talon a forro de talon","MAQUILA","MAQUILA","MAQUILA", 70.59, []),
    ("Coser tira corta",                             "MAQUILA","MAQUILA","MAQUILA", 70.59, []),
    ("Colocar tira larga de talon y esprear",        "MAQUILA","MAQUILA","MAQUILA", 70.59, []),
    ("Empalmar tira larga de talon a forro",         "MAQUILA","MAQUILA","MAQUILA", 70.59, []),
    ("Asentado de tira larga en forro",              "MAQUILA","MAQUILA","MAQUILA", 70.59, []),
    ("Coser perimetro de tira larga de talon",       "MAQUILA","MAQUILA","MAQUILA", 70.59, []),
    ("Resacar excedente de forro",                   "POST",   "MESA",  "MESA",     60,   []),
    ("Fijar talones y chinela a plantilla",          "POST",   "MESA",  "MESA",    100,   []),
    ("Coser faldon a plantilla",                     "POST",   "MESA",  "MESA",    100,   []),
    ("Fijar chinela a plantilla",                    "POST",   "MESA",  "MESA",    100,   []),
]

OPS_94750 = [
    ("PONER FELPA Y GANCHO",    "PRELIMINARES","MESA", "MESA",  100, []),
    ("REMACHAR CHINELA",        "PRELIMINARES","MESA", "MESA",  100, []),
    ("COSTURA DE TALON",        "ROBOT",       "ROBOT","ROBOT",  90, ["2A-3020-M2","CHACHE 048"]),
    ("COSTURA DE CHINELA",      "ROBOT",       "ROBOT","ROBOT",  60, ["2A-3020-M1","2A-3020-M2"]),
    ("ARMADO DE CORTE",         "POST",        "MESA", "MESA",  100, []),
    ("ENGARZADO CHINELA TALON", "POST",        "MESA", "MESA",  100, []),
]

ALL_OPS = {
    "65568": OPS_65568,
    "68127": OPS_68127,
    "65413": OPS_65413,
    "77525": OPS_77525,
    "94750": OPS_94750,
}

# recurso_raw mapping based on recurso + etapa
def get_recurso_raw(recurso, etapa):
    if recurso == "ROBOT":
        return "ROBOT"
    if recurso == "MAQUILA":
        return "MAQUILA"
    if "LINEA" in etapa:
        return f"{recurso}-LINEA"  # MESA-LINEA, PLANA-LINEA, POSTE-LINEA
    return recurso

# ============================================================
# 3. OPERARIOS — from OPERARIOS sheet + catalogo.xlsx headcount
# ============================================================

OPERADORES    = ["ALEXIA", "CARLOS", "KEVIN", "KITZIA", "LUPITA", "NAYELI"]
PESPUNTADORES = ["ALVARO", "FABIOLA", "HUGO", "NACHO", "VICTOR"]
AUXILIARES    = ["BETSY", "CLARA", "DULCE", "ESTELA", "JENNY", "LETY"]

RECURSOS_OPERADOR    = ["MESA", "ROBOT"]
RECURSOS_PESPUNTADOR = ["ROBOT", "PLANA", "POSTE"]
RECURSOS_AUXILIAR    = ["MESA"]

DAYS = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab"]

# ============================================================
# 4. CONFIGURATION TABLES
# ============================================================

DIAS_LABORALES = [
    {"dia": "Sab", "min_regular": 300, "plantilla_regular": 10, "min_overtime": 120, "plantilla_overtime": 15, "es_sabado": True},
    {"dia": "Lun", "min_regular": 540, "plantilla_regular": 17, "min_overtime":  60, "plantilla_overtime": 17, "es_sabado": False},
    {"dia": "Mar", "min_regular": 540, "plantilla_regular": 17, "min_overtime":  60, "plantilla_overtime": 17, "es_sabado": False},
    {"dia": "Mie", "min_regular": 540, "plantilla_regular": 17, "min_overtime":  60, "plantilla_overtime": 17, "es_sabado": False},
    {"dia": "Jue", "min_regular": 540, "plantilla_regular": 17, "min_overtime":  60, "plantilla_overtime": 17, "es_sabado": False},
    {"dia": "Vie", "min_regular": 540, "plantilla_regular": 17, "min_overtime":  60, "plantilla_overtime": 17, "es_sabado": False},
]

CAPACIDADES = [
    {"recurso": "GENERAL", "capacidad": 10},
    {"recurso": "MESA",    "capacidad": 15},
    {"recurso": "PLANA",   "capacidad": 8},
    {"recurso": "POSTE",   "capacidad": 6},
    {"recurso": "ROBOT",   "capacidad": 8},
    {"recurso": "MAQUILA", "capacidad": 1},
]

# ============================================================
# MAIN
# ============================================================

def main():
    # ------ STEP 1: Clean slate ------
    print("\n=== STEP 1: Delete existing data ===")
    for t in ["operario_dias","operario_robots","operario_recursos","operarios",
              "catalogo_operacion_robots","catalogo_operaciones","robots",
              "dias_laborales","capacidades_recurso"]:
        sb_delete(t, "id=not.is.null")

    # ------ STEP 2: Robots (15) ------
    print("\n=== STEP 2: Insert robots ===")
    inserted_robots = sb_insert("robots", ROBOTS)
    robot_map = {r["nombre"]: r["id"] for r in inserted_robots}
    for name, rid in robot_map.items():
        print(f"    {name}: {rid}")

    # ------ STEP 3: Operations + robot links ------
    print("\n=== STEP 3: Insert operations ===")
    links = []

    for modelo_num, ops in ALL_OPS.items():
        modelo_id = MODEL_IDS[modelo_num]
        op_rows = []
        for i, (operacion, input_proc, etapa, recurso, rate, robots) in enumerate(ops, 1):
            raw = get_recurso_raw(recurso, etapa)
            sec = sec_from_rate(rate)
            op_rows.append({
                "modelo_id": modelo_id,
                "fraccion": i,
                "operacion": operacion,
                "input_o_proceso": input_proc,
                "etapa": etapa,
                "recurso": recurso,
                "recurso_raw": raw,
                "rate": rate,
                "sec_per_pair": sec,
            })

        inserted = sb_insert("catalogo_operaciones", op_rows)
        frac_map = {op["fraccion"]: op["id"] for op in inserted}
        print(f"  {modelo_num}: {len(inserted)} ops")

        for i, (_, _, _, _, _, robots) in enumerate(ops, 1):
            for rname in robots:
                links.append({"operacion_id": frac_map[i], "robot_id": robot_map[rname]})

    print(f"\n=== STEP 4: Insert {len(links)} robot-op links ===")
    if links:
        sb_insert("catalogo_operacion_robots", links)

    # ------ STEP 5: Update model metadata ------
    print("\n=== STEP 5: Update catalogo_modelos ===")
    for modelo_num, ops in ALL_OPS.items():
        num = len(ops)
        total = sum(sec_from_rate(op[4]) for op in ops)
        sb_patch("catalogo_modelos", f"id=eq.{MODEL_IDS[modelo_num]}", {
            "num_ops": num, "total_sec_per_pair": total,
        })
        print(f"  {modelo_num}: {num} ops, {total}s")

    # ------ STEP 6: Operarios ------
    print("\n=== STEP 6: Insert operarios ===")
    rows = []
    for name in OPERADORES + PESPUNTADORES + AUXILIARES:
        rows.append({"nombre": name, "eficiencia": 1.0, "activo": True})
    inserted_ops = sb_insert("operarios", rows)
    op_map = {o["nombre"]: o["id"] for o in inserted_ops}

    # Recursos
    recs = []
    for name in OPERADORES:
        for r in RECURSOS_OPERADOR:
            recs.append({"operario_id": op_map[name], "recurso": r})
    for name in PESPUNTADORES:
        for r in RECURSOS_PESPUNTADOR:
            recs.append({"operario_id": op_map[name], "recurso": r})
    for name in AUXILIARES:
        for r in RECURSOS_AUXILIAR:
            recs.append({"operario_id": op_map[name], "recurso": r})
    sb_insert("operario_recursos", recs)

    # Robot assignments (only active robots)
    active_robots = {n: rid for n, rid in robot_map.items()
                     if any(r["nombre"] == n and r["estado"] == "ACTIVO" for r in ROBOTS)}
    rbot = []
    for name in PESPUNTADORES + OPERADORES:
        for rname, rid in active_robots.items():
            rbot.append({"operario_id": op_map[name], "robot_id": rid})
    sb_insert("operario_robots", rbot)

    # Dias
    dias = []
    for name in OPERADORES + PESPUNTADORES + AUXILIARES:
        for d in DAYS:
            dias.append({"operario_id": op_map[name], "dia": d})
    sb_insert("operario_dias", dias)

    # ------ STEP 7: Config tables ------
    print("\n=== STEP 7: Config tables ===")
    sb_insert("dias_laborales", DIAS_LABORALES)
    sb_insert("capacidades_recurso", CAPACIDADES)

    # ------ Summary ------
    print("\n=== DONE! ===")
    active = sum(1 for r in ROBOTS if r["estado"] == "ACTIVO")
    total_ops = sum(len(ops) for ops in ALL_OPS.values())
    print(f"  Robots: {len(ROBOTS)} ({active} activos)")
    print(f"  Operations: {total_ops}")
    print(f"  Robot-op links: {len(links)}")
    print(f"  Operarios: {len(rows)}")
    print(f"  Dias laborales: {len(DIAS_LABORALES)}")
    print(f"  Capacidades: {len(CAPACIDADES)}")


if __name__ == "__main__":
    main()
