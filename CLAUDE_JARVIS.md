# CLAUDE_JARVIS.md — Jarvis Bridge (PC Remoto via Discord)

> Docs del módulo `src/jarvis.ts`.
> Para el Discord bot ver [CLAUDE_BOT.md](CLAUDE_BOT.md).
> Para overview general ver [CLAUDE.md](CLAUDE.md).

---

## Qué es Jarvis

Jarvis es el puente entre Discord y el PC local. Permite controlar el PC remotamente a través de dos canales privados en la categoría **mypc**, accesibles solo por Rodrigo.

Es similar a OpenClaw: un asistente IA remoto que puede ejecutar código, editar archivos, compilar proyectos, correr comandos y más — todo desde Discord.

---

## Canales Discord

| Canal | Acceso | Propósito |
|-------|--------|-----------|
| `#claudecode` | Solo Rodrigo + bot | Enviar prompts a Claude Code; recibir resultado en embeds |
| `#logspc` | Solo Rodrigo + bot | Log privado con timestamp de cada prompt y resultado |

Los permisos se verifican y corrigen en cada arranque del bot (`initJarvis()`).

---

## Flujo completo: #claudecode

```
Rodrigo escribe en #claudecode
  ↓
handleClaudeCodeMessage()
  ↓ [si es acción peligrosa]
  → Embed de confirmación → espera "si"/"no" (60s) → aborta si no confirma
  ↓ [si es segura o confirmada]
  → Embed "🤖 JARVIS — Procesando..." (inmediato)
  → logToLogspc() con el prompt
  ↓
runClaudeCode(prompt)
  → spawn('claude', ['-p', prompt, '--dangerously-skip-permissions'])
  → cwd: directorio del proyecto
  → timeout: 5 minutos
  ↓ resultado capturado
  → PATCH embed → "✅ JARVIS — Completado" + output + tiempo
  → logToLogspc() con el resultado
```

---

## Detección de acciones peligrosas

`isDangerousPrompt(text)` busca estas palabras clave:

```
delete, remove, rm, drop, uninstall, format, truncate
elimina, borra, borrar, eliminar, desinstala, truncar, formatea
```

Si detecta alguna → el bot pide confirmación antes de ejecutar.
`pendingConfirmation: Set<channelId>` evita que "si"/"no" se procesen como nuevos prompts.

---

## /pc Slash Commands (acceso rápido sin IA)

Los `/pc` commands NO pasan por Claude Code — respuesta inmediata via shell directo.
Solo Rodrigo puede usarlos (verificado por `user.id === RODRIGO_ID`).

### `/pc status`
Muestra estado del sistema usando `wmic`:
- **Disco**: drive, GB libre, GB total por partición
- **RAM**: GB libre / total y % de uso
- **Uptime**: fecha desde que está online (`net stats workstation`)

### `/pc run <cmd>`
Ejecuta el comando en `cmd.exe`. Timeout 30s.
Si contiene palabras peligrosas → pide confirmación "si"/"no" (30s).

### `/pc file <path>`
Lee y muestra el archivo. Acepta rutas absolutas o relativas al proyecto.
Output truncado a 1800 chars — usar #claudecode para archivos grandes.

---

## Logs en #logspc

Cada entrada es un embed con:
- **Color**: azul (prompt) / verde (resultado) / rojo (cancelado) / naranja (/pc run)
- **Título**: acción ejecutada
- **Description**: prompt o output (truncado a 1500 chars)
- **Footer**: timestamp + tiempo de ejecución

---

## Funciones exportadas

| Función | Descripción |
|---------|-------------|
| `initJarvis(botId, cacheChannels, refreshGuildCache)` | Crea/verifica canales mypc/claudecode/logspc |
| `handleClaudeCodeMessage(message)` | Handler del canal #claudecode |
| `getPcSlashCommands()` | Definiciones de /pc para registrar en Discord |
| `handlePcCommand(interaction)` | Handler del slash command /pc |
| `getClaudeCodeChannelId()` | Getter del ID de #claudecode (para bot.ts) |
| `logToLogspc(embed)` | Postea embed a #logspc |
| `runClaudeCode(prompt)` | Spawna `claude -p` y retorna output |
| `isDangerousPrompt(text)` | Detecta keywords destructivos |

---

## Configuración requerida

1. **`claude` en PATH**: Claude Code CLI debe estar instalado y accesible desde terminal
2. **Login previo**: `claude login` debe haber corrido antes (Claude Code guarda auth)
3. **`--dangerously-skip-permissions`**: usado en runClaudeCode para ejecución no-interactiva

---

## Cómo añadir nuevas capacidades a Jarvis

### Nuevo subcomando /pc

1. Agregar definición en `getPcSlashCommands()`:
```typescript
{ type: 1, name: 'nuevo', description: '...', options: [...] }
```

2. Agregar handler en `handlePcCommand()`:
```typescript
if (sub === 'nuevo') {
  // implementación
  await logToLogspc({ ... });
  return;
}
```

### Nueva acción desde #claudecode

Las acciones en #claudecode ya se manejan solas a través de Claude Code — no hace falta código adicional. Claude Code tiene acceso a Bash, Read, Edit, Write, Glob, Grep y más.

Para expandir las capacidades de Claude Code en este contexto, crear un `CLAUDE.md` con contexto específico del proyecto (ya existe) que Claude Code lee automáticamente.

---

## Roadmap (features futuras — no implementadas)

| Feature | Descripción |
|---------|-------------|
| Streaming output | Enviar chunks de output mientras Claude Code trabaja (editar embed progresivamente) |
| `/pc upload <path>` | Subir archivo del PC como attachment a Discord |
| `/pc screenshot` | Captura de pantalla y envío al canal |
| Notificaciones push | Bot avisa en Discord cuando termina un proceso largo en segundo plano |
| Multi-proyecto | `/pc project <nombre>` cambia el cwd entre proyectos configurados |
| Historial de comandos | `#logspc` muestra los últimos N comandos ejecutados con `/pc history` |
