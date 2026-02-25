"""
Seed operarios from MATRIZ DE HABILIDADES FR.xlsx.
Deletes all existing operarios and imports the 19 real operators with their skills.
Also updates robots.tipo for type-based matching.
"""
import json
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


def sb_request(method, path, data=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            text = resp.read().decode()
            return json.loads(text) if text.strip() else []
    except urllib.error.HTTPError as e:
        print(f"  ERROR {e.code}: {e.read().decode()}")
        return []


def sb_get(table, query=""):
    return sb_request("GET", f"{table}?{query}" if query else table)


def sb_post(table, data):
    return sb_request("POST", table, data)


def sb_delete(table, query):
    return sb_request("DELETE", f"{table}?{query}")


def sb_patch(table, query, data):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{query}"
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers=HEADERS, method="PATCH")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode() or "[]")
    except urllib.error.HTTPError as e:
        print(f"  PATCH ERROR {e.code}: {e.read().decode()}")
        return []


# Column indices in the Excel (0-based):
# 0=No, 1=Nombre, 2=Foto, 3=Area, 4=Fraccion
# 5=Armado Palets, 6=Pistola, 7=Hebillas, 8=Deshebrados, 9=Alimentar Linea
# 10=Maq Pintura, 11=Remach Neumatica, 12=Remach Mecanica, 13=Perforadora Jack
# 14=3020, 15=4530(Chache), 16=Doble Accion, 17=6040
# 18=Zigzag, 19=Recta, 20=2 Agujas, 21=Poste, 22=Ribete, 23=Codo

SKILL_COLUMNS = {
    5:  "ARMADO_PALETS",
    6:  "PISTOLA",
    7:  "HEBILLAS",
    8:  "DESHEBRADOS",
    9:  "ALIMENTAR_LINEA",
    10: "MAQ_PINTURA",
    11: "REMACH_NEUMATICA",
    12: "REMACH_MECANICA",
    13: "PERFORADORA_JACK",
    14: "ROBOT_3020",
    15: "ROBOT_CHACHE",
    16: "ROBOT_DOBLE_ACCION",
    17: "ROBOT_6040",
    # 2AG robots: not in this Excel matrix (column 20 is conventional 2 Agujas machine)
    18: "ZIGZAG",
    19: "PLANA_RECTA",
    20: "DOS_AGUJAS",
    21: "POSTE_CONV",
    22: "RIBETE",
    23: "CODO",
}

# Data from MATRIZ DE HABILIDADES FR.xlsx — ACTIVOS sheet
# Each tuple: (numero, nombre, [skill_column_indices_with_X])
OPERARIOS_DATA = [
    (4641, "ALMA ZULEMA CISNEROS FERNANDEZ",       [6, 7, 8, 10]),
    (4639, "SUMIKI JUDITH RODRIGUEZ NOLASCO",       [6, 7, 8]),
    (4636, "EVELIN SARAI CORNEJO HERRERA",          [6, 7, 8, 10]),
    (4624, "CHAVARIN ARCE IRMA LIZETH",             [6, 7, 8, 9, 10]),
    (4617, "CARRILLO BARAJAS AURORA JAQUELIN",      [5, 6, 7, 8, 9, 10, 14, 15, 16, 17]),
    (4613, "SANDOVAL MARTINEZ PEDRO SAUL",          [5, 6, 7, 8, 14, 15, 16, 17]),
    (4590, "ANGUIANO DE LEON JUANA ARACELI",        [6, 7, 8, 9, 19]),
    (4579, "CASTANEDA CERVANTES CARLOS ANTONIO",    [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]),
    (4572, "BARAJAS VALLADOLID BETSY ELIZABETH",    [5, 6, 7, 8, 9, 10, 13]),
    (4414, "VAZQUEZ GONZALEZ LILIAN ALEXIAN",       [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]),
    (4405, "MORALES CHAVARIN KEVIN ALEJANDRO",      [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]),
    (4379, "ACEVES ROBLES ALVARO",                  [6, 7, 8, 11, 12, 13, 18, 19, 20, 21, 22]),
    (4301, "ARCOS GODINEZ ANA LIZETTE",             [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]),
    (4230, "ALANIZ GONZALEZ FABIOLA",               [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 19, 20, 21, 22, 23]),
    (4197, "CERVANTES RUIZ MARTHA LETICIA",         [5, 6, 7, 8, 9, 10, 11, 12, 13]),
    (3997, "CHAVEZ CASTRO HUGO",                    [6, 7, 8, 18, 19, 21]),
    (3952, "ESQUIVEL VALENZUELA GUADALUPE NATALY",  [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]),
    (3520, "MORA LUCAS AMERICO ADALID",             [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19]),
    (3500, "IBARRA HUERTA VICTOR HUGO",             [5, 6, 7, 8, 11, 12, 13, 14, 17, 18, 19, 20, 21, 22, 23]),
]

