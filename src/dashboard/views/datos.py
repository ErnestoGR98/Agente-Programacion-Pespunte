"""
datos.py - Pagina de entrada de datos: Pedido Semanal y Catalogo de Operaciones.

Permite capturar datos por formulario interactivo o subiendo Excel con template.
"""

import streamlit as st
import pandas as pd
import re

from dashboard.data_manager import (
    load_catalog, save_catalog, import_catalog_from_existing_excel,
    import_catalog_from_template, export_catalog_to_template,
    save_catalog_model, delete_catalog_model,
    save_pedido, load_pedido, list_pedidos, delete_pedido,
    save_pedido_draft, load_pedido_draft, clear_pedido_draft,
    import_pedido_from_template, build_matched_models,
    generate_template_pedido, generate_template_catalogo,
    VALID_RESOURCES,
)
from config_manager import get_fabricas, get_physical_robots


def _to_upper(key):
    """Callback: convierte a mayusculas el valor de un widget."""
    if key in st.session_state and isinstance(st.session_state[key], str):
        st.session_state[key] = st.session_state[key].upper()


def render():
    """Renderiza la pagina de entrada de datos."""
    tab_pedido, tab_catalogo = st.tabs(["Pedido Semanal", "Catalogo de Operaciones"])

    with tab_pedido:
        _render_pedido_section()

    with tab_catalogo:
        _render_catalogo_section()


# ===========================================================================
# PEDIDO SEMANAL
# ===========================================================================

def _render_pedido_section():
    """Seccion completa de pedido semanal."""
    st.subheader("Pedido Semanal")
    st.caption("Ingrese los modelos a producir esta semana")

    # Inicializar estado del pedido (cargar borrador si existe)
    if "pedido_rows" not in st.session_state:
        st.session_state.pedido_rows = load_pedido_draft()

    # Dos metodos: formulario o Excel
    method = st.radio(
        "Metodo de captura",
        ["Formulario", "Subir Excel"],
        horizontal=True,
        key="pedido_method",
    )

    if method == "Formulario":
        _render_pedido_form()
    else:
        _render_pedido_excel()

    st.divider()

    # Tabla editable con el pedido actual
    _render_pedido_table()

    st.divider()

    # Guardar / cargar pedido
    _render_pedido_save_load()


