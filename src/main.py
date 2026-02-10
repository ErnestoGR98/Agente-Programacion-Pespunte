"""
main.py - Orquestador del sistema de programacion de pespunte.

Flujo (Iteracion 2):
  1. Carga sabana real (modelos, volumenes, fabricas)
  2. Carga catalogo de fracciones con recursos normalizados
  3. Cruza modelos y calcula factores de trabajo
  4. Optimizacion semanal CP-SAT (pares por modelo por dia)
  5. Scheduling diario (operaciones por bloque horario)
  6. Exporta sabana + programas diarios a Excel
"""

import sys
import os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from loader import load_sabana, match_models
from catalog_loader import load_catalog_v2
from fuzzy_match import build_operator_registry
from rules import get_default_params
from optimizer_weekly import optimize
from optimizer_v2 import schedule_week
from exporter import export_schedule


# Rutas por defecto (relativas al proyecto)
PROJECT_DIR = Path(__file__).parent.parent.parent

DEFAULT_SABANA = str(PROJECT_DIR / "SABANA SEM 8 V.2 (1).xlsx")
DEFAULT_CATALOG = str(PROJECT_DIR / "CATALOGO DE FRACCIONES POR MODELO11.xlsx")
DEFAULT_OUTPUT = str(Path(__file__).parent.parent / "reports" / "programacion_v2.xlsx")


def main(sabana_path: str = None, catalog_path: str = None, output_path: str = None):
    """Ejecuta el pipeline completo."""

    sabana_path = sabana_path or DEFAULT_SABANA
    catalog_path = catalog_path or DEFAULT_CATALOG
    output_path = output_path or DEFAULT_OUTPUT

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    print("=" * 65)
    print("  SISTEMA DE PROGRAMACION - PESPUNTE")
    print("  Iteracion 2 - Scheduling por Operacion/Hora")
    print("=" * 65)

    # --- Paso 1: Cargar sabana ---
    print("\n[1/7] Cargando sabana...")
    print(f"  Fuente: {sabana_path}")
    sabana_models, days_info = load_sabana(sabana_path)
    print(f"  Dias encontrados: {[d['name'] for d in days_info]}")
    print(f"  Modelos con produccion: {len(sabana_models)}")
    for m in sabana_models:
        print(f"    {m['codigo']:20s} | {m['fabrica']:12s} | Vol: {m['total_producir']:>5,}")

    # --- Paso 2: Cargar catalogo (v2 con recursos normalizados) ---
    print(f"\n[2/7] Cargando catalogo de fracciones (v2)...")
    print(f"  Fuente: {catalog_path}")
    catalog = load_catalog_v2(catalog_path)
    print(f"  Modelos en catalogo: {len(catalog)}")
    total_robot_ops = 0
    for model_num, data in list(catalog.items())[:5]:
        res = data["resource_summary"]
        res_str = ", ".join(f"{k}:{v}" for k, v in res.items())
        robots_str = ""
        if data.get("robots_used"):
            robots_str = f" | Robots: {', '.join(data['robots_used'])}"
        print(f"    {data['codigo_full']:20s} | {data['num_ops']:>2} ops | Recursos: {res_str}{robots_str}")
    for data in catalog.values():
        total_robot_ops += data.get("robot_ops", 0)
    if len(catalog) > 5:
        print(f"    ... y {len(catalog) - 5} modelos mas")
    all_robots = set()
    for data in catalog.values():
        all_robots.update(data.get("robots_used", []))
    if all_robots:
        print(f"  Robots fisicos detectados: {len(all_robots)} ({', '.join(sorted(all_robots))})")
        print(f"  Operaciones con robot asignado: {total_robot_ops}")

    # --- Paso 3: Registro de operarios ---
    print(f"\n[3/7] Construyendo registro de operarios...")
    operator_registry = build_operator_registry(sabana_path)
    print(f"  Operarios unicos: {len(operator_registry)}")
    for name, info in sorted(operator_registry.items()):
        aliases_str = f" (alias: {', '.join(info['aliases'])})" if info["aliases"] else ""
        print(f"    {name:15s} | Dias: {', '.join(info['days'])}{aliases_str}")

    # --- Paso 4: Cruzar datos ---
    print(f"\n[4/7] Cruzando sabana con catalogo...")
    matched, unmatched = match_models(sabana_models, catalog)
    print(f"  Modelos con match: {len(matched)}")
    if unmatched:
        print(f"  SIN MATCH (excluidos de optimizacion):")
        for m in unmatched:
            print(f"    {m['codigo']:20s} | Vol: {m['total_producir']:>5,} | Sin rates en catalogo")

    if not matched:
        print("\n  ERROR: Ningun modelo tiene match. No se puede optimizar.")
        return

    # Mostrar resumen de modelos a optimizar
    total_pares = sum(m["total_producir"] for m in matched)
    print(f"\n  Modelos a optimizar: {len(matched)}")
    print(f"  Total pares: {total_pares:,}")
    for m in matched:
        min_per_pair = m["total_sec_per_pair"] / 60
        res = m.get("resource_summary", {})
        res_str = ", ".join(f"{k}:{v}" for k, v in res.items()) if res else "N/A"
        print(
            f"    {m['codigo']:20s} | {m['total_producir']:>5,} prs | "
            f"{m['num_ops']:>2} ops | {min_per_pair:.1f} min/par | {res_str}"
        )

    # --- Paso 5: Optimizacion semanal (Iter 1) ---
    print(f"\n[5/7] Ejecutando optimizacion semanal CP-SAT...")
    params = get_default_params()

    # Ajustar nombres de dias segun lo que parseo la sabana
    for day_cfg in params["days"]:
        for day_info in days_info:
            if day_info["name"].startswith(day_cfg["name"]):
                day_cfg["name"] = day_info["name"]
                break

    weekly_schedule, weekly_summary = optimize(matched, params)

    # --- Paso 6: Scheduling diario (Iter 2) ---
    print(f"\n[6/7] Ejecutando scheduling diario por operacion/hora...")
    daily_results = schedule_week(weekly_schedule, matched, params)

    # Imprimir resumen de cada dia
    for day_name, day_data in daily_results.items():
        ds = day_data["summary"]
        if ds["total_pares"] == 0:
            continue
        hc_blocks = ds["block_hc"]
        max_hc = max(hc_blocks) if hc_blocks else 0
        print(f"    {day_name}: {ds['total_pares']:>5,} pares | "
              f"HC max: {max_hc:.1f}/{ds['plantilla']} | "
              f"Estado: {ds['status']}")
        if ds["total_tardiness"] > 0:
            print(f"      ADVERTENCIA: {ds['total_tardiness']} pares sin asignar a bloques")

    # --- Paso 7: Exportar ---
    print(f"\n[7/7] Exportando resultados...")
    export_schedule(weekly_schedule, weekly_summary, output_path,
                    daily_results=daily_results)

    # --- Resumen ---
    _print_summary(weekly_summary, daily_results)

    return weekly_schedule, weekly_summary, daily_results


