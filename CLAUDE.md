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
- **Discord:** `@discordjs/rest` + `discord-api-types/v10`
- **Config:** `dotenv` → `.env` (nunca commiteado)

## Variables de entorno

```
DISCORD_BOT_TOKEN=<bot token>
DISCORD_GUILD_ID=<server id>
```

Ver `.env.example` para referencia.

## Comandos

```bash
npm run build   # Compila TypeScript → build/
npm run dev     # Compila y ejecuta
npm start       # Ejecuta build/index.js directamente
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
  index.ts     # Punto de entrada único: definición de tools + handlers
build/
  index.js     # Output compilado (gitignoreado)
```

## Convenciones

- Todo el servidor en un solo archivo `src/index.ts` (simple y mantenible)
- Errores retornan `isError: true` con el mensaje de la API de Discord
- Parámetros opcionales usan spread condicional (`...(x !== undefined && { key: x })`)

---

## Changelog

### v2.0.0 — 2026-03-14
- Añadidas 22 herramientas nuevas: permisos de canal, embeds, DMs, edición de mensajes, reacciones, nickname, timeout, voz (mute/deafen/move/voice_state), update_server, emojis, stickers, eventos programados, stage instances
- Total: 49 herramientas

### v1.0.0 — 2026-03-14
- Implementación inicial completa del servidor MCP
- 27 herramientas cubriendo roles, canales, mensajes, miembros, webhooks, threads, invitaciones y audit log
- Configuración de proyecto: TypeScript, ESM, dotenv
- Setup de git + GitHub + Claude Desktop