def _render_pedido_form():
    """Formulario para agregar modelos al pedido."""
    catalog = load_catalog() or {}

    # Contador de version para forzar reset de widgets
    if "_pedido_form_ver" not in st.session_state:
        st.session_state._pedido_form_ver = 0
    fv = st.session_state._pedido_form_ver

    # Toggle: modelo existente o nuevo
    is_new = st.toggle("Nuevo modelo (no existe en catalogo)", key="pedido_nuevo_toggle")

    cat_alternativas = []
    cat_clave = ""
    cat_fabrica = ""
    modelo_input = ""

    col1, col2, col3, col4, col5 = st.columns([2, 1.5, 1.5, 2, 2])

    if not is_new and catalog:
        # --- Modelo existente: dropdown ---
        modelos_nums = sorted(catalog.keys())
        with col1:
            selected_num = st.selectbox(
                "Modelo",
                options=[""] + modelos_nums,
                key=f"pedido_modelo_select_{fv}",
            )

        if selected_num:
            modelo_input = selected_num
            cat_data = catalog[selected_num]
            cat_alternativas = cat_data.get("alternativas", [])
            cat_clave = cat_data.get("clave_material", "")
            cat_fabrica = cat_data.get("fabrica", "")

            # Auto-llenar clave material y fabrica cuando cambia el modelo
            prev = st.session_state.get("_prev_pedido_modelo", "")
            if prev != selected_num:
                st.session_state["_prev_pedido_modelo"] = selected_num
                st.session_state[f"pedido_clave_{fv}"] = cat_clave
                st.session_state[f"pedido_fabrica_{fv}"] = cat_fabrica if cat_fabrica else "SIN FABRICA"

        with col2:
            if cat_alternativas:
                color = st.selectbox(
                    "Alternativa",
                    options=cat_alternativas,
                    key=f"pedido_color_select_{fv}",
                )
            else:
                color = st.text_input("Alternativa", key=f"pedido_color_{fv}",
                                       placeholder="Ej: NE", max_chars=2,
                                       on_change=_to_upper, args=(f"pedido_color_{fv}",))
    else:
        # --- Modelo nuevo: text input ---
        with col1:
            modelo_input = st.text_input("Modelo (5 digitos)", key=f"pedido_modelo_input_{fv}",
                                          placeholder="Ej: 65413", max_chars=5)
        with col2:
            color = st.text_input("Alternativa", key=f"pedido_color_new_{fv}",
                                   placeholder="Ej: NE", max_chars=2,
                                   on_change=_to_upper, args=(f"pedido_color_new_{fv}",))

    with col3:
        clave = st.text_input("Clave Material", key=f"pedido_clave_{fv}",
                               placeholder="Ej: SLI",
                               on_change=_to_upper, args=(f"pedido_clave_{fv}",))
    with col4:
        fabricas = get_fabricas()
        fab_options = ["SIN FABRICA"] + fabricas
        fabrica = st.selectbox("Fabrica", fab_options, key=f"pedido_fabrica_{fv}")
    with col5:
        volumen = st.number_input("Volumen (pares)",
                                   min_value=0, max_value=50000, value=0, step=50,
                                   key=f"pedido_volumen_{fv}")

    # Validar formato
    modelo_clean = modelo_input.strip()
    color_clean = color.strip().upper()
    clave_clean = clave.strip().upper()
    modelo_valid = bool(re.match(r"^\d{5}$", modelo_clean))
    color_valid = color_clean == "" or bool(re.match(r"^[A-Z]{2}$", color_clean))

    if modelo_clean and not modelo_valid:
        st.warning("El modelo debe ser exactamente 5 digitos (ej: 65413)")
    if color_clean and not color_valid:
        st.warning("La alternativa debe ser exactamente 2 letras (ej: NE)")

    # Aviso si el modelo nuevo ya existe
    if is_new and modelo_valid and modelo_clean in catalog:
        st.info(f"El modelo {modelo_clean} ya existe en el catalogo. Se actualizaran sus datos.")

    # Combinar modelo + color para el codigo completo
    modelo_full = modelo_clean
    if color_clean:
        modelo_full += f" {color_clean}"

    fabrica_valid = fabrica != "SIN FABRICA"
    if modelo_clean and not fabrica_valid:
        st.warning("Debe seleccionar una fabrica para agregar al pedido")

    can_add = modelo_valid and color_valid and fabrica_valid and volumen > 0

    if st.button("Agregar al Pedido", type="primary", disabled=(not can_add)):
        # Si es modelo nuevo, crearlo en el catalogo
        if is_new and modelo_clean not in catalog:
            new_alts = [color_clean] if color_clean else []
            new_model = {
                "codigo_full": modelo_full,
                "alternativas": new_alts,
                "clave_material": clave_clean,
                "fabrica": fabrica,
                "operations": [],
                "total_sec_per_pair": 0,
                "num_ops": 0,
                "resource_summary": {},
                "robot_ops": 0,
                "robots_used": [],
            }
            save_catalog_model(modelo_clean, new_model)
            st.toast(f"Modelo {modelo_clean} creado en catalogo")
        elif is_new and modelo_clean in catalog:
            # Actualizar datos del modelo existente
            existing = catalog[modelo_clean]
            alts = existing.get("alternativas", [])
            if color_clean and color_clean not in alts:
                alts.append(color_clean)
            existing["alternativas"] = alts
            if clave_clean:
                existing["clave_material"] = clave_clean
            if fabrica:
                existing["fabrica"] = fabrica
            existing["codigo_full"] = modelo_full
            save_catalog_model(modelo_clean, existing)

        st.session_state.pedido_rows.append({
            "modelo": modelo_full,
            "color": color_clean,
            "clave_material": clave_clean,
            "fabrica": fabrica,
            "volumen": volumen,
        })
        save_pedido_draft(st.session_state.pedido_rows)

        # Incrementar version para forzar reset de todos los widgets del formulario
        st.session_state._pedido_form_ver += 1
        st.session_state.pop("_prev_pedido_modelo", None)

        st.rerun()


