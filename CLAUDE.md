# discord-mcp — Project Memory

> **REGLA IMPORTANTE:** Cada vez que se realice un cambio en el proyecto (nuevo feature, fix, refactor, config), Claude debe:
> 1. Actualizar la sección **Changelog** de este archivo con una entrada versionada
> 2. Hacer commit con el mensaje apropiado
> 3. Subir el cambio a GitHub (`git push`)

---

## Descripción del proyecto

Proyecto en dos partes que corren como **procesos independientes**:

1. **MCP Server** (`src/index.ts`) — 49 herramientas REST para gestionar el servidor de Discord desde Claude Desktop via protocolo MCP (stdio).
2. **Gateway Bot** (`src/bot.ts`) — Bot de Discord con websocket que responde @menciones y DMs usando IA local (Ollama), y ejecuta comandos en lenguaje natural en el canal `#create`.

---

## Stack completo

| Capa | Tecnología |
|------|-----------|
| Runtime | Node.js v24 (ESM modules) |
| Lenguaje | TypeScript 5.5 |
| MCP | `@modelcontextprotocol/sdk` v1.10 |
| Discord REST | `@discordjs/rest` v2.4 + `discord-api-types/v10` |
| Discord Gateway | `discord.js` v14.25 |
| IA local | `ollama` v0.6.3 → modelo `qwen3:4b` por defecto |
| Memoria bot | `data/memory.json` (persistente entre reinicios) |
| Config | `dotenv` → archivo `.env` (nunca commiteado) |

---

## Variables de entorno

```
DISCORD_BOT_TOKEN=<token del bot>       # requerido
DISCORD_GUILD_ID=<ID del servidor>      # requerido
OLLAMA_MODEL=qwen3:4b                   # opcional, default: qwen3:4b
OLLAMA_HOST=http://localhost:11434      # opcional, default: localhost
```

**Nota:** `ANTHROPIC_API_KEY` fue eliminada en v4.0.0. El bot usa Ollama localmente, sin costos.

---

## IDs importantes del servidor

| Entidad | ID |
|---------|----|
| Servidor (PDPI) | `1482410402850668575` |
| @everyone role | `1482410402850668575` (igual que guild ID) |
| Bot (KIA v1) | `1482414582579466240` |
| Bot role (BOT1) | `1482415879449870451` |
| Rodrigo (owner) | `998386333896687756` |
| Canal #coding | `1482425745660841986` |
| Categoría DEV | `1482437015562752093` |

---

## Comandos

```bash
npm run build       # Compila TypeScript → build/
npm start           # Lanza MCP server (para Claude Desktop)
npm run start:bot   # Lanza Gateway bot (requiere Ollama corriendo)
npm run dev         # Compila + lanza MCP server
npm run dev:bot     # Compila + lanza Gateway bot
```

Para lanzar el bot: Ollama ya corre como servicio en background (puerto 11434).
Solo ejecutar `npm run start:bot` desde el directorio del proyecto.

---

## Configuración Claude Desktop

