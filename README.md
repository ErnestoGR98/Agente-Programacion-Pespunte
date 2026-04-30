# Pespunte Agent — Footwear Robotics

Sistema de programacion de produccion para el area de pespunte (costura) de calzado.
Combina optimizacion con CP-SAT (Google OR-Tools), planeacion data-driven sin solver,
asignacion de robots y operarios, y un asistente LLM (Claude) para analisis post-corrida.

## Stack Tecnologico

| Capa | Tecnologia | Ubicacion |
|------|-----------|-----------|
| Frontend | Next.js 16 (App Router) + React 19 + TypeScript 5 | `frontend/` |
| UI | Tailwind CSS v4 + shadcn/ui (Radix) + lucide-react | `frontend/src/components/ui/` |
| Estado | Zustand v5 | `frontend/src/lib/store/` |
| Graficos | Recharts v3 | Vistas de resultados / planeacion |
| Diagramas | @xyflow/react v12 | Flow / cursograma |
| Excel/PDF | xlsx-js-style, jspdf, jspdf-autotable, html2canvas-pro | Exports |
| Base de datos | Supabase (PostgreSQL + RLS) | `supabase/migrations/` |
| API | FastAPI + Python 3.11 | `api/` |
| Solver | Google OR-Tools CP-SAT | `src/optimizer_*.py` |
| LLM | Anthropic Claude API | `src/llm_assistant.py` |
| Deploy API | Render.com (Docker, free tier) | `api/Dockerfile`, `render.yaml` |
| Deploy Frontend | Vercel (auto-deploy on push) | root: `frontend/` |

## Estructura del Proyecto

```
pespunte-agent/
├── api/                            # FastAPI backend
│   ├── main.py                     # Entry point, CORS regex *.vercel.app
│   ├── Dockerfile                  # Deploy en Render (contexto raiz)
│   ├── requirements.txt            # fastapi, ortools, anthropic, openpyxl, supabase
│   └── routes/
│       ├── optimize.py             # Pipeline + generate-from-plan + optimize-day
│       ├── import_excel.py         # Catalogo / pedido / template
│       ├── assistant.py            # Chat Claude
│       ├── capacity.py             # Capacity plan forecast
│       ├── scenarios.py            # Gap analysis + escenarios what-if
│       └── balance_backlog.py      # Clasificacion A/B/C + balanceo volumen
│
├── src/                            # Modulos Python (importados por la API)
│   ├── optimizer_weekly.py         # CP-SAT semanal (modelo×dia)
│   ├── optimizer_v2.py             # CP-SAT diario (bloques horarios + robots)
│   ├── operator_assignment.py      # Asignacion de operarios (MRV + relevo)
│   ├── constraint_compiler.py      # Compilador restricciones → CP-SAT constraints
│   ├── capacity_planner.py         # Forecast capacidad semanal
│   ├── llm_assistant.py            # Cliente Claude + system prompt + historial
│   ├── excel_parsers.py            # Parseo Excel (catalogo, pedido)
│   ├── catalog_loader.py           # Carga catalogo desde Excel
│   ├── template_generator.py       # Generacion de templates Excel
│   ├── fuzzy_match.py              # Match fuzzy modelo pedido ↔ catalogo
│   ├── loader.py                   # Carga datos desde JSON (legacy)
│   ├── config_manager.py           # Lectura/escritura de config
│   ├── supabase_client.py          # Cliente Supabase (auth, URL, key)
│   ├── supabase_manager.py         # CRUD: resultados, versionado, snapshots
│   └── rules.py                    # Time blocks (11 bloques) + reglas legacy
│
├── frontend/                       # Next.js 16 App Router
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx          # Root layout (fonts, metadata, favicon)
│   │   │   ├── page.tsx            # Landing / login redirect
│   │   │   ├── icon.png            # Favicon (logo Footwear Robotics)
│   │   │   ├── apple-icon.png      # Apple touch icon (180×180)
│   │   │   └── (dashboard)/        # 15 vistas
│   │   │       ├── layout.tsx      # Sidebar + TopBar + wakeUpAPI (cold-start)
│   │   │       ├── datos/          # Pedido + catalogo (import Excel)
│   │   │       ├── catalogo/       # Gestion catalogo (imagenes, alternativas)
│   │   │       ├── operarios/      # CRUD operarios + matriz de habilidades
│   │   │       ├── configuracion/  # 6 tabs: Robots, Capacidades, Fabricas, Dias, Pesos, Reglas
│   │   │       ├── restricciones/  # Restricciones temporales (semana especifica)
│   │   │       ├── planeacion/     # 5 tabs: Editor / Comparativo / Desglose diario / Tabla / Referencia
│   │   │       ├── balance-backlog/# Clasificacion A/B/C de modelos + distribucion balanceada
│   │   │       ├── capacidad/      # Matriz capacidad instalada
│   │   │       ├── sabana/         # Sabana semanal (vista hoja-de-calculo)
│   │   │       ├── asistente/      # Chat LLM con Claude
│   │   │       ├── resumen/        # Resumen semanal post-optimizacion
│   │   │       ├── programa/       # Programa diario detallado (bloques + operarios)
│   │   │       ├── utilizacion/    # Heatmap HC + carga por bloque
│   │   │       ├── robots/         # Timeline robots + matriz programa
│   │   │       └── cuellos/        # Alertas, restricciones activas, carga por modelo
│   │   ├── components/
│   │   │   ├── layout/             # Sidebar.tsx, TopBar.tsx
│   │   │   ├── shared/             # 11 componentes shared (ver mas abajo)
│   │   │   └── ui/                 # shadcn components (button, card, dialog, etc)
│   │   ├── lib/
│   │   │   ├── api/fastapi.ts      # Cliente HTTP API + warmUp
│   │   │   ├── hooks/              # 10 hooks de datos
│   │   │   ├── store/useAppStore.ts# Zustand (appStep, currentResult, weeklyDraft)
│   │   │   └── supabase/client.ts  # Browser client Supabase
│   │   └── types/index.ts          # Tipos TS + constantes (~554 LOC)
│   ├── public/                     # Assets estaticos (logo.svg)
│   └── package.json
│
├── supabase/
│   └── migrations/                 # 24 migraciones SQL (001 → 024)
│
├── data/                           # Datos locales (gitignored)
├── scripts/                        # Scripts de mantenimiento (algunos gitignored)
├── render.yaml                     # Config deploy Render.com
└── README.md
```