DIAS_LABORALES = ["Lun", "Mar", "Mie", "Jue", "Vie"]


def main():
    print("=" * 60)
    print("Seed operarios from MATRIZ DE HABILIDADES")
    print("=" * 60)

    # 1. Delete all existing operarios (CASCADE deletes junction tables)
    print("\n1. Deleting existing operarios...")
    existing = sb_get("operarios", "select=id")
    for op in existing:
        sb_delete("operario_habilidades", f"operario_id=eq.{op['id']}")
        sb_delete("operario_recursos", f"operario_id=eq.{op['id']}")
        sb_delete("operario_robots", f"operario_id=eq.{op['id']}")
        sb_delete("operario_dias", f"operario_id=eq.{op['id']}")
    sb_delete("operarios", "id=neq.00000000-0000-0000-0000-000000000000")
    print(f"  Deleted {len(existing)} operarios")

    # 2. Update robot_tipos junction table
    print("\n2. Updating robot_tipos...")
    sb_delete("robot_tipos", "id=neq.00000000-0000-0000-0000-000000000000")
    robots = sb_get("robots", "select=id,nombre")
    for rb in robots:
        nombre = rb["nombre"]
        tipos = []
        if nombre.startswith("2A-"):
            # 2A-3020 robots are both 3020 and DOBLE_ACCION
            tipos = ["DOBLE_ACCION"]
            if "3020" in nombre:
                tipos.append("3020")
        elif nombre.startswith("3020"):
            tipos = ["3020"]
        elif nombre.startswith("6040"):
            tipos = ["6040"]
        elif nombre.startswith("CHACHE"):
            tipos = ["CHACHE"]
        if tipos:
            sb_post("robot_tipos", [
                {"robot_id": rb["id"], "tipo": t} for t in tipos
            ])
            print(f"  {nombre} -> tipos={tipos}")

    # 3. Insert operarios
    print(f"\n3. Inserting {len(OPERARIOS_DATA)} operarios...")
    for num, nombre, skill_cols in OPERARIOS_DATA:
        # Insert operario
        result = sb_post("operarios", [{
            "nombre": nombre,
            "eficiencia": 1.0,
            "activo": True,
        }])
        if not result:
            print(f"  FAILED to insert {nombre}")
            continue
        op_id = result[0]["id"]

        # Insert habilidades
        skills = [SKILL_COLUMNS[col] for col in skill_cols if col in SKILL_COLUMNS]
        if skills:
            sb_post("operario_habilidades", [
                {"operario_id": op_id, "habilidad": s} for s in skills
            ])

        # Insert dias (L-V for everyone)
        sb_post("operario_dias", [
            {"operario_id": op_id, "dia": d} for d in DIAS_LABORALES
        ])

        print(f"  {nombre}: {len(skills)} habilidades, dias L-V")

    print("\nDone!")


if __name__ == "__main__":
    main()
