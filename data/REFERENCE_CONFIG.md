# Referencia de Configuracion - Pespunte Agent

Valores de referencia extraidos de los archivos JSON originales (Streamlit).
Ahora toda esta configuracion vive en las tablas de Supabase.

## Robots Fisicos (8 maquinas)

| Robot | Tipo |
|-------|------|
| 2A-3020-M1 | 3020 |
| 2A-3020-M2 | 3020 |
| 3020-M4 | 3020 |
| 3020-M6 | 3020 |
| 6040-M4 | 6040 |
| 6040-M5 | 6040 |
| CHACHE 048 | CHACHE |
| CHACHE 049 | CHACHE |

Aliases: `3020 M-4` -> `3020-M4`, `6040-M5 (PARCIAL)` -> `6040-M5`

## Capacidad por Recurso (pares/hora por operario)

| Recurso | Pares/Hora |
|---------|-----------|
| MESA | 15 |
| ROBOT | 8 |
| PLANA | 8 |
| POSTE | 6 |
| MAQUILA | 1 |
| GENERAL | 10 |

## Dias Laborales

| Dia | Minutos | Plantilla | OT Min | OT Plantilla | Sabado |
|-----|---------|-----------|--------|--------------|--------|
| Sab | 300 | 10 | 120 | 15 | Si |
| Lun | 540 | 17 | 60 | 17 | No |
| Mar | 540 | 17 | 60 | 17 | No |
| Mie | 540 | 17 | 60 | 17 | No |
| Jue | 540 | 17 | 60 | 17 | No |
| Vie | 540 | 17 | 60 | 17 | No |

## Horario

- Semana: 08:00 - 18:00, comida 14:00 - 15:00, bloque 60 min
- Fin de semana: 08:00 - 13:00, sin comida

## Pesos de Optimizacion

| Peso | Valor | Proposito |
|------|-------|-----------|
| tardiness | 100,000 | Penalizar entrega tardia |
| balance | 30,000 | Balancear carga entre dias |
| span | 20,000 | Consolidar modelos en dias consecutivos |
| changeover | 10,000 | Minimizar cambios de modelo |
| odd_lot | 5,000 | Penalizar lotes impares (no multiplos de 50) |
| saturday | 500 | Evitar produccion en sabado |
| uniformity | 100 | Produccion uniforme por bloque |
| overtime | 10 | Minimizar horas extra |
| early_start | 5 | Preferir inicio temprano |

## Parametros del Solver

| Parametro | Valor |
|-----------|-------|
| lote_minimo | 50 pares |
| lote_preferido | 100 pares |
| factor_eficiencia | 0.9 (90%) |
| factor_contiguidad | 0.8 |
| timeout_solver | 90 segundos |

## Modelos por Fabrica (5 modelos activos)

| Fabrica | Modelos |
|---------|---------|
| FABRICA 1 | 77525 |
| FABRICA 2 | 68127, 94750, 65568 |
| SIN FABRICA | 65413 |

## Modelos Activos (del template_pespunte_v2.xlsx)

| Modelo | Alternativas | Clave | Ops | Sec/Par |
|--------|-------------|-------|-----|---------|
| 65413 | NE, GC | SLI | 8 | ROBOT(3), POSTE(5) |
| 65568 | HU, RO, NE | SLI | 8 | ROBOT(2), MESA(5), PLANA(1) |
| 68127 | NE | SLI | 13 | ROBOT(6), MESA(5), PLANA(2) |
| 77525 | NE | SLI | 12 | MAQUILA(8), MESA(4) |
| 94750 | AA | SLI | 6 | ROBOT(2), MESA(4) |
