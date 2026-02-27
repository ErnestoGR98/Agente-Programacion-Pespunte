# Pespunte Agent

Sistema de programacion de produccion para el area de pespunte (costura) de calzado. Optimiza la asignacion semanal y diaria de modelos, operaciones, robots y operarios usando programacion con restricciones (CP-SAT).

## Stack Tecnologico

| Capa | Tecnologia | Ubicacion |
|------|-----------|-----------|
| Frontend | Next.js 16 + React 19 + TypeScript | `frontend/` |
| UI | Tailwind CSS v4 + shadcn/ui (Radix) | `frontend/src/components/ui/` |
| Estado | Zustand v5 | `frontend/src/lib/store/` |
| Graficas | Recharts v3 | Vistas de resultados |
| Base de datos | Supabase (PostgreSQL) | `supabase/migrations/` |
| API | FastAPI + Python 3.11 | `api/` |
| Solver | Google OR-Tools CP-SAT | `src/optimizer_*.py` |
| LLM | Anthropic Claude API | `src/llm_assistant.py` |
| Deploy API | Render.com (Docker, free tier) | `api/Dockerfile` |
| Deploy Frontend | Vercel | Next.js auto-deploy |

## Estructura del Proyecto

```
pespunte-agent/
├── api/                          # FastAPI backend
│   ├── main.py                   # Entry point, CORS, routers
│   ├── Dockerfile                # Deploy en Render
│   ├── requirements.txt          # Deps Python
│   └── routes/
│       ├── optimize.py           # POST /api/optimize (pipeline completo)
│       ├── import_excel.py       # POST /api/import-catalog, import-pedido
│       └── assistant.py          # POST /api/chat (Claude LLM)
│
├── src/                          # Modulos Python compartidos
│   ├── optimizer_weekly.py       # Iter 1: CP-SAT semanal (modelo-dia)
│   ├── optimizer_v2.py           # Iter 2: CP-SAT diario (bloques horarios)
│   ├── constraint_compiler.py    # Iter 3: compilador de restricciones
│   ├── operator_assignment.py    # Iter 3: asignacion de operarios (heuristica)
│   ├── llm_assistant.py          # Iter 4: asistente Claude
│   ├── excel_parsers.py          # Parseo de Excel (catalogo, pedido)
│   ├── config_manager.py         # Lectura de config.json
│   ├── loader.py                 # Carga de datos desde JSON
│   ├── catalog_loader.py         # Carga de catalogo
│   ├── fuzzy_match.py            # Match fuzzy modelo pedido <-> catalogo
│   └── rules.py                  # Reglas de negocio legacy
│
├── frontend/                     # Next.js 16 App Router
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx        # Root layout (fonts, globals.css)
│   │   │   ├── page.tsx          # Landing page
│   │   │   └── (dashboard)/      # Route group (12 vistas)
│   │   │       ├── layout.tsx    # Sidebar + TopBar + wakeUpAPI
│   │   │       ├── datos/        # Pedido semanal + catalogo
│   │   │       ├── catalogo/     # Gestion catalogo (imagenes, alternativas)
│   │   │       ├── restricciones/# Restricciones temporales
│   │   │       ├── operarios/    # Gestion de personal
│   │   │       ├── configuracion/# 6 tabs: Robots, Capacidades, Fabricas, Dias, Pesos, Reglas
│   │   │       ├── asistente/    # Chat con Claude
│   │   │       ├── resumen/      # Resumen semanal (post-optimizacion)
│   │   │       ├── programa/     # Programa diario detallado
│   │   │       ├── utilizacion/  # Heatmap HC + carga por bloque
│   │   │       ├── robots/       # Timeline de robots
│   │   │       └── cuellos/      # Alertas y cuellos de botella
│   │   ├── components/
│   │   │   ├── layout/           # Sidebar.tsx, TopBar.tsx
│   │   │   ├── shared/           # CascadeEditor, KpiCard, DaySelector, ChatWidget, +7 mas
│   │   │   └── ui/               # shadcn components
│   │   ├── lib/
│   │   │   ├── api/fastapi.ts    # Cliente HTTP para la API
│   │   │   ├── hooks/            # 9 hooks: useConfiguracion, useOperarios, usePedido, useRestricciones, useReglas, useCatalogo, useCatalogoImages, useAvance, useAuth
│   │   │   ├── store/useAppStore.ts  # Zustand (appStep, currentResult)
│   │   │   └── supabase/client.ts    # Browser client Supabase
│   │   └── types/index.ts        # Todos los tipos TypeScript + constantes (~554 LOC)
│   └── package.json
│
├── supabase/
│   └── migrations/               # 10 migraciones (001 a 010)
│       ├── 001_initial_schema.sql  # Schema base: 22 tablas, 6 enums
│       ├── 002_chat_messages.sql   # Chat con LLM
│       ├── 003_user_isolation.sql  # RLS policies
│       ├── 004_maquila_distribution.sql
│       ├── 005_modelo_imagen.sql   # Imagenes de modelos
│       ├── 006_alternativas_imagenes.sql
│       ├── 007_habilidades.sql     # 20 skills granulares para operarios
│       ├── 008_robot_tipos.sql
│       ├── 009_chat_attachments.sql
│       └── 010_recurso_text.sql    # resource_type enum → text
│
├── data/                         # Datos locales (gitignored)
│   └── template_pespunte_v2.xlsx # Template Excel consolidado
│
└── render.yaml                   # Config deploy Render.com
```