## Vistas del Frontend

| Ruta | Descripcion |
|------|-------------|
| `/datos` | Importar pedido y catalogo desde Excel (smart dropdowns) |
| `/catalogo` | Gestion del catalogo (imagenes, alternativas, maquinas complementarias) |
| `/operarios` | Roster + matriz de habilidades (11 skills granulares) |
| `/configuracion` | 6 sub-tabs: Robots, Capacidades, Fabricas, Dias, Pesos, Reglas permanentes |
| `/restricciones` | CRUD restricciones temporales (13 tipos) por semana |
| **`/planeacion`** | **Planeacion data-driven (sin solver)** — 5 tabs: |
| | • **Editor** — matriz modelo×dia, drag-drop, asignacion de robots por dia, "Generar escenario" |
| | • **Comparativo** — drill-down etapa/modelo/fraccion entre planes |
| | • **Desglose diario** — KPIs + mini-charts por etapa (horas + personas, linea de promedio) |
| | • **Tabla** — vista horizontal estilo Excel (semanas como columnas) + export `.xlsx` |
| | • **Referencia** — promedios historicos como baseline |
| `/balance-backlog` | Clasificacion A/B/C de modelos por complejidad y volumen |
| `/capacidad` | Matriz de capacidad instalada |
| `/sabana` | Sabana semanal (legacy hoja-de-calculo) |
| `/asistente` | Chat con Claude (historial en `chat_messages`) |
| `/resumen` | Resumen semanal post-optimizacion (KPIs, pivot modelo×dia, balance HC) |
| `/programa` | Programa diario detallado con bloques de colores + operarios asignados |
| `/utilizacion` | Heatmap headcount + chart de carga por bloque |
| `/robots` | Timeline de robots + cards de utilizacion |
| `/cuellos` | Alertas, restricciones activas, carga por modelo |

## API FastAPI — Endpoints

| Metodo | Path | Descripcion |
|--------|------|-------------|
| `POST` | `/api/optimize` | Pipeline completo: weekly → daily → operarios → save |
| `POST` | `/api/optimize-day` | Re-optimizacion de un solo dia |
| `POST` | `/api/generate-daily` | Daily a partir de un weekly_schedule manual ya guardado |
| `POST` | `/api/generate-from-plan` | Daily directo desde plan de `/planeacion` (sin pedido formal) |
| `POST` | `/api/reassign-operators` | Re-asigna operarios sobre un resultado existente |
| `POST` | `/api/import-catalog` | Parseo Excel → catalogo (modelos + operaciones) |
| `POST` | `/api/import-pedido/{nombre}` | Parseo Excel → pedido por semana |
| `GET` | `/api/template` | Descarga template Excel en blanco |
| `POST` | `/api/chat` | Chat con Claude (incluye attachments) |
| `POST` | `/api/capacity-plan` | Forecast de capacidad semanal |
| `POST` | `/api/analyze-gaps` | Gap analysis (que falta para cumplir target) |
| `POST` | `/api/propose-scenarios` | Generar escenarios what-if |
| `POST` | `/api/apply-scenario` | Persistir escenario seleccionado |
| `GET/POST` | `/api/balance-backlog/*` | Clasificacion A/B/C + balanceo de volumen |
| `GET` | `/api/health` | Health check (warm-up Render) |

