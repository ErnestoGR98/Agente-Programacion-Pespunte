# Arquitectura Tecnica - Pespunte Agent

Documentacion interna para desarrolladores y agentes IA. Describe el flujo de datos, los modelos de optimizacion, la base de datos y la arquitectura frontend/backend en detalle.

## Indice

1. [Vision General](#vision-general)
2. [Flujo de Datos End-to-End](#flujo-de-datos-end-to-end)
3. [Base de Datos (Supabase/PostgreSQL)](#base-de-datos)
4. [API Backend (FastAPI)](#api-backend)
5. [Pipeline de Optimizacion](#pipeline-de-optimizacion)
6. [Frontend (Next.js)](#frontend)
7. [Convenciones y Patrones](#convenciones-y-patrones)
8. [Gotchas y Notas Importantes](#gotchas)

---

## Vision General

```
┌─────────────────────────────────────────────────────────┐
│                    USUARIO (Browser)                     │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │           Next.js 16 (Vercel)                    │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │   │
│  │  │ Zustand   │ │ Hooks    │ │ Views (12 pages) │ │   │
│  │  │ appStep   │ │ usePedido│ │ datos, catalogo, │ │   │
│  │  │ result    │ │ useConfig│ │ programa, robots │ │   │
│  │  └─────┬─────┘ └────┬────┘ └────────┬─────────┘ │   │
│  │        │             │               │           │   │
│  │        │    ┌────────▼────────┐      │           │   │
│  │        │    │ Supabase Client │◄─────┘           │   │
│  │        │    │ (CRUD directo)  │                   │   │
│  │        │    └────────┬────────┘                   │   │
│  │        │             │                            │   │
│  │  ┌─────▼─────────────▼──────┐                    │   │
│  │  │   fastapi.ts (HTTP)      │                    │   │
│  │  │  optimize, chat, import  │                    │   │
│  │  └──────────┬───────────────┘                    │   │
│  └─────────────┼────────────────────────────────────┘   │
│                │                                         │
└────────────────┼─────────────────────────────────────────┘
                 │ HTTPS
┌────────────────▼─────────────────────────────────────────┐
│              FastAPI (Render.com, Docker)                 │
│                                                          │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ /optimize│  │ /import-*    │  │ /chat             │  │
│  │ Pipeline │  │ Excel parser │  │ Claude LLM        │  │
│  └────┬─────┘  └──────────────┘  └───────────────────┘  │
│       │                                                  │
│  ┌────▼─────────────────────────────────────────────┐   │
│  │  src/ modules                                     │   │
│  │  optimizer_weekly → optimizer_v2 → operator_assign │   │
│  │  constraint_compiler, llm_assistant, rules        │   │
│  └───────────────────────────────────────────────────┘   │
│       │                                                  │
│       ▼ Supabase REST API (read inputs, write results)   │
└──────────────────────────────────────────────────────────┘
                 │
┌────────────────▼─────────────────────────────────────────┐
│              Supabase (PostgreSQL)                        │
│  20+ tablas: config, catalogo, pedidos, operarios,       │
│  restricciones, avance, resultados                       │
└──────────────────────────────────────────────────────────┘
```

**Principio clave**: el frontend habla **directo a Supabase** para CRUD de datos (catalogo, pedidos, operarios, restricciones, config). Solo usa la API FastAPI para 3 cosas que JavaScript no puede hacer: **optimizacion** (OR-Tools), **importacion Excel** (openpyxl), y **chat LLM** (Claude API).

---

## Flujo de Datos End-to-End

### 1. Configuracion (Supabase directo)
```
Frontend hooks → Supabase tables
  useConfiguracion    → robots, capacidades_recurso, dias_laborales, pesos_priorizacion, parametros_optimizacion
  useOperarios        → operarios, operario_habilidades, operario_robots, operario_dias
  useRestricciones    → restricciones (temporales: PRIORIDAD, MAQUILA, etc.)
  useReglas           → restricciones (permanentes: PRECEDENCIA_OPERACION, LOTE_MINIMO_CUSTOM, SECUENCIA, AGRUPAR_MODELOS)
  usePedido           → pedidos, pedido_items
  useCatalogo         → catalogo_modelos, catalogo_operaciones, catalogo_operacion_robots
  useCatalogoImages   → modelo_imagen (imagenes de modelos)
  useAvance           → avance, avance_detalle
  useAuth             → autenticacion usuario
```

### 2. Importacion Excel (via API)
```
Frontend (FormData) → POST /api/import-catalog  → excel_parsers._parse_catalogo_sheet() → Supabase
Frontend (FormData) → POST /api/import-pedido/:n → excel_parsers._parse_pedido_sheet()  → Supabase
```

### 3. Optimizacion (via API)
```
Frontend → POST /api/optimize {pedido_nombre, semana, nota, reopt_from_day}
  ↓
API (routes/optimize.py):
  1. _load_params()         → Supabase → params dict
  2. _load_catalogo()       → Supabase → catalogo dict
  3. _load_pedido()         → Supabase → pedido list
  4. _load_restricciones()  → Supabase → restricciones list
  5. _load_avance()         → Supabase → avance dict
  6. _load_operarios()      → Supabase → operarios list
  7. _match_models()        → matched models list
  8. compile_constraints()  → CompiledConstraints
  9. optimize()             → weekly_schedule, weekly_summary        [Iter 1]
  10. schedule_week()       → daily_results (paralelo)               [Iter 2]
  11. assign_operators_week() → assignments, timelines               [Iter 3]
  12. _save_resultado()     → Supabase (con versionado automatico)
  ↓
Response: {status, total_pares, tardiness, wall_time, saved_as}
```

### 4. Visualizacion (Supabase directo)
```
Frontend lee resultado: Supabase.resultados → Zustand.currentResult
  weekly_summary → Resumen semanal (KPIs, tabla dias, tabla modelos)
  weekly_schedule → No se visualiza directamente, alimenta daily
  daily_results → Programa diario, Utilizacion HC, Robots, Cuellos de botella
  daily_results.assignments → Tabla con operarios asignados
  daily_results.operator_timelines → Vista cascada de operarios
```

### 5. Chat LLM (via API)
```
Frontend → POST /api/chat {messages, pedido_nombre, semana, model}
  ↓
API (routes/assistant.py):
  1. _build_state_from_supabase() → state dict
  2. build_context(state)          → texto serializado
  3. Anthropic API                 → respuesta
  ↓
Response: {response: "texto"}
```

---

## Base de Datos

Schema en 10 migraciones: `supabase/migrations/001_initial_schema.sql` a `010_recurso_text.sql`.

### Enums PostgreSQL

| Enum | Valores |
|------|---------|
| `resource_type` | MESA, ROBOT, PLANA, POSTE, MAQUILA, GENERAL |
| `process_type` | PRELIMINARES, ROBOT, POST, MAQUILA, N/A PRELIMINAR |
| `constraint_type` | 13 tipos: 9 temporales + 4 permanentes (ver Iter 3) |
| `day_name` | Sab, Lun, Mar, Mie, Jue, Vie |
| `robot_estado` | ACTIVO, FUERA DE SERVICIO |
| `robot_area` | PESPUNTE, AVIOS |

### Tablas principales

```
CONFIGURACION (Master Data)
├── robots              → nombre, estado, area, orden
├── robot_aliases       → alias → robot_id (FK)
├── fabricas            → nombre, orden
├── capacidades_recurso → tipo (enum), pares_hora
├── dias_laborales      → nombre, orden, minutos, plantilla, minutos_ot, plantilla_ot, es_sabado
├── horarios            → tipo (SEMANA|FINSEMANA), entrada, salida, comida_inicio, comida_fin
├── pesos_priorizacion  → nombre, valor (tardiness=100k, balance=30k, span=20k, ...)
└── parametros_optimizacion → nombre, valor (lote_minimo=50, timeout=90, ...)

CATALOGO
├── catalogo_modelos          → modelo_num (unique), codigo_full, alternativas, clave_material
├── catalogo_operaciones      → modelo_id (FK), fraccion, operacion, recurso, rate, sec_per_pair
├── catalogo_operacion_robots → operacion_id (FK) ↔ robot_id (FK)  [many-to-many]
└── modelo_fabrica            → modelo_id (FK) ↔ fabrica_id (FK)

OPERARIOS
├── operarios              → nombre, fabrica_id (FK), eficiencia [0.5-1.5], activo
├── operario_habilidades   → operario_id ↔ habilidad (enum, 20 skills)  [many-to-many]
├── operario_recursos      → operario_id ↔ recurso (legacy)  [many-to-many]
├── operario_robots        → operario_id ↔ robot_id           [many-to-many]
└── operario_dias          → operario_id ↔ dia (enum)         [many-to-many]

PRODUCCION
├── pedidos        → nombre (unique, ej: "sem_8_2026")
├── pedido_items   → pedido_id (FK), modelo_num, color, volumen
├── restricciones  → tipo (enum), modelo_num, activa, parametros (JSONB)
├── avance         → semana
├── avance_detalle → avance_id (FK), modelo_num, dia, pares
└── resultados     → nombre, base_name, version, weekly_schedule (JSONB),
                     weekly_summary (JSONB), daily_results (JSONB),
                     pedido_snapshot (JSONB), params_snapshot (JSONB)
```

### Relaciones clave

- `catalogo_operaciones.modelo_id` → `catalogo_modelos.id` (CASCADE)
- `catalogo_operacion_robots` es el join table entre operaciones y robots
- `operarios` tiene 4 tablas satellites: `operario_habilidades` (20 skills granulares), `operario_recursos` (legacy), `operario_robots`, `operario_dias`
- `resultados` guarda todo el output como JSONB (weekly_schedule, weekly_summary, daily_results) + snapshots del input para reproducibilidad
- `resultados` tiene versionado: `base_name` + `version` (UNIQUE), nombre = `{base_name}_v{version}`

### Acceso a Supabase

- **Frontend**: usa `@supabase/ssr` browser client directo (CRUD)
- **API**: usa REST API via `requests` (no SDK), construye headers con service role key

---

## API Backend

### Endpoints

| Metodo | Ruta | Archivo | Descripcion |
|--------|------|---------|-------------|
| POST | `/api/optimize` | `routes/optimize.py` | Pipeline completo de optimizacion |
| POST | `/api/import-catalog` | `routes/import_excel.py` | Importa catalogo desde Excel |
| POST | `/api/import-pedido/:nombre` | `routes/import_excel.py` | Importa pedido desde Excel |
| POST | `/api/chat` | `routes/assistant.py` | Chat con Claude LLM |
| GET | `/api/health` | `main.py` | Health check (Render) |

### Path imports

`api/main.py` agrega `src/` al `sys.path` para importar modulos compartidos:
```python
SRC_DIR = Path(__file__).parent.parent / "src"
sys.path.insert(0, str(SRC_DIR))
```

Esto permite que `routes/optimize.py` haga `from optimizer_weekly import optimize` directamente.

### Docker (Render)

El Dockerfile vive en `api/` pero el build context es la raiz del proyecto para acceder a `src/`:
```dockerfile
# Contexto: pespunte-agent/ (raiz)
COPY api/ ./api/
COPY src/ ./src/
```

---

## Pipeline de Optimizacion

### Iter 1 - Capa Semanal (`optimizer_weekly.py`)

**Decide cuantos pares de cada modelo producir cada dia de la semana.**

Solver: Google OR-Tools CP-SAT

#### Variables de decision
```
x[modelo, dia] = pares a producir (entero, multiplos de 50)
z[modelo, dia] = lotes de 50 (x = 50 * z)
y[modelo, dia] = 1 si modelo se produce en dia (indicador binario)
is_odd[m, d]   = 1 si z es impar (lote no multiplo de 100)
tardiness[m]   = pares no completados del modelo
span[m]        = ultimo_dia - primer_dia de produccion
```

#### Restricciones

1. **Volumen**: `sum_d(x[m,d]) + tardiness[m] == total_producir`
2. **Lote minimo**: si y[m,d]=1 entonces x[m,d] >= min_lot (default 50, override por modelo)
3. **Capacidad dia**: carga total (sec) <= plantilla * minutos * 60 * 0.90 + overtime
4. **Capacidad recurso**: carga por tipo recurso <= cap_recurso * minutos_dia * 60
5. **Throughput**: x[m,d] <= bottleneck_rate * horas * 0.80 (cuello de botella)
6. **Max ops/dia**: sum ops concurrentes <= plantilla * 3 (limita modelos por dia)
7. **Span MAQUILA**: modelos con MAQUILA tienen span >= lead_time_maquila
8. **Compiled constraints**: day_availability, frozen days, secuencias, agrupaciones

#### Funcion objetivo (multi-criterio, lexicografico por pesos)
```
minimize:
  W_TARDINESS(100k) * tardiness        # completar volumenes
  + W_SPAN(20k)     * span             # consolidar en dias consecutivos
  + W_CHANGEOVER(10k) * y              # menos modelos distintos por dia
  + W_ODD_LOT(5k)   * is_odd           # preferir centenas
  + W_SATURDAY(500)  * pares_sabado    # sabado como ultimo recurso
  + W_OVERTIME(10)   * overtime_sec     # minimizar horas extra
  + W_EARLY(5)       * pares * dia_idx # preferir dias tempranos
  + W_BALANCE(1)     * (max_load - min_load)  # balancear dias
```

#### Output
```python
weekly_schedule: list[{Dia, Fabrica, Modelo, Pares, HC_Necesario, Horas_Trabajo, Num_Operaciones}]
weekly_summary: {status, total_pares, total_tardiness, wall_time_s, days: [...], models: [...]}
```

Timeout: 60 segundos, 8 workers.

---

### Iter 2 - Capa Diaria (`optimizer_v2.py`)

**Toma los pares por modelo/dia del Iter 1 y genera el programa horario: que operacion se ejecuta en que bloque, con que robot.**

Solver: CP-SAT (un solver por dia, ejecutados en paralelo via ThreadPoolExecutor).

#### Bloques horarios (rules.py TIME_BLOCKS)
```
11 bloques, 10 productivos + 1 COMIDA (0 min):
  0: 8-9   (60 min)      6: COMIDA (0 min)
  1: 9-10  (60 min)      7: 3-4    (60 min)
  2: 10-11 (60 min)      8: 4-5    (60 min)
  3: 11-12 (60 min)      9: 5-6    (60 min)
  4: 12-1  (60 min)     10: 6-7    (60 min, overtime)
  5: 1-2   (60 min)
```

#### Variables de decision
```
x[m, op, b]      = pares de modelo m, operacion op, en bloque b
active[m, op, b]  = 1 si x > 0 (indicador binario)
y[m, op, r, b]    = pares en robot r (solo ops con robots asignados)
tardiness[m]      = pares no completados
```

#### Restricciones

1. **Completar**: para cada operacion de cada modelo: `sum_b(x) + tardiness = pares_dia`
2. **Rate limit**: x[m,op,b] <= rate * block_minutes / 60 (* hc_multiplier para cuellos)
3. **Recurso (SOFT)**: carga recurso por bloque <= cap * block_sec (overflow penalizado)
4. **Headcount (SOFT)**: carga total por bloque <= plantilla * block_sec (overflow penalizado)
5. **Robot individual**: sum_{m,op} y[m,op,r,b] * sec_per_pair <= block_sec (por robot fisico)
6. **Robot linking**: sum_r(y[m,op,r,b]) == x[m,op,b]
7. **Contiguidad**: `stopped[]` BoolVars, una vez que una operacion se detiene no puede reiniciar. COMIDA no rompe contiguidad.
8. **Uniformidad (SOFT)**: penalty por shortfall cuando un bloque activo produce menos que el rate esperado
9. **Block availability**: bloques bloqueados por RETRASO_MATERIAL con hora
10. **Disabled robots**: robots no disponibles en ciertos dias/bloques

#### Funcion objetivo
```
minimize:
  W_TARDINESS(100k) * tardiness
  + W_HC_OVERFLOW(50k) * overflow    # penalty por exceder capacidad/plantilla
  + W_UNIFORMITY(500) * shortfall    # produccion uniforme
  + W_BALANCE(1) * peak_load         # distribuir trabajo en bloques
```

#### Deteccion de cuellos de botella
`_mark_bottleneck_ops()`: si rate < mediana_modelo * 0.75 (solo ops manuales), marca con `hc_multiplier=2`. El solver permite 2x produccion por bloque; `operator_assignment` luego asigna 2 operarios.

#### Ejecucion paralela
`schedule_week()` usa `ThreadPoolExecutor(max_workers=N)` donde N = dias activos. CP-SAT libera el GIL durante la resolucion. Timeout dinamico: `min(90, max(20, 10 + pares/100 + total_ops))` segundos. 4 workers por dia (reducido para evitar contention).

#### Early stop callback
Cuando encuentra 0 tardiness, espera 5 segundos mas (GRACE_SECONDS) para mejorar objetivos secundarios y luego detiene la busqueda.

#### Output (por dia)
```python
schedule: list[{modelo, fabrica, fraccion, operacion, recurso, rate, hc,
                block_pares: [int x 11], total_pares, robots_used, robots_eligible, hc_multiplier}]
summary: {status, total_pares, total_tardiness, plantilla, block_hc: [float x 11], block_labels}
```

---

### Iter 3 - Restricciones y Operarios

#### 3A - Compilador de Restricciones (`constraint_compiler.py`)

Convierte restricciones JSON del usuario + avance de produccion en un `CompiledConstraints` que ambos solvers consumen.

**Patron**: handler extensible via diccionario `_HANDLERS`. Agregar tipo = 1 funcion + registrarla.

```python
_HANDLERS = {
    "PRIORIDAD":              _handle_prioridad,         # tardiness_weights[modelo] = 1.0/2.0/5.0
    "MAQUILA":                _handle_maquila,            # maquila[modelo] = pares (restar de volumen)
    "RETRASO_MATERIAL":       _handle_retraso_material,   # day_availability + block_availability
    "FIJAR_DIA":              _handle_fijar_dia,          # day_availability (PERMITIR/EXCLUIR)
    "FECHA_LIMITE":           _handle_fecha_limite,        # day_availability + deadline + tardiness x10
    "SECUENCIA":              _handle_secuencia,           # sequences[(idx_antes, idx_despues)]
    "AGRUPAR_MODELOS":        _handle_agrupar_modelos,     # model_groups[(idx_a, idx_b)]
    "AJUSTE_VOLUMEN":         _handle_ajuste_volumen,      # volume_overrides[modelo] = nuevo
    "LOTE_MINIMO_CUSTOM":     _handle_lote_minimo,         # lot_min_overrides[modelo] = min
    "ROBOT_NO_DISPONIBLE":    _handle_robot_no_disponible, # disabled_robots[robot][dia] = all_blocks
    "AUSENCIA_OPERARIO":      _handle_ausencia_operario,   # plantilla_adjustments[dia] -= cantidad
    "CAPACIDAD_DIA":          _handle_capacidad_dia,       # plantilla_overrides[dia] = nueva
    "PRECEDENCIA_OPERACION":  _handle_precedencia_operacion, # operation_precedences[(modelo,frac_o,frac_d,buffer)]
}
```

**CompiledConstraints** (dataclass con 15 campos): ver `constraint_compiler.py:48-99`.

#### 3B - Asignacion de Operarios (`operator_assignment.py`)

Post-proceso heuristico (no CP-SAT). Asigna operarios a tareas del schedule diario.

**FASE 1 - Cascada secuencial** (bloque por bloque 0..10):
1. Liberar operarios cuya tarea termino
2. Ordenar tareas sin asignar por MRV (Most Restricted Variable = menos elegibles primero)
3. Asignar operario libre con mejor score:
   - Cascada perfecta (+200): recien liberado, sin hueco
   - Continuidad modelo (+50): mismo modelo que tarea anterior
   - Eficiencia (+10 * eficiencia)
4. **Compromiso total**: operario se compromete a TODA la tarea restante, no puede tomar otra hasta terminar

**FASE 2 - Relevo** (post-cascada):
Para tareas SIN ASIGNAR: busca pares (idle A, busy B) donde A puede relevar a B en su tarea actual, liberando a B para tomar la tarea sin asignar.

**FASE 3 - Validacion**: `_validate_no_overlap()` elimina asignaciones dobles como safety net.

**Output**:
```python
assignments: list[{...schedule_entry, operario, robot_asignado, pendiente}]
operator_timelines: {op_name: [{block, label, modelo, fraccion, operacion, recurso, pares, robot}]}
unassigned: [{modelo, fraccion, operacion, recurso, total_pares, parcial}]
```

---

### Iter 4 - Asistente LLM (`llm_assistant.py`)

- **Modelo**: Claude (configurable, default `claude-sonnet-4-5-20250514`)
- **System prompt**: dominio de pespunte (pares, modelos, fracciones, robots, bloques)
- **Contexto dinamico**: `build_context(state)` serializa pedido, resumen semanal, schedule, resultados diarios, restricciones, avance, parametros
- **API route**: `routes/assistant.py` construye state desde Supabase antes de llamar a Claude

---

## Frontend

### Tecnologias
- **Next.js 16** con App Router (`src/app/`)
- **React 19** con Server Components
- **Tailwind CSS v4** (no hay `tailwind.config.js`, usa `@import "tailwindcss"` en globals.css)
- **shadcn/ui** (Radix primitives): Button, Card, Input, Label, Select, Switch, Table, Tabs, Badge, ScrollArea, Sheet, Tooltip
- **Zustand v5**: estado global (appStep, currentResult)
- **Recharts v3**: graficas (BarChart, heatmaps)
- **Supabase**: `@supabase/ssr` browser client para CRUD directo

### Estructura de rutas

```
src/app/
├── layout.tsx            # Root: fonts (Geist), globals.css, ThemeProvider
├── page.tsx              # Landing page
└── (dashboard)/          # Route group (todas las vistas del dashboard)
    ├── layout.tsx        # Sidebar + TopBar + wakeUpAPI() on mount
    │
    │  --- Vistas pre-optimizacion ---
    ├── datos/            # Pedido semanal + catalogo (PedidoTab + CatalogoTab)
    ├── catalogo/         # Gestion catalogo (imagenes, alternativas, maquinas)
    ├── restricciones/    # Restricciones temporales (RestriccionesForm + ConstraintParams)
    ├── operarios/        # Gestion operarios (OperarioForm + HeadcountTable)
    ├── configuracion/    # 6 tabs: Robots, Capacidades, Fabricas, Dias, Pesos, Reglas
    ├── asistente/        # Chat con Claude
    │
    │  --- Vistas post-optimizacion ---
    ├── resumen/          # KPIs + tabla dias + tabla modelos
    ├── programa/         # Tabla horaria bloques x operaciones, DaySelector
    ├── utilizacion/      # Heatmap HC + bar chart carga, DaySelector
    ├── robots/           # Timeline robots por bloque, DaySelector
    └── cuellos/          # Alertas de cuellos de botella
```

### Estado global (Zustand)

```typescript
// useAppStore.ts
appStep: 0 | 1 | 2     // 0=sin datos, 1=pedido cargado, 2=optimizado
currentResult: Resultado | null  // resultado completo de Supabase
currentPedidoNombre: string | null
currentSemana: string | null
```

`appStep` controla la visibilidad de tabs en el Sidebar:
- Step 0: solo Datos, Configuracion
- Step 1: + Restricciones, Operarios, Asistente
- Step 2: + Resumen, Programa, Utilizacion, Robots, Cuellos

### Hooks de datos (9 hooks en `lib/hooks/`)

Cada hook encapsula CRUD a Supabase para un dominio:
- `useConfiguracion()` → robots, capacidades, dias, pesos, parametros
- `useOperarios()` → operarios + relaciones (habilidades, robots, dias)
- `usePedido()` → pedidos + items
- `useRestricciones()` → restricciones temporales (semanales)
- `useReglas()` → restricciones permanentes (PRECEDENCIA_OPERACION, LOTE_MINIMO_CUSTOM, SECUENCIA, AGRUPAR_MODELOS)
- `useCatalogo()` → catalogo_modelos + operaciones + robots
- `useCatalogoImages()` → imagenes de modelos
- `useAvance()` → avance de produccion semanal
- `useAuth()` → autenticacion de usuario

### Cliente API (`lib/api/fastapi.ts`)

5 funciones exportadas:
```typescript
runOptimization(req)  → POST /api/optimize
sendChatMessage(req)  → POST /api/chat
importCatalog(file)   → POST /api/import-catalog  (FormData)
importPedido(n, file) → POST /api/import-pedido/:n (FormData)
wakeUpAPI()           → GET  /api/health (warm up Render free tier)
```

### Tipos TypeScript (`types/index.ts`)

Todos los tipos del dominio en un solo archivo (~554 LOC):
- Enums: `ResourceType`, `ProcessType`, `ConstraintType`, `DayName`, `RobotEstado`, `RobotArea`
- Tablas: `Robot`, `Fabrica`, `CatalogoModelo`, `CatalogoOperacion`, `Operario`, `Pedido`, `PedidoItem`, `Restriccion`, `Avance`, `Resultado`
- Optimization: `WeeklyScheduleEntry`, `WeeklySummary`, `DailyResult`, `DailyScheduleEntry`
- API: `OptimizeRequest`, `OptimizeResponse`, `ChatRequest`, `ChatResponse`
- Constantes compartidas: `BLOCK_LABELS`, `DEFAULT_CAPACITIES`, `CHART_COLORS`, `HEATMAP_COLORS`, `RESOURCE_COLORS`, `STAGE_COLORS`

### Componentes compartidos (10 en `components/shared/`)

- `CascadeEditor.tsx` - Editor visual de reglas de precedencia (drag-drop, resize, group boundaries)
- `ChatWidget.tsx` - Widget de chat reutilizable
- `ConfirmDialog.tsx` - Dialogo de confirmacion generico
- `DaySelector.tsx` - Select de dia (usado en programa, utilizacion, robots)
- `KpiCard.tsx` - Card de metrica reutilizable
- `ModeloImg.tsx` - Renderizador de imagenes de modelo
- `OperationNode.tsx` - Nodo de operacion para grafos
- `PrecedenceGraph.tsx` - Visualizacion de grafo de precedencias
- `TableExport.tsx` - Exportacion de tablas a Excel/CSV
- `ThemeProvider.tsx` - Proveedor de tema claro/oscuro

### Componentes de layout

- `components/layout/Sidebar.tsx` - Navegacion lateral con tabs condicionales por appStep
- `components/layout/TopBar.tsx` - Selector de resultado (versionado), boton optimizar

---

## Convenciones y Patrones

### Python (Backend + Solver)
- Modulos en `src/` son compartidos entre API y potencial CLI
- `api/main.py` agrega `src/` al `sys.path`
- OR-Tools CP-SAT: variables con prefijo descriptivo (`x`, `y`, `z`, `active`, `stopped`, `tardiness`)
- Pesos de objetivo como constantes `W_*` al inicio del modulo
- Constraint compiler: patron handler extensible (`_HANDLERS` dict)
- Operator assignment: heuristica secuencial, NO solver (cascada + relevo)

### TypeScript (Frontend)
- App Router con route groups: `(dashboard)/` para todas las vistas
- Componentes grandes divididos en sub-componentes (<200 LOC cada uno)
- Hooks custom para CRUD Supabase (`useConfiguracion`, `usePedido`, etc.)
- Constantes en `types/index.ts` (single source of truth)
- `'use client'` en todas las pages del dashboard (interactividad)

### Datos
- Supabase como unica fuente de verdad (no mas JSON files)
- Resultados versionados automaticamente (`base_name_v1`, `_v2`, ...)
- Restricciones almacenadas con `parametros` JSONB (flexibilidad por tipo)
- Excel template en `data/template_pespunte_v2.xlsx` (catalogo + pedido)

---

## Gotchas

1. **Tailwind v4**: no hay `tailwind.config.js`. Config via CSS (`globals.css`). shadcn usa `@import "shadcn/tailwind.css"`.

2. **OneDrive + .next cache**: OneDrive bloquea archivos en `.next/`. Si `next build` falla con EPERM, hacer `rm -rf frontend/.next` primero.

3. **Supabase REST desde Python**: la API usa `requests` directo (no el SDK de Supabase). Headers requieren `apikey` + `Authorization: Bearer` + `Prefer: return=representation`.

4. **CP-SAT GIL**: `optimizer_v2.schedule_week()` usa `ThreadPoolExecutor` porque CP-SAT libera el GIL durante `Solve()`. Funciona bien para paralelismo real.

5. **COMIDA block**: el bloque 6 tiene `minutes=0`, el solver fuerza `x=0` y `active=0`. La contiguidad salta bloques de 0 min para no romper la cadena.

6. **Render free tier**: se duerme despues de 15 min de inactividad. `wakeUpAPI()` en el dashboard layout hace warm up al cargar.

7. **Catalogo operaciones-robots**: es many-to-many via `catalogo_operacion_robots`. Los robots listados son "elegibles" para esa operacion, NO paralelos. Solo 1 robot se usa a la vez por operacion.

8. **hc_multiplier**: operaciones cuello de botella (rate < mediana*0.75) se marcan con multiplier=2. El solver permite doble produccion y operator_assignment pone 2 operarios.

9. **Versionado resultados**: cada optimizacion crea una version nueva (`_v1`, `_v2`, ...) para el mismo `base_name`. El TopBar permite seleccionar entre versiones.

10. **Day order**: Sab (0), Lun (1), Mar (2), Mie (3), Jue (4), Vie (5). El sabado va primero porque la semana de produccion empieza el sabado anterior.

11. **Restricciones temporales vs permanentes**: Las 13 constraint_types se dividen en temporales (9 tipos, gestionadas en `/restricciones`, asociadas a una semana) y permanentes (4 tipos: PRECEDENCIA_OPERACION, LOTE_MINIMO_CUSTOM, SECUENCIA, AGRUPAR_MODELOS, gestionadas en `/configuracion` > tab Reglas via CascadeEditor).

12. **CascadeEditor**: Editor visual de reglas de precedencia en `components/shared/CascadeEditor.tsx`. Usa un grid derivado con BFS (depth) + DFS (chains). Soporta drag-drop entre columnas, resize de celdas (rowSpan) para conectar multiples padres, y separadores visuales entre grupos independientes de operaciones. El algoritmo `buildChainWithBranches` coloca la cadena principal primero y luego las ramas, y `findOwnerSource` usa deteccion por zona (padre mas cercano arriba).

13. **Supabase error handling**: El cliente Supabase retorna `{data, error}` — siempre verificar y hacer throw explicitamente. No asumir que lanza excepciones automaticamente.

14. **operario_habilidades**: Migracion 007 agrego 20 habilidades granulares (9 PRELIMINAR, 5 ROBOT, 6 PESPUNTE CONVENCIONAL) que reemplazan el approach generico de `operario_recursos`.
