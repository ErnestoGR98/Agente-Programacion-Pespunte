"""
asistente.py - Chat de lenguaje natural con Claude para consultas de produccion.

El asistente tiene acceso al contexto actual (pedido, schedule, restricciones,
avance) y responde preguntas sobre la programacion.
"""

import streamlit as st

from config_manager import load_config


def render():
    """Renderiza la pagina del asistente."""
    st.subheader("Asistente de Produccion")

    config = load_config()
    llm_config = config.get("llm", {})
    api_key = llm_config.get("api_key", "")

    if not api_key:
        st.warning(
            "No hay API key configurada. "
            "Ve a **Configuracion > LLM** para agregar tu Anthropic API key."
        )
        return

    # Inicializar historial
    if "chat_messages" not in st.session_state:
        st.session_state.chat_messages = []

    # Sugerencias rapidas
    _render_suggestions()

    # Historial de chat
    for msg in st.session_state.chat_messages:
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])

    # Input del usuario
    prompt = st.chat_input("Pregunta sobre la programacion...")

    if prompt:
        _handle_message(prompt, api_key, llm_config.get("model", "claude-sonnet-4-5-20250929"))


def _render_suggestions():
    """Muestra botones de sugerencias si el chat esta vacio."""
    if st.session_state.chat_messages:
        # Boton para limpiar chat
        if st.button("Limpiar chat", key="clear_chat"):
            st.session_state.chat_messages = []
            st.rerun()
        return

    st.caption("Ejemplos de preguntas:")
    cols = st.columns(2)
    suggestions = [
        "Que modelos van el martes?",
        "Por que hay tardiness?",
        "Que robots estan saturados?",
        "Como puedo reducir el overtime?",
    ]
    for i, sug in enumerate(suggestions):
        with cols[i % 2]:
            if st.button(sug, key=f"sug_{i}"):
                config = load_config()
                llm_config = config.get("llm", {})
                _handle_message(
                    sug,
                    llm_config["api_key"],
                    llm_config.get("model", "claude-sonnet-4-5-20250929"),
                )


def _handle_message(prompt: str, api_key: str, model: str):
    """Procesa un mensaje del usuario."""
    from llm_assistant import chat

    # Agregar mensaje del usuario
    st.session_state.chat_messages.append({"role": "user", "content": prompt})

    with st.chat_message("user"):
        st.markdown(prompt)

    # Llamar a Claude
    with st.chat_message("assistant"):
        with st.spinner("Pensando..."):
            try:
                # Construir state dict para el contexto
                state = {
                    "pedido_rows": st.session_state.get("pedido_rows"),
                    "weekly_schedule": st.session_state.get("weekly_schedule"),
                    "weekly_summary": st.session_state.get("weekly_summary"),
                    "daily_results": st.session_state.get("daily_results"),
                    "restricciones": st.session_state.get("restricciones"),
                    "avance": st.session_state.get("avance"),
                    "params": st.session_state.get("params"),
                }

                response = chat(
                    messages=st.session_state.chat_messages,
                    state=state,
                    api_key=api_key,
                    model=model,
                )

                st.markdown(response)
                st.session_state.chat_messages.append(
                    {"role": "assistant", "content": response}
                )
            except Exception as e:
                error_msg = str(e)
                if "authentication" in error_msg.lower() or "api key" in error_msg.lower():
                    st.error("API key invalida. Revisa la configuracion en Configuracion > LLM.")
                else:
                    st.error(f"Error: {error_msg}")
                # Quitar el mensaje del usuario si fallo
                st.session_state.chat_messages.pop()