def _print_summary(summary: dict, daily_results: dict = None):
    """Imprime resumen en consola."""
    print("\n" + "=" * 65)
    print("  RESUMEN DE OPTIMIZACION")
    print("=" * 65)

    print(f"\n  Estado semanal: {summary['status']}")
    print(f"  Tiempo: {summary['wall_time_s']}s")
    print(f"  Total pares programados: {summary['total_pares']:,}")

    if summary["total_tardiness"] > 0:
        print(f"  PARES PENDIENTES: {summary['total_tardiness']:,}")

    print("\n  --- Balance Diario ---")
    print(f"  {'Dia':>8} | {'Pares':>6} | {'HC Nec':>7} | {'HC Disp':>7} | {'Dif':>5} | {'Uso%':>5} | {'OT hrs':>6}")
    print(f"  {'-'*8}-+-{'-'*6}-+-{'-'*7}-+-{'-'*7}-+-{'-'*5}-+-{'-'*5}-+-{'-'*6}")
    for ds in summary["days"]:
        marker = " *" if ds["is_saturday"] else ""
        ot = ds.get("overtime_hrs", 0)
        ot_str = f"{ot:>5.1f}h" if ot > 0 else "     -"
        print(
            f"  {ds['dia']:>8} | {ds['pares']:>6,} | {ds['hc_necesario']:>7} | "
            f"{ds['hc_disponible']:>7} | {ds['diferencia']:>+5} | {ds['utilizacion_pct']:>5}%"
            f" | {ot_str}{marker}"
        )

    print("\n  --- Modelos ---")
    for ms in summary["models"]:
        status = "OK" if ms["tardiness"] == 0 else f"PEND {ms['tardiness']}"
        print(
            f"  {ms['codigo']:20s} | {ms['producido']:>5,}/{ms['volumen']:>5,} | "
            f"{ms['pct_completado']:>5}% | {status}"
        )

    # Resumen de scheduling diario
    if daily_results:
        print("\n  --- Programa Diario (HC por Bloque) ---")
        # Obtener labels de un dia con datos
        labels = None
        for dd in daily_results.values():
            if dd["summary"]["block_labels"]:
                labels = dd["summary"]["block_labels"]
                break
        if labels:
            header = f"  {'Dia':>8} |"
            for lbl in labels:
                header += f" {lbl:>6}"
            header += " | Max HC"
            print(header)
            print(f"  {'-'*8}-+" + "-" * (7 * len(labels)) + "-+-------")
            for day_name, dd in daily_results.items():
                ds = dd["summary"]
                if ds["total_pares"] == 0:
                    continue
                row = f"  {day_name:>8} |"
                for hc in ds["block_hc"]:
                    row += f" {hc:>6.1f}"
                max_hc = max(ds["block_hc"]) if ds["block_hc"] else 0
                row += f" | {max_hc:>5.1f}"
                print(row)

    print("\n" + "=" * 65)


if __name__ == "__main__":
    args = sys.argv[1:]
    sabana = args[0] if len(args) > 0 else None
    catalog = args[1] if len(args) > 1 else None
    output = args[2] if len(args) > 2 else None
    main(sabana, catalog, output)
