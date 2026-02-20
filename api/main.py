"""
FastAPI backend para Pespunte Agent.

Solo expone lo que JavaScript no puede hacer:
- Optimizacion (OR-Tools CP-SAT)
- Importacion de Excel (openpyxl)
- LLM Assistant (Claude API)

El frontend habla directo a Supabase para CRUD de datos.
"""

import sys
from pathlib import Path

# Agregar src/ al path para importar modulos existentes
SRC_DIR = Path(__file__).parent.parent / "src"
sys.path.insert(0, str(SRC_DIR))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes.optimize import router as optimize_router
from routes.import_excel import router as import_router
from routes.assistant import router as assistant_router

app = FastAPI(
    title="Pespunte Agent API",
    version="1.0.0",
    description="Backend de optimizacion para el sistema de programacion de pespunte",
)

# CORS - permitir requests del frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",        # Next.js dev
        "https://*.vercel.app",         # Vercel production
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rutas
app.include_router(optimize_router, prefix="/api", tags=["Optimizacion"])
app.include_router(import_router, prefix="/api", tags=["Importacion"])
app.include_router(assistant_router, prefix="/api", tags=["Asistente"])


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "pespunte-agent-api"}