## Setup Local

### Prerequisitos
- Node.js 18+
- Python 3.11+
- Cuenta Supabase (proyecto creado con las 10 migraciones en `supabase/migrations/`)

### Frontend

```bash
cd frontend
cp .env.local.example .env.local   # configurar SUPABASE_URL, SUPABASE_ANON_KEY, API_URL
npm install
npm run dev                         # http://localhost:3000
```

### API (opcional, para optimizacion)

```bash
cd api
pip install -r requirements.txt
SUPABASE_URL=... SUPABASE_KEY=... uvicorn main:app --reload --port 8000
```

### Variables de Entorno

| Variable | Donde | Descripcion |
|----------|-------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Frontend (.env.local) | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Frontend (.env.local) | Anon key de Supabase |
| `NEXT_PUBLIC_API_URL` | Frontend (.env.local) | URL base de la API FastAPI |
| `SUPABASE_URL` | API (Render env) | URL del proyecto Supabase |
| `SUPABASE_KEY` | API (Render env) | Service role key de Supabase |
| `ANTHROPIC_API_KEY` | API (Render env) | API key de Anthropic Claude |

## Pipeline de Optimizacion

El endpoint `POST /api/optimize` ejecuta 4 iteraciones secuenciales:

1. **Semanal** (CP-SAT) - Asigna pares por modelo a cada dia de la semana
2. **Diaria** (CP-SAT) - Programa operaciones en bloques horarios con robots
3. **Operarios** (Heuristica MRV) - Asigna operarios a operaciones
4. **Resultados** - Guarda en Supabase con versionado automatico

Ver [ARCHITECTURE.md](ARCHITECTURE.md) para detalles tecnicos.

## Flujo de Uso

1. **Configurar** - Robots, capacidades, dias, pesos, reglas permanentes (tab Configuracion, 6 sub-tabs)
2. **Importar catalogo** - Excel con modelos y operaciones (tab Datos > Catalogo)
3. **Gestionar catalogo** - Imagenes, alternativas, maquinas complementarias (tab Catalogo)
4. **Crear pedido** - Manual o importar Excel (tab Datos > Pedido)
5. **Agregar restricciones** - Prioridades, maquila, delays, fechas limite (tab Restricciones)
6. **Definir reglas** - Precedencias de operacion via editor visual CascadeEditor (tab Configuracion > Reglas)
7. **Optimizar** - Boton "Optimizar" en TopBar
8. **Analizar** - Resumen semanal, programa diario, utilizacion HC, robots, cuellos de botella
9. **Consultar** - Asistente LLM para preguntas sobre los resultados

## Deploy

### API (Render.com)
- Push a `main` → auto-deploy via `render.yaml`
- Docker build desde `api/Dockerfile` con contexto raiz (accede a `src/`)
- Health check: `GET /api/health`

### Frontend (Vercel)
- Root directory: `frontend`
- Framework preset: Next.js
- Configurar env vars en Vercel dashboard
