# discord-mcp — Project Memory

> **REGLA IMPORTANTE:** Cada vez que se realice un cambio en el proyecto (nuevo feature, fix, refactor, config), Claude debe:
> 1. Actualizar la sección **Changelog** de este archivo con una entrada versionada
> 2. Hacer commit con el mensaje apropiado
> 3. Subir el cambio a GitHub (`git push`)

---

## Descripción

Servidor MCP para gestionar un servidor de Discord desde Claude Desktop.
Usa la REST API de Discord a través de `@discordjs/rest` y se conecta via stdio al protocolo MCP.

## Stack

- **Runtime:** Node.js (ESM)
- **Lenguaje:** TypeScript
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **Discord REST:** `@discordjs/rest` + `discord-api-types/v10`
- **Discord Gateway:** `discord.js` v14 (bot con websocket)
- **IA:** `ollama` (local, sin API key) → `qwen3:4b` por defecto
- **Memoria:** `data/memory.json` (persistente entre reinicios, gitignoreado)
- **Config:** `dotenv` → `.env` (nunca commiteado)

## Variables de entorno

```
DISCORD_BOT_TOKEN=<bot token>
DISCORD_GUILD_ID=<server id>
OLLAMA_MODEL=qwen3:4b          # opcional, default: qwen3:4b
OLLAMA_HOST=http://localhost:11434  # opcional, default: localhost
```

Ver `.env.example` para referencia.

## Comandos

```bash
npm run build       # Compila TypeScript → build/
npm start           # Ejecuta MCP server (para Claude Desktop)
npm run start:bot   # Ejecuta bot Gateway (responde @menciones con Claude IA)
npm run dev         # Compila y ejecuta MCP server
npm run dev:bot     # Compila y ejecuta bot Gateway
```

## Configuración en Claude Desktop

`%APPDATA%/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "discord-mcp": {
      "command": "node",
      "args": ["C:/Users/rodbl/OneDrive/Documentos/tests/discord-mcp/build/index.js"]
    }
  }
}
```

## Herramientas implementadas

| Categoría | Herramientas |
|-----------|-------------|
| Roles | list_roles, create_role, update_role, delete_role, assign_role, remove_role |
| Canales | list_channels, create_channel, update_channel, delete_channel |
| Permisos de canal | get_channel_permissions, set_channel_permission, delete_channel_permission |
| Categorías | create_category |
| Mensajes | send_message, send_embed, send_dm, edit_message, fetch_messages, delete_message, pin_message |
| Reacciones | add_reaction, remove_reaction, get_reactions |
| Miembros | list_members, get_member_info, set_nickname, timeout_member, move_member_voice, mute_member, deafen_member, get_voice_state, kick_member, ban_member, unban_member |
| Servidor | get_server_info, update_server |
| Emojis | list_emojis, create_emoji, update_emoji, delete_emoji |
| Stickers | list_stickers, update_sticker, delete_sticker |
| Eventos | list_events, create_event, update_event, delete_event |
| Stage | create_stage, update_stage, delete_stage |
| Webhooks | list_webhooks, create_webhook, delete_webhook |
| Threads | list_active_threads, create_thread |
| Invitaciones | list_invites, create_invite, delete_invite |
| Auditoría | get_audit_log |

## Arquitectura

```
src/
  index.ts   # MCP server — 49 herramientas para gestión desde Claude Desktop
  bot.ts     # Gateway bot — responde @menciones usando Claude API (claude-sonnet-4-6)
build/
  index.js   # Output compilado (gitignoreado)
  bot.js
```

Los dos procesos son independientes. El MCP server (`index.ts`) usa stdio y no necesita Gateway.
El bot Gateway (`bot.ts`) requiere `MESSAGE_CONTENT` intent habilitado en Discord Developer Portal.

## Convenciones

- Todo el servidor en un solo archivo `src/index.ts` (simple y mantenible)
- Errores retornan `isError: true` con el mensaje de la API de Discord
- Parámetros opcionales usan spread condicional (`...(x !== undefined && { key: x })`)

---

## Changelog

### v4.0.0 — 2026-03-14
- Reemplazado Anthropic API por Ollama (local, gratuito, sin API key)
- Modelo por defecto: `qwen3:4b` (configurable via `OLLAMA_MODEL`)
- Memoria persistente en `data/memory.json` (sobrevive reinicios del bot)
- Strip automático de tokens `<think>...</think>` de qwen3
- Eliminada dependencia `@anthropic-ai/sdk`, añadida `ollama`

### v3.0.0 — 2026-03-14
- Nuevo `src/bot.ts`: bot Gateway con discord.js v14
- Responde a @menciones con IA real (claude-sonnet-4-6 via Anthropic API)
- Responde a DMs directamente
- Historial de conversación por canal (últimos 10 intercambios)
- Cooldown de 3s por usuario
- Mensajes largos divididos automáticamente (límite 2000 chars de Discord)
- Nueva variable de entorno: `ANTHROPIC_API_KEY`

### v2.0.0 — 2026-03-14
- Añadidas 22 herramientas nuevas: permisos de canal, embeds, DMs, edición de mensajes, reacciones, nickname, timeout, voz (mute/deafen/move/voice_state), update_server, emojis, stickers, eventos programados, stage instances
- Total: 49 herramientas

### v1.0.0 — 2026-03-14
- Implementación inicial completa del servidor MCP
- 27 herramientas cubriendo roles, canales, mensajes, miembros, webhooks, threads, invitaciones y audit log
- Configuración de proyecto: TypeScript, ESM, dotenv
- Setup de git + GitHub + Claude Desktop