Archivo: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "preferences": { ... },
  "mcpServers": {
    "discord-mcp": {
      "command": "node",
      "args": ["C:/Users/rodbl/OneDrive/Documentos/tests/discord-mcp/build/index.js"],
      "env": {
        "DISCORD_BOT_TOKEN": "<token>",
        "DISCORD_GUILD_ID": "1482410402850668575"
      }
    }
  }
}
```

**Importante:** las variables de entorno van en el `env` del config porque Claude Desktop no carga el `.env` automáticamente.

---

## Arquitectura

```
discord-mcp/
├── src/
│   ├── index.ts        # MCP server — 49 tools, stdio transport
│   └── bot.ts          # Gateway bot — Ollama + #create executor
├── build/
│   ├── index.js        # Compilado (gitignoreado)
│   └── bot.js
├── data/
│   └── memory.json     # Historial de conversación por canal (gitignoreado)
├── .env                # Credenciales reales (gitignoreado)
├── .env.example        # Plantilla pública
├── CLAUDE.md           # Este archivo
├── package.json
└── tsconfig.json
```

---

## MCP Server — 49 herramientas (`src/index.ts`)

| Categoría | Herramientas |
|-----------|-------------|
| Roles | `list_roles`, `create_role`, `update_role`, `delete_role`, `assign_role`, `remove_role` |
| Canales | `list_channels`, `create_channel`, `update_channel`, `delete_channel` |
| Permisos de canal | `get_channel_permissions`, `set_channel_permission`, `delete_channel_permission` |
| Categorías | `create_category` |
| Mensajes | `send_message`, `send_embed`, `send_dm`, `edit_message`, `fetch_messages`, `delete_message`, `pin_message` |
| Reacciones | `add_reaction`, `remove_reaction`, `get_reactions` |
| Miembros | `list_members`, `get_member_info`, `set_nickname`, `timeout_member`, `move_member_voice`, `mute_member`, `deafen_member`, `get_voice_state`, `kick_member`, `ban_member`, `unban_member` |
| Servidor | `get_server_info`, `update_server` |
| Emojis | `list_emojis`, `create_emoji`, `update_emoji`, `delete_emoji` |
| Stickers | `list_stickers`, `update_sticker`, `delete_sticker` |
| Eventos | `list_events`, `create_event`, `update_event`, `delete_event` |
| Stage | `create_stage`, `update_stage`, `delete_stage` |
| Webhooks | `list_webhooks`, `create_webhook`, `delete_webhook` |
| Threads | `list_active_threads`, `create_thread` |
| Invitaciones | `list_invites`, `create_invite`, `delete_invite` |
| Auditoría | `get_audit_log` |

---

## Gateway Bot — `src/bot.ts`

### Cómo funciona

El bot escucha tres tipos de eventos:

1. **@mención en cualquier canal** → responde usando Ollama (chat con personalidad)
2. **DM directo al bot** → responde usando Ollama
3. **Cualquier mensaje en `#create`** → interpreta como comando Discord y lo ejecuta

### Personalidad
- Se llama a sí mismo con el nombre de usuario del bot en Discord (detectado dinámicamente)
- Directo, inteligente, sarcástico amistoso
- Habla en el idioma del usuario (español/inglés)
- Nunca se identifica como IA — es el bot del servidor

### Memoria de conversación
- Historial por canal guardado en `data/memory.json`
- Máximo 10 intercambios por canal (20 entradas)
- Persiste entre reinicios del bot
- Los tokens `<think>` de qwen3 se eliminan ANTES de guardar en historial

### Cooldown
- 3 segundos entre respuestas por usuario
- Si está en cooldown reacciona con ⏳

### Canal `#create`
- Se crea automáticamente al iniciar el bot si no existe
- Ubicado en la categoría DEV (ID: `1482437015562752093`)
- Permisos: solo Rodrigo y el bot pueden ver/escribir
- Cualquier mensaje ahí → Ollama interpreta con `format: 'json'` y temperatura 0.1
- El bot ejecuta directamente contra la Discord REST API

**Acciones soportadas en #create:**
`create_role`, `delete_role`, `ban_member`, `kick_member`, `unban_member`, `timeout_member`, `assign_role`, `remove_role`, `set_nickname`, `create_channel`, `delete_channel`, `create_category`, `send_message`

### Guild cache
- Al iniciar: carga miembros (hasta 1000), roles y canales en Maps en memoria
- Se refresca cada 5 minutos automáticamente
- Se refresca después de cada ejecución de acción en `#create`
- El cache se incluye en el system prompt del ejecutor de comandos para que el modelo resuelva nombres → IDs

