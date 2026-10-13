# Gamer Config

El contexto del proyecto está en AGENTS.md, compartido con el resto de agentes (Codex, OpenCode, Cursor…). Mantén ahí cualquier cambio, no lo dupliques aquí.

@AGENTS.md

## Solo para Claude Code

- Responde y escribe la interfaz en español.
- En tareas de código: la solución más simple que funcione, y el código completo, sin "..." ni partes pendientes.
- Antes de hacer commit de algo que toque el cálculo, los parsers o el sistema, pide una segunda revisión (por ejemplo `/code-review`).
- En `.claude/agents/` hay subagentes del proyecto (`revisor-seguridad`, `revisor-codigo`, `depurador`, `qa-electron`, `lanzador`). Úsalos cuando encajen. Todo lo que borre archivos (`cleanup.js`) pasa por `revisor-seguridad`.