## Hooks de Datos (`frontend/src/lib/hooks/`)

10 hooks para CRUD directo a Supabase desde el frontend:

| Hook | Descripcion |
|------|-------------|
| `useAuth` | Login / logout / estado de sesion |
| `useProfile` | Perfil del usuario actual (rol admin/usuario) |
| `useCatalogo` | Catalogo de modelos + operaciones |
| `useCatalogoImages` | URLs de imagenes (principal + alternativas por color) |
| `useConfiguracion` | Robots, capacidades, fabricas, dias, pesos |
| `useOperarios` | Roster + matriz de habilidades |
| `usePedido` | Pedidos + items + asignaciones de maquila |
| `useAvance` | Avance / progreso parcial (re-optimizacion) |
| `useReglas` | Restricciones permanentes (sin semana especifica) |
| `useRestricciones` | Restricciones temporales (con semana) |

## Componentes Shared (`frontend/src/components/shared/`)

11 componentes reutilizables:

| Componente | Descripcion |
|------------|-------------|
| `CascadeEditor` | Editor visual de precedencias (drag-drop, resize, ramas) |
| `ChatWidget` | Chat LLM embebible con attachments |
| `ConfirmDialog` | Modal de confirmacion (con palabra clave para acciones destructivas) |
| `DaySelector` | Botones Lun-Sab para filtros |
| `KpiCard` | Tarjeta de metrica (label + valor) |
| `ModeloImg` | Imagen del modelo (principal + por color) |
| `OperationNode` | Nodo de operacion para diagramas (color por etapa) |
| `PrecedenceGraph` | Grafo DAG de precedencias |
| `ProcessFlowDiagram` | Cursograma con export PDF/Excel |
| `TableExport` | Export tabla a Excel/PDF + copy JSON |
| `ThemeProvider` | Wrapper next-themes (dark/light) |

## Restricciones (13 tipos)

Definidas en `ConstraintType` enum en `frontend/src/types/index.ts`:

**Temporales (9)** — atadas a una semana especifica:
- `PRIORIDAD` — modelo prioritario
- `MAQUILA` — distribuir N pares a fabrica externa
- `RETRASO_MATERIAL` — modelo no disponible hasta dia X
- `FIJAR_DIA` — solo permitir / excluir dias especificos
- `FECHA_LIMITE` — deadline duro/blando
- `ROBOT_NO_DISPONIBLE` — robot fuera de servicio en dias X
- `AUSENCIA_OPERARIO` — operario falta dias X
- `CAPACIDAD_DIA` — ajustar plantilla del dia
- `AJUSTE_VOLUMEN` — sobrescribir volumen del modelo

**Permanentes (4)** — globales, configuradas en tab Reglas:
- `PRECEDENCIA_OPERACION` — orden entre fracciones de un modelo
- `LOTE_MINIMO_CUSTOM` — lote minimo por modelo
- `SECUENCIA` — secuencia entre modelos
- `AGRUPAR_MODELOS` — fuerza agrupar modelos en mismo dia

## Migraciones Supabase (24 archivos)

| # | Descripcion |
|---|-------------|
| 001 | Schema inicial: 22 tablas + 6 enums |
| 002 | Tabla chat_messages |
| 003 | RLS policies (user isolation) |
| 004 | Distribucion de maquila |
| 005-006 | Imagenes de modelo + alternativas por color |
| 007 | 20 skills granulares para operarios |
| 008 | Robot tipos (junction table) |
| 009 | Chat attachments |
| 010 | Enum recurso → text |
| 011-012 | Maquila fechas + lineas_post (POST conveyor) |
| 013-014 | Fabrica default + remover lead_time legacy |
| 015 | Pesos del optimizer diario |
| 016-018 | Skills simplificados (20→11), seed Excel, sin GENERAL |
| 019-020 | Niveles de habilidad + roles de usuario (admin/usuario) |
| 021 | Orden de plan_semanal_items |
| 022 | Tabla plan_robot_asignacion |
| 023 | Tabla robot_programa (matriz TIENE/FALTA) |
| 024 | Asignacion de robots **diaria** (columna `dia` en plan_robot_asignacion) |

