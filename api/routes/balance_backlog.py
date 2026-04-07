"""
Endpoint para generar propuesta de distribución semanal de un backlog.

Acepta dos modos:
1. Excel upload (multipart/form-data con field "file")
2. JSON manual (multipart/form-data con field "payload" en JSON string)

Reusa la lógica del script standalone backlog_tool/generar_propuesta.py
sin modificarlo. Solo importa las funciones necesarias.
"""
import io
import json
import sys
import tempfile
import traceback
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

# Hacer importable backlog_tool/
ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT / "backlog_tool"))

import generar_propuesta as bt  # noqa: E402

router = APIRouter()


@router.get("/api/balance-backlog/catalogo")
def get_catalogo_modelos():
    """Devuelve la lista de modelos del catálogo (para dropdown del modo manual)."""
    try:
        cat = bt.fetch_catalogo()
        modelos = []
        for num, m in cat.items():
            alts = m.get("alternativas") or []
            label = f"{num} {' '.join(alts)}".strip()
            modelos.append({
                "modelo_num": num,
                "label": label,
                "total_seg_par": m.get("total_sec_per_pair", 0),
                "robot_restringido": m.get("robot_restringido", False),
            })
        modelos.sort(key=lambda x: x["modelo_num"])
        return {"modelos": modelos}
    except Exception as e:
        raise HTTPException(500, f"Error consultando catálogo: {e}")


@router.post("/api/balance-backlog")
async def balance_backlog(
    file: Optional[UploadFile] = File(None),
    payload: Optional[str] = Form(None),
    max_modelos: int = Form(5),
    max_sem: int = Form(3),
    excluir: str = Form(""),
    fijar: str = Form(""),
    no_aislar: str = Form(""),
):
    """
    Genera propuesta optimizada del backlog.

    Provee UNO de los dos:
    - file: Excel con formato simple o legacy
    - payload: JSON con {sem_inicio, sem_fin, modelos: [{nombre, total}]}

    Retorna:
    - Excel binario (Content-Disposition: attachment)
    - O JSON con la distribución y un base64 del Excel si se usa Accept: application/json
    """
    try:
        # 1) Parsear input
        if file:
            tmp = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
            tmp.write(await file.read())
            tmp.close()
            try:
                modelos, semanas = bt.parse_backlog(Path(tmp.name))
            finally:
                Path(tmp.name).unlink(missing_ok=True)
        elif payload:
            data = json.loads(payload)
            sem_ini = int(data["sem_inicio"])
            sem_fin = int(data["sem_fin"])
            if sem_fin < sem_ini:
                raise HTTPException(400, "sem_fin debe ser >= sem_inicio")
            semanas = list(range(sem_ini, sem_fin + 1))
            modelos = []
            for m in data.get("modelos", []):
                nombre = str(m.get("nombre", "")).strip()
                total = int(m.get("total", 0))
                if nombre and total > 0:
                    modelos.append((nombre, total))
            if not modelos:
                raise HTTPException(400, "No hay modelos válidos en el payload")
        else:
            raise HTTPException(400, "Provee 'file' o 'payload'")

        # 2) Combinar opts
        opts = {
            "max_mod": max_modelos,
            "max_sem": max_sem,
            "excluir": set(s.strip() for s in excluir.split(",") if s.strip()),
            "no_aislar": set(s.strip() for s in no_aislar.split(",") if s.strip()),
            "fijar": {},
        }
        # parse fijar: "MODELO:S1,S2|OTRO:S3,S4"
        for f in fijar.split("|") if fijar else []:
            if ":" in f:
                k, v = f.split(":", 1)
                opts["fijar"][k.strip()] = [int(x) for x in v.split(",") if x.strip().isdigit()]

        # filtrar excluidos
        if opts["excluir"]:
            modelos = [(n, t) for n, t in modelos if not any(e in n for e in opts["excluir"])]

        # 3) Consultar Supabase
        robots = bt.fetch_robots_activos()
        catalogo = bt.fetch_catalogo()
        n_robots_compartidos = sum(
            1 for r in robots
            if not r["nombre"].lower().startswith(("maq.", "remach", "perfor", "desheb", "cabina", "m-cod"))
        )
        cap_robot_sem = max(1, n_robots_compartidos * bt.HRS_SEM_POR_ROBOT)

        # 4) Distribuir
        asig, carga, info = bt.distribuir(modelos, semanas, catalogo, cap_robot_sem, opts)

        # 5) Validar
        errores = []
        for n, t in modelos:
            s = sum(asig[n].values())
            if s != t:
                errores.append(f"{n}: suma {s} != total {t}")

        # 6) Construir resumen JSON (siempre)
        resumen = {
            "semanas": semanas,
            "capacidad_robot_sem": cap_robot_sem,
            "robots_activos": n_robots_compartidos,
            "por_semana": [
                {
                    "semana": s,
                    "pares": sum(asig[n][s] for n, _ in modelos),
                    "horas_robot": round(carga[s], 1),
                    "pct_capacidad": round(carga[s] / cap_robot_sem * 100, 1),
                    "n_modelos": sum(1 for n, _ in modelos if asig[n][s] > 0),
                }
                for s in semanas
            ],
            "por_modelo": [
                {
                    "modelo": n,
                    "total": t,
                    "distribucion": {str(s): asig[n][s] for s in semanas if asig[n][s] > 0},
                    "robot_restringido": info.get(n, {}).get("robot_restringido", False),
                    "sin_catalogo": info.get(n, {}).get("sin_catalogo", False),
                }
                for n, t in modelos
            ],
            "errores": errores,
        }

        # 7) Generar Excel
        template = ROOT / "backlog_tool" / "template_visual.xlsx"
        if not template.exists():
            raise HTTPException(500, f"Template no existe: {template}")

        out_tmp = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
        out_tmp.close()
        bt.escribir_excel(template, Path(out_tmp.name), asig, info, semanas)

        # nombre amigable
        now = datetime.now()
        iso_week = now.isocalendar().week
        filename = f"Backlog_OPTIMIZADO_S{iso_week:02d}_{now:%Y%m%d_%H%M}.xlsx"

        # Devolver Excel + headers con resumen JSON
        with open(out_tmp.name, "rb") as fh:
            data = fh.read()
        Path(out_tmp.name).unlink(missing_ok=True)

        return StreamingResponse(
            io.BytesIO(data),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "X-Resumen": json.dumps(resumen),
                "Access-Control-Expose-Headers": "Content-Disposition, X-Resumen",
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, f"Error procesando backlog: {e}")