def _render_pedido_excel():
    """Upload de pedido via template Excel."""
    col1, col2 = st.columns(2)

    with col1:
        st.download_button(
            "Descargar Template Pedido",
            data=generate_template_pedido(),
            file_name="template_pedido.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

    with col2:
        uploaded = st.file_uploader(
            "Subir template llenado",
            type=["xlsx"],
            key="pedido_upload",
        )

    if uploaded:
        pedido, errors = import_pedido_from_template(uploaded)
        if errors:
            for err in errors:
                st.warning(err)
        if pedido:
            st.success(f"{len(pedido)} modelos importados del Excel")
            if st.button("Usar estos datos", key="pedido_use_excel"):
                st.session_state.pedido_rows = pedido
                save_pedido_draft(pedido)
                st.rerun()
            # Preview
            st.dataframe(
                pd.DataFrame(pedido),
                width="stretch",
                hide_index=True,
            )


def _render_pedido_table():
    """Tabla editable del pedido actual."""
    rows = st.session_state.pedido_rows
    if not rows:
        st.info("No hay modelos en el pedido. Agregue modelos usando el formulario o suba un Excel.")
        return

    st.subheader(f"Pedido Actual ({len(rows)} modelos)")

    # Asegurar que todas las filas tengan campos color y clave_material
    for r in rows:
        if "color" not in r:
            r["color"] = ""
        if "clave_material" not in r:
            r["clave_material"] = ""

    df = pd.DataFrame(rows)
    df = df[["modelo", "color", "clave_material", "fabrica", "volumen"]]
    df.columns = ["MODELO", "ALTERNATIVA", "CLAVE MATERIAL", "FABRICA", "VOLUMEN"]

    # Mostrar tabla editable
    edited_df = st.data_editor(
        df,
        width="stretch",
        hide_index=True,
        num_rows="dynamic",
        height=min(400, 35 * (len(df) + 2) + 38),
        key="pedido_editor",
        column_config={
            "MODELO": st.column_config.TextColumn("MODELO", width="medium"),
            "ALTERNATIVA": st.column_config.TextColumn("ALTERNATIVA", width="small"),
            "CLAVE MATERIAL": st.column_config.TextColumn("CLAVE MATERIAL", width="small"),
            "FABRICA": st.column_config.SelectboxColumn(
                "FABRICA",
                options=get_fabricas(),
                width="small",
            ),
            "VOLUMEN": st.column_config.NumberColumn(
                "VOLUMEN", min_value=0, step=50, width="small",
            ),
        },
    )

    # Sincronizar cambios del editor
    new_rows = []
    for _, row in edited_df.iterrows():
        modelo = row.get("MODELO")
        if modelo and str(modelo).strip():
            color_val = str(row["ALTERNATIVA"]).strip() if pd.notna(row.get("ALTERNATIVA")) else ""
            clave_val = str(row["CLAVE MATERIAL"]).strip() if pd.notna(row.get("CLAVE MATERIAL")) else ""
            new_rows.append({
                "modelo": str(row["MODELO"]).strip(),
                "color": color_val,
                "clave_material": clave_val,
                "fabrica": str(row["FABRICA"]).strip(),
                "volumen": int(row["VOLUMEN"]) if pd.notna(row["VOLUMEN"]) else 0,
            })
    # Solo guardar borrador si hubo cambios reales
    if new_rows != st.session_state.pedido_rows:
        save_pedido_draft(new_rows)
    st.session_state.pedido_rows = new_rows

    # Resumen
    total_pares = sum(r["volumen"] for r in new_rows)
    st.metric("Total Pares", f"{total_pares:,}")

    # Validar contra catalogo
    catalog = load_catalog()
    if catalog and new_rows:
        matched, unmatched = build_matched_models(new_rows, catalog)
        if unmatched:
            st.warning(
                f"{len(unmatched)} modelos no encontrados en catalogo: "
                + ", ".join(m["codigo"] for m in unmatched)
            )
        if matched:
            st.success(f"{len(matched)} modelos listos para optimizar")

    col1, col2 = st.columns(2)
    with col1:
        if st.button("Limpiar Pedido", type="secondary"):
            st.session_state.pedido_rows = []
            clear_pedido_draft()
            st.rerun()
    with col2:
        if new_rows and catalog:
            if st.button("Cargar al Optimizador", type="primary"):
                _load_pedido_to_optimizer(new_rows, catalog)


def _load_pedido_to_optimizer(pedido_rows, catalog):
    """Carga el pedido actual al pipeline de optimizacion."""
    matched, unmatched = build_matched_models(pedido_rows, catalog)
    if not matched:
        st.error("No hay modelos con match en el catalogo")
        return

    st.session_state.matched_models = matched
    st.session_state.unmatched_models = unmatched
    st.session_state.catalog = catalog

    # Inicializar parametros si no existen
    if not st.session_state.params:
        from rules import get_default_params
        st.session_state.params = get_default_params()

    st.session_state.pipeline_step = 1
    # Limpiar resultados anteriores
    st.session_state.weekly_schedule = None
    st.session_state.weekly_summary = None
    st.session_state.daily_results = None

    st.success(
        f"{len(matched)} modelos cargados | "
        f"{sum(m['total_producir'] for m in matched):,} pares | "
        f"{len(unmatched)} sin match"
    )
    st.rerun()


def _render_pedido_save_load():
    """Guardar y cargar pedidos."""
    st.subheader("Guardar / Cargar Pedido")

    col1, col2 = st.columns(2)

    with col1:
        pedido_name = st.text_input(
            "Nombre del pedido",
            placeholder="sem_8_2025",
            key="pedido_name_input",
        )
        if st.button("Guardar", disabled=(not pedido_name or not st.session_state.pedido_rows)):
            save_pedido(pedido_name, st.session_state.pedido_rows)
            st.success(f"Pedido '{pedido_name}' guardado")

    with col2:
        saved = [p for p in list_pedidos() if p != "_borrador"]
        if saved:
            selected_pedido = st.selectbox("Pedidos guardados", [""] + saved,
                                            key="pedido_load_select")
            c1, c2 = st.columns(2)
            with c1:
                if st.button("Cargar", disabled=(not selected_pedido)):
                    loaded = load_pedido(selected_pedido)
                    if loaded:
                        st.session_state.pedido_rows = loaded
                        save_pedido_draft(loaded)
                        st.success(f"Pedido '{selected_pedido}' cargado")
                        st.rerun()
            with c2:
                if st.button("Eliminar", disabled=(not selected_pedido)):
                    delete_pedido(selected_pedido)
                    st.success(f"Pedido '{selected_pedido}' eliminado")
                    st.rerun()
        else:
            st.info("No hay pedidos guardados")


# ===========================================================================
# CATALOGO DE OPERACIONES
# ===========================================================================

def _render_catalogo_section():
    """Seccion completa de catalogo de operaciones."""
    st.subheader("Catalogo de Operaciones")

    catalog = load_catalog()

    if catalog:
        _render_catalogo_status(catalog)
        st.divider()
        _render_catalogo_edit(catalog)
        st.divider()

    _render_catalogo_import()

    if catalog:
        st.divider()
        _render_catalogo_add_model(catalog)


def _render_catalogo_status(catalog):
    """Muestra resumen del catalogo cargado."""
    total_ops = sum(m["num_ops"] for m in catalog.values())
    total_robots = sum(m.get("robot_ops", 0) for m in catalog.values())

    c1, c2, c3 = st.columns(3)
    c1.metric("Modelos", len(catalog))
    c2.metric("Operaciones", total_ops)
    c3.metric("Ops con Robot", total_robots)

    # Tabla resumen
    rows = []
    for num, data in sorted(catalog.items()):
        rows.append({
            "Num": num,
            "Modelo": data["codigo_full"],
            "Fabrica": data.get("fabrica", ""),
            "Operaciones": data["num_ops"],
            "Sec/Par": data["total_sec_per_pair"],
            "Min/Par": round(data["total_sec_per_pair"] / 60, 1),
            "Robots": ", ".join(data.get("robots_used", [])),
        })
    with st.expander(f"Ver {len(catalog)} modelos del catalogo", expanded=False):
        st.dataframe(pd.DataFrame(rows), width="stretch", hide_index=True)

    # Boton de exportar
    col1, col2 = st.columns(2)
    with col1:
        st.download_button(
            "Exportar Catalogo a Excel",
            data=export_catalog_to_template(catalog),
            file_name="catalogo_exportado.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )


def _render_catalogo_import():
    """Seccion para importar catalogo desde Excel."""
    st.subheader("Importar Catalogo")

    import_type = st.radio(
        "Tipo de archivo",
        ["Excel existente (formato CATALOGO DE FRACCIONES)", "Template propio"],
        horizontal=True,
        key="catalog_import_type",
    )

    if import_type == "Template propio":
        st.download_button(
            "Descargar Template Catalogo",
            data=generate_template_catalogo(),
            file_name="template_catalogo.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

    uploaded = st.file_uploader(
        "Subir archivo Excel del catalogo",
        type=["xlsx"],
        key="catalog_upload",
    )

    if uploaded:
        if import_type.startswith("Excel existente"):
            try:
                catalog = import_catalog_from_existing_excel(uploaded)
                st.success(
                    f"Catalogo importado: {len(catalog)} modelos, "
                    f"{sum(m['num_ops'] for m in catalog.values())} operaciones"
                )
                st.rerun()
            except Exception as e:
                st.error(f"Error al importar: {e}")
        else:
            catalog, errors = import_catalog_from_template(uploaded)
            if errors:
                for err in errors[:10]:
                    st.warning(err)
                if len(errors) > 10:
                    st.warning(f"... y {len(errors) - 10} errores mas")
            if catalog:
                st.success(
                    f"Catalogo importado: {len(catalog)} modelos, "
                    f"{sum(m['num_ops'] for m in catalog.values())} operaciones"
                )
                st.rerun()


def _render_catalogo_edit(catalog):
    """Editar modelo existente del catalogo."""
    st.subheader("Editar Modelo Existente")

    modelos = sorted(catalog.keys())

    selected = st.selectbox(
        "Seleccionar modelo",
        options=[""] + modelos,
        key="catalog_edit_select",
    )

    if not selected:
        return

    model_num = selected
    model_data = catalog[model_num]

    st.caption(f"{model_data['num_ops']} operaciones | "
               f"{model_data['total_sec_per_pair']} sec/par")

    # Campos editables de alternativas, clave material y fabrica
    ec1, ec2, ec3 = st.columns(3)
    with ec1:
        alts_str = ", ".join(model_data.get("alternativas", []))
        alts_key = f"cat_alts_{model_num}"
        edited_alts = st.text_input(
            "Alternativas (separar por coma)",
            value=alts_str,
            key=alts_key,
            placeholder="Ej: NE, GC, BL",
            on_change=_to_upper, args=(alts_key,),
        )
    with ec2:
        clave_key = f"cat_clave_{model_num}"
        edited_clave = st.text_input(
            "Clave Material",
            value=model_data.get("clave_material", ""),
            key=clave_key,
            placeholder="Ej: SLI, TEX",
            on_change=_to_upper, args=(clave_key,),
        )
    with ec3:
        fabricas = get_fabricas()
        current_fab = model_data.get("fabrica", "")
        fab_options = [""] + fabricas
        fab_idx = fab_options.index(current_fab) if current_fab in fab_options else 0
        edited_fabrica = st.selectbox(
            "Fabrica",
            options=fab_options,
            index=fab_idx,
            key=f"cat_fab_{model_num}",
        )

    # Construir DataFrame editable de operaciones
    ops_rows = []
    for op in model_data["operations"]:
        ops_rows.append({
            "FRACCION": op["fraccion"],
            "OPERACION": op["operacion"],
            "RECURSO": op["recurso"],
            "RATE": op["rate"],
            "ROBOTS": ", ".join(op.get("robots", [])),
        })

    df_ops = pd.DataFrame(ops_rows)

    edited_ops = st.data_editor(
        df_ops,
        width="stretch",
        hide_index=True,
        num_rows="dynamic",
        height=min(500, 35 * (len(df_ops) + 2) + 38),
        key=f"catalog_edit_{model_num}",
        column_config={
            "FRACCION": st.column_config.NumberColumn("FRACC", min_value=1, step=1, width="small"),
            "OPERACION": st.column_config.TextColumn("OPERACION", width="large"),
            "RECURSO": st.column_config.SelectboxColumn(
                "RECURSO",
                options=sorted(VALID_RESOURCES),
                width="small",
            ),
            "RATE": st.column_config.NumberColumn("RATE", min_value=1, step=1, width="small"),
            "ROBOTS": st.column_config.TextColumn("ROBOTS", width="medium",
                                                     help="Separar por coma: 3020-M4, 6040-M5"),
        },
    )

    col1, col2 = st.columns(2)
    with col1:
        if st.button("Guardar Cambios", key=f"save_model_{model_num}", type="primary"):
            # Parsear alternativas editadas
            new_alts = [a.strip().upper() for a in edited_alts.split(",") if a.strip()]
            new_clave = edited_clave.strip().upper()
            _save_edited_model(model_num, model_data["codigo_full"], edited_ops,
                               alternativas=new_alts,
                               clave_material=new_clave,
                               fabrica=edited_fabrica)
    with col2:
        if st.button("Eliminar Modelo", key=f"delete_model_{model_num}"):
            delete_catalog_model(model_num)
            st.success(f"Modelo {model_num} eliminado")
            st.rerun()


def _save_edited_model(model_num, codigo_full, edited_df,
                       alternativas=None, clave_material="", fabrica=""):
    """Guarda las operaciones editadas de un modelo."""
    operations = []
    for _, row in edited_df.iterrows():
        fraccion = row.get("FRACCION")
        if not fraccion or pd.isna(fraccion):
            continue

        rate = float(row["RATE"]) if pd.notna(row.get("RATE")) else 0
        if rate <= 0:
            continue

        # Parsear robots
        robots_str = str(row.get("ROBOTS", "")) if pd.notna(row.get("ROBOTS")) else ""
        robots = []
        for r in robots_str.split(","):
            r = r.strip()
            if r and r in set(get_physical_robots()):
                robots.append(r)

        operations.append({
            "fraccion": int(fraccion),
            "operacion": str(row["OPERACION"]).strip() if pd.notna(row.get("OPERACION")) else "",
            "etapa": "",
            "recurso": str(row["RECURSO"]).strip() if pd.notna(row.get("RECURSO")) else "GENERAL",
            "recurso_raw": str(row["RECURSO"]).strip() if pd.notna(row.get("RECURSO")) else "",
            "robots": robots,
            "rate": round(rate, 2),
            "sec_per_pair": round(3600.0 / rate),
        })

    operations.sort(key=lambda x: x["fraccion"])
    total_sec = sum(op["sec_per_pair"] for op in operations)
    resource_summary = {}
    for op in operations:
        r = op["recurso"]
        resource_summary[r] = resource_summary.get(r, 0) + 1

    robot_ops = sum(1 for op in operations if op.get("robots"))
    all_robots = set()
    for op in operations:
        for r in op.get("robots", []):
            all_robots.add(r)

    model_data = {
        "codigo_full": codigo_full,
        "alternativas": alternativas or [],
        "clave_material": clave_material or "",
        "fabrica": fabrica or "",
        "operations": operations,
        "total_sec_per_pair": total_sec,
        "num_ops": len(operations),
        "resource_summary": resource_summary,
        "robot_ops": robot_ops,
        "robots_used": sorted(all_robots),
    }

    save_catalog_model(model_num, model_data)
    st.success(f"Modelo {model_num} guardado ({len(operations)} operaciones)")


def _render_catalogo_add_model(catalog):
    """Formulario para agregar un modelo nuevo al catalogo."""
    st.subheader("Agregar Modelo Nuevo")

    modelo_code = st.text_input(
        "Codigo del modelo",
        placeholder="Ej: 12345 NE NOMBRE",
        key="new_model_code",
        on_change=_to_upper, args=("new_model_code",),
    )

    if not modelo_code:
        return

    # Verificar que no exista
    m = re.match(r"^(\d+)", modelo_code.strip())
    if not m:
        st.warning("El codigo debe iniciar con un numero")
        return

    model_num = m.group(1)
    if model_num in catalog:
        st.warning(f"El modelo {model_num} ya existe en el catalogo. Use 'Editar' para modificarlo.")
        return

    st.caption("Agregue las operaciones del nuevo modelo:")

    # Tabla editable vacia para operaciones nuevas
    if "new_model_ops" not in st.session_state:
        st.session_state.new_model_ops = pd.DataFrame({
            "FRACCION": pd.Series(dtype="int"),
            "OPERACION": pd.Series(dtype="str"),
            "RECURSO": pd.Series(dtype="str"),
            "RATE": pd.Series(dtype="float"),
            "ROBOTS": pd.Series(dtype="str"),
        })

    edited_new = st.data_editor(
        st.session_state.new_model_ops,
        width="stretch",
        hide_index=True,
        num_rows="dynamic",
        height=300,
        key="new_model_editor",
        column_config={
            "FRACCION": st.column_config.NumberColumn("FRACC", min_value=1, step=1, width="small"),
            "OPERACION": st.column_config.TextColumn("OPERACION", width="large"),
            "RECURSO": st.column_config.SelectboxColumn(
                "RECURSO",
                options=sorted(VALID_RESOURCES),
                width="small",
            ),
            "RATE": st.column_config.NumberColumn("RATE", min_value=1, step=1, width="small"),
            "ROBOTS": st.column_config.TextColumn("ROBOTS", width="medium",
                                                     help="Separar por coma: 3020-M4, 6040-M5"),
        },
    )

    if st.button("Guardar Nuevo Modelo", type="primary", key="save_new_model"):
        if edited_new.empty:
            st.warning("Agregue al menos una operacion")
            return

        _save_edited_model(model_num, modelo_code.strip(), edited_new)
        st.session_state.new_model_ops = pd.DataFrame({
            "FRACCION": pd.Series(dtype="int"),
            "OPERACION": pd.Series(dtype="str"),
            "RECURSO": pd.Series(dtype="str"),
            "RATE": pd.Series(dtype="float"),
            "ROBOTS": pd.Series(dtype="str"),
        })
        st.rerun()