## Pipeline de Optimizacion (`/api/optimize`)

10 pasos ejecutados en orden por `routes/optimize.py`:

1. **Cargar** params, catalogo, operarios, pedido, restricciones, avance
2. **Match** modelo pedido ↔ catalogo (fuzzy si no exact)
3. **Compilar** restricciones → `CompiledConstraints` (CP-SAT-ready)
4. **Ajustar volumenes** (maquila, volume_overrides, avance previo)
5. **Optimizer semanal** (`optimize`) — CP-SAT modelo×dia
6. **Scheduler diario** (`schedule_week`) — CP-SAT bloques horarios + robots
7. **Asignacion operarios** (`assign_operators_week`) — heuristica MRV con relevo
8. **Aplanar** schedule (rename block_pares → blocks, agregar etapa, operario)
9. **Calcular weekly_summary** con HC real
10. **Guardar** en tabla `resultados` con versionado (base_name + version)

Pipeline alternativo `/api/generate-from-plan` salta los pasos 4-5 y arma
`weekly_schedule` directamente desde el plan manual de `/planeacion`.

## Setup Local

### Prerequisitos
- Node.js 18+
- Python 3.11+
- Cuenta Supabase con las 24 migraciones aplicadas

### Frontend

```bash
cd frontend
cp .env.local.example .env.local   # NEXT_PUBLIC_SUPABASE_URL, ANON_KEY, API_URL
npm install
npm run dev                         # http://localhost:3000
```

### API

```bash
cd api
pip install -r requirements.txt
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... \
  uvicorn main:app --reload --port 8000
```

### Variables de Entorno

| Variable | Donde | Descripcion |
|----------|-------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Frontend (.env.local) | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Frontend (.env.local) | Anon key (publica) |
| `NEXT_PUBLIC_API_URL` | Frontend (.env.local) | URL base API FastAPI |
| `SUPABASE_URL` | API (Render env) | URL del proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | API (Render env) | Service role key (bypassa RLS) |
| `SUPABASE_KEY` | API (Render env) | Fallback de service role |
| `ANTHROPIC_API_KEY` | API (Render env) | API key Claude |

## Flujo de Uso

### Modo "Optimizar" (CP-SAT)
1. **Configurar** robots, capacidades, dias, pesos, reglas permanentes
2. **Importar catalogo** desde Excel
3. **Crear pedido** (manual o import) y agregar restricciones temporales
4. **Optimizar** desde TopBar → `/resumen`, `/programa`, `/utilizacion` muestran resultados
5. **Asistente Claude** para preguntas sobre los resultados

### Modo "Planeacion" (data-driven, sin solver)
1. **Crear plan** en `/planeacion` Editor (modelo×dia con pares)
2. **Asignar robots** por dia (linea negra entre dias en la UI)
3. **Comparar** con planes pasados en tab Comparativo / Desglose diario / Tabla
4. **"Generar escenario"** convierte el plan en programa diario sin pasar por solver semanal
5. **Resultados** aparecen en `/resumen` y `/programa` igual que el modo Optimizar

## Deploy

### API (Render.com)
- Auto-deploy on push a `main` via `render.yaml`
- Docker build con contexto raiz (accede a `src/`)
- Free tier — cold-start ~30s (mitigado con `wakeUpAPI` al cargar layout)
- Health check: `GET /api/health`

### Frontend (Vercel)
- Auto-deploy on push a `main`
- Root directory: `frontend/`
- Framework preset: Next.js
- Env vars configuradas en Vercel dashboard

## Constantes y Convenciones

- **DAY_ORDER**: `['Lun','Mar','Mie','Jue','Vie','Sab']` (orden display)
- **TIME_BLOCKS**: 11 bloques de 60 min (10 productivos + 1 COMIDA), 8:00 → 19:00
- **STAGE_COLORS**:
  - PRELIMINAR → amber
  - ROBOT → emerald
  - POST → pink
  - MAQUILA → violet
  - N/A PRELIMINAR → slate (UI: "N/A PRELIMINAR (Proceso directo a ensamble)")
- **modelo_num**: primeros 5 digitos del codigo (resto son sufijos de color)
- **Versionado**: `resultados` table con UNIQUE (base_name, version)