### Intents de Discord requeridos (Privileged)
Ambos deben estar activados en [discord.com/developers/applications](https://discord.com/developers/applications) → Bot:
- ✅ `Server Members Intent`
- ✅ `Message Content Intent`

---

## Estado actual del servidor Discord

### Canal `#coding`
- **Ubicación:** categoría DEV
- **Permisos:** @everyone deny (VIEW+SEND+READ_HISTORY), Rodrigo allow, Bot allow
- **Permission bits usados:** `68608` = VIEW_CHANNEL(1024) + SEND_MESSAGES(2048) + READ_MESSAGE_HISTORY(65536)
- **Mensaje de bienvenida:** enviado y pineado

### Bot nickname
- Nickname en el servidor: `Claude` (cambiado via REST API en sesión 2026-03-14)
- Username real en Discord: `KIA v1` (o el que tenga configurado en Dev Portal)

### Canal `#create`
- Ubicado en categoría DEV
- Solo accesible por Rodrigo y el bot
- Creado automáticamente por el bot al arrancar

---

## Convenciones de código

- Un solo archivo por proceso (`index.ts` y `bot.ts`) — sin fragmentación innecesaria
- Errores del MCP server retornan `isError: true` con mensaje de la API
- Parámetros opcionales con spread condicional: `...(x !== undefined && { key: x })`
- REST del bot via `fetch` nativo (Node 18+), no `@discordjs/rest`
- Tokens `<think>` se stripean antes de guardar en historial y antes de enviar a Discord

---

## Repositorio GitHub

- URL: `https://github.com/RodOS-A/discord-mcp`
- Branch: `master`
- Rama configurada para push automático con `git push`

---

## Changelog

### v5.0.0 — 2026-03-14
- Personalidad real: directa, sarcástica, habla como persona en Discord
- Guild cache: miembros, roles y canales cargados al inicio y cada 5 min
- Nombre del bot detectado dinámicamente (`c.user.username`)
- Canal `#create` creado automáticamente bajo DEV con permisos Rodrigo+bot
- Ejecutor de comandos en lenguaje natural → acciones Discord (13 tipos de acción)
- Ollama en modo `format: 'json'` con temperatura 0.1 para comandos
- Intento privilegiado `GuildMembers` añadido

### v4.0.0 — 2026-03-14
- Reemplazado Anthropic API (`claude-sonnet-4-6`) por Ollama local (gratis, sin API key)
- Modelo por defecto: `qwen3:4b` (configurable via `OLLAMA_MODEL`)
- URL Ollama configurable via `OLLAMA_HOST`
- Memoria persistente en `data/memory.json` (sobrevive reinicios)
- Strip automático de tokens `<think>...</think>` de qwen3
- Eliminada dependencia `@anthropic-ai/sdk`, añadida `ollama`
- Eliminada variable `ANTHROPIC_API_KEY`

### fix — 2026-03-14
- Fallback `'¿En qué puedo ayudarte?'` cuando Ollama devuelve respuesta vacía tras strip de `<think>`

### v3.0.0 — 2026-03-14
- Nuevo `src/bot.ts`: bot Gateway con discord.js v14
- Responde @menciones con Anthropic API (`claude-sonnet-4-6`)
- Responde DMs directamente
- Historial de conversación por canal (10 pares máx)
- Cooldown 3s por usuario, typing indicator, split de mensajes largos

### v2.0.0 — 2026-03-14
- 22 herramientas nuevas en MCP server: permisos de canal, send_embed, send_dm,
  edit_message, reacciones, set_nickname, timeout_member, voz (mute/deafen/move/voice_state),
  update_server, emojis CRUD, stickers (list/update/delete), eventos programados CRUD,
  stage instances CRUD
- Total: 49 herramientas en `src/index.ts`

### v1.0.0 — 2026-03-14
- MCP server inicial con 27 herramientas
- Stack: TypeScript ESM, `@discordjs/rest`, `@modelcontextprotocol/sdk`, `dotenv`
- Setup completo: git, GitHub (RodOS-A/discord-mcp), Claude Desktop config
- `.env` con credenciales reales, `.gitignore` protegiendo secretos

---

## Acciones ejecutadas directamente via REST API (fuera del código)

Las siguientes acciones se realizaron manualmente via `node --input-type=module` con fetch durante la sesión:

1. **Permission overwrites en `#coding`** (2026-03-14):
   - @everyone: deny `68608` (VIEW+SEND+READ_HISTORY)
   - Rodrigo: allow `68608`
   - Bot: allow `68608`

2. **Nickname del bot → "Claude"** (2026-03-14):
   - `PATCH /guilds/{id}/members/@me` con `{ nick: "Claude" }`

3. **Categoría DEV creada** (ID: `1482437015562752093`)

4. **Canal `#coding` movido a DEV**

5. **Embed de bienvenida enviado y pineado en `#coding`**
