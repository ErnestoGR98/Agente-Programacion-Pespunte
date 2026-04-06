# Backlog Tool — Generador de Propuesta Optimizada

Sistema autónomo (sin IA) para distribuir un backlog de pares en semanas, balanceando capacidad de robots, mezcla de productos y lotes contiguos. Usa datos reales de Supabase.

**Tú das**: qué modelos y cuántos pares totales.
**El sistema decide**: en qué semanas y con qué tamaños de lote.

---

## Estructura

```
backlog_tool/
├── README.md                  ← este archivo
├── generar_propuesta.py       ← script principal
├── plantilla.xlsx             ← plantilla en blanco para crear nuevos backlogs
├── template_visual.xlsx       ← plantilla del Excel de salida (NO BORRAR)
├── overrides.yaml.example     ← template de overrides temporales
├── overrides.yaml             ← (opcional, lo creas tú)
├── inputs/                    ← aquí pones los Excel de backlog
│   └── Backlog_Andrea_ejemplo.xlsx
└── outputs/                   ← aquí caen los archivos generados
```

---

## Uso rápido (3 pasos)

### 1. Preparar el Excel de input
- Copia `plantilla.xlsx` a `inputs/` con un nombre nuevo:
  ```
  inputs/Backlog_Mayo.xlsx
  ```
- Ábrelo y llena:
  - **Celda C4**: semana ISO de inicio (ej: `15`)
  - **Celda C5**: semana ISO de fin (ej: `21`)
  - **Columna B**: modelos (formato `12345 XX SLI`)
  - **Columna C**: total de pares por modelo para TODO el rango

### 2. Correr el script
```bash
python backlog_tool/generar_propuesta.py --input Backlog_Mayo.xlsx
```
El script busca automáticamente en `backlog_tool/inputs/`.

### 3. Abrir el resultado
Se genera en `backlog_tool/outputs/` con nombre tipo:
```
Backlog_Mayo_OPTIMIZADO_S15_20260406_1530.xlsx
```
Donde:
- `S15` = semana ISO actual
- `20260406` = fecha (YYYYMMDD)
- `1530` = hora (HHMM)

Cada corrida genera un archivo nuevo (no sobreescribe los anteriores).

---

## Formato del Excel input

### Formato simple (recomendado)
```
┌─────────────────────────────────────┐
│  Semana inicio: [15]                │
│  Semana fin:    [21]                │
│                                     │
│  Modelo              │ Total Pares  │
│  68127 NE/RO SLI     │       3,900  │
│  64197 NE SLI        │       4,100  │
│  65568 RO/HU SLI     │       3,300  │
│  ...                                │
└─────────────────────────────────────┘
```
**Usa `plantilla.xlsx`** — ya tiene la estructura lista.

### Formato legacy (compatible)
Si tu Excel viene con matriz modelo × semana, el script también lo entiende y suma las filas para obtener el total.

---

## Ajustes comunes (sin tocar código)

### Cambiar máximo de modelos por semana
```bash
python backlog_tool/generar_propuesta.py --input Backlog_Mayo.xlsx --max-modelos 4
```

### Excluir un modelo
```bash
python backlog_tool/generar_propuesta.py --input Backlog_Mayo.xlsx --excluir 93347
```

### Forzar un modelo en semanas específicas
```bash
python backlog_tool/generar_propuesta.py --input Backlog_Mayo.xlsx --fijar "68127 NE/RO SLI:17,18"
```

### Solo ver el resultado en pantalla (sin generar Excel)
```bash
python backlog_tool/generar_propuesta.py --input Backlog_Mayo.xlsx --dry-run
```

### Combinar varios
```bash
python backlog_tool/generar_propuesta.py --input Backlog_Mayo.xlsx --max-modelos 4 --excluir 93347 --dry-run
```

---

## Reglas que aplica

| # | Regla | Por qué |
|---|---|---|
| 1 | Cuello = robots compartidos | Es el recurso más limitado |
| 2 | Máx 5 modelos por semana | Evita mezcla excesiva |
| 3 | Lotes contiguos (1-3 sem por modelo según volumen) | No fragmentar producción |
| 4 | Modelos con robots únicos se aíslan primero | Ej: 62100 BL |
| 5 | Modelos sin robot (maquila/sin catálogo) como relleno | No saturan el cuello |

Las reglas viven en `generar_propuesta.py`. Para cambiarlas estructuralmente, abre Claude Code y pídelo.

---

## Cambios temporales (días/semanas)

Usa `backlog_tool/overrides.yaml`:

1. Copia el ejemplo:
   ```bash
   copy backlog_tool\overrides.yaml.example backlog_tool\overrides.yaml
   ```
2. Edítalo (ej: bajar máximo a 4, fijar fecha de expiración, restar capacidad de robots por mantenimiento)
3. Corre el script normal — los lee automáticamente
4. Cuando ya no aplica → borra el archivo o pon `activo: false`

---

## ¿El script "piensa" cada vez?

**Sí.** Cada corrida:
- Consulta Supabase EN VIVO (robots, catálogo, restricciones)
- Re-ejecuta el algoritmo desde cero
- Genera distribución nueva

`template_visual.xlsx` solo se usa como **plantilla visual** (imágenes, colores, fórmulas vivas del Excel output). Los valores de distribución siempre son nuevos.

---

## ¿Cuándo necesito a Claude (IA)?

| Escenario | ¿IA? |
|---|---|
| Correr el script con un nuevo backlog | ❌ no |
| Cambiar máximo de modelos / excluir / fijar | ❌ no (usa flags) |
| Cambio temporal con fecha de expiración | ❌ no (usa overrides.yaml) |
| Agregar reglas nuevas al script | ✅ sí |
| Diagnosticar por qué un resultado no convence | ✅ sí |
| Cambiar estructura del Excel output | ✅ sí |

---

## Costo
**$0 por corrida.** No usa IA. Solo Python + Supabase (plan gratis).

---

## Errores comunes

| Mensaje | Solución |
|---|---|
| `No existe: X.xlsx` | Verifica que el archivo esté en `backlog_tool/inputs/` o pasa la ruta completa |
| `Template no existe` | Verifica que `backlog_tool/template_visual.xlsx` exista |
| `PyYAML no instalado` | `pip install pyyaml` (solo si usas overrides.yaml) |
| `[ERROR Supabase]` | Revisa conexión a internet |
| `No se encontró tabla de backlog` | Verifica que el Excel tenga las celdas "Semana inicio"/"Semana fin" + columnas "Modelo"/"Total Pares" |
| Totales no coinciden | Reporta a Claude — algo salió mal con el algoritmo |

---

## Modelos nuevos no en catálogo
Si pones un modelo que **no existe en `catalogo_modelos` de Supabase**:
- El script lo trata como **"sin catálogo"** (neutro: no consume robots)
- Lo distribuye como relleno en semanas con menos modelos
- En las hojas semanales aparece como "SIN CATALOGO"

Si quieres que use seg/par real → dar de alta el modelo desde `/catalogo` del frontend antes de correr el script.
