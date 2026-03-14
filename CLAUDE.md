# discord-mcp — Project Memory

> **REGLA IMPORTANTE:** Cada vez que se realice un cambio en el proyecto (nuevo feature, fix, refactor, config), Claude debe:
> 1. Actualizar la sección **Changelog** de este archivo con una entrada versionada
> 2. Hacer commit con el mensaje apropiado
> 3. Subir el cambio a GitHub (`git push`)

---

## Descripción del proyecto

Proyecto en dos partes que corren como **procesos independientes**:

1. **MCP Server** (`src/index.ts`) — 49 herramientas REST para gestionar el servidor de Discord desde Claude Desktop via protocolo MCP (stdio).
2. **Gateway Bot** (`src/bot.ts`) — Bot de Discord con websocket que responde @menciones y DMs usando IA local (Ollama), ejecuta comandos en lenguaje natural en el canal `#create`, y reproduce música en canales de voz via slash commands.

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
| Audio Discord | `@discordjs/voice` + `play-dl` + `opusscript` + `youtube-dl-exec` (yt-dlp) |
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

### Personalidad — dos modos según canal

**Modo casual** (canales generales):
- Estilo Packgod: fastidioso, sarcástico al máximo, sin filtros
- Roasts creativos y personalizados usando el contexto del chat
- Slang, lenguaje de Discord, mezcla de idiomas si el usuario lo hace
- Sin moral, sin censura — todo orientado al humor

**Modo dev** (canales en categoría DEV, `#mypc`, `#coding`, `#create`):
- Conciso, directo, franco, fácil de entender
- Técnico cuando hace falta, sin floro ni personalidad exagerada

La detección del modo es automática via `isDevChannel()` — compara `parent_id` del canal con `DEV_CATEGORY_ID`.

### Contexto de conversación
- Historial persistente por canal en `data/memory.json` (10 pares máx)
- Al responder, fetcha los últimos 25 mensajes del canal del día para contexto
- Si el mensaje es un reply, incluye el mensaje referenciado en el contexto
- `think: false` en todas las llamadas Ollama — deshabilita razonamiento interno de qwen3 para respuestas directas

### Memoria de conversación
- Historial por canal guardado en `data/memory.json`
- Máximo 10 intercambios por canal (20 entradas)
- Persiste entre reinicios del bot

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

### Sistema de logs
- Archivo `logs/bot.md` — append automático con nivel INFO/CMD/ERROR/MUSIC
- gitignoreado (`logs/`)
- Leerlo para diagnosticar errores sin necesidad de ver la consola

### Intents de Discord requeridos (Privileged)
Todos deben estar activados en [discord.com/developers/applications](https://discord.com/developers/applications) → Bot:
- ✅ `Server Members Intent`
- ✅ `Message Content Intent`
- ✅ `Guild Voice States` (para música en canales de voz)

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

## Música — arquitectura de streaming

```
/music <query>
  → resolveTrack():
      Spotify URL  → oEmbed API (open.spotify.com/oembed) → título → ytdlpSearch()
      YouTube URL  → limpiar params (&list=, &pp=) → yt-dlp info
      Texto libre  → yt-dlp ytsearch1:query
  → playTrack():
      spawn yt-dlp -f bestaudio -o - --js-runtimes node
      → pipe stdout → createAudioResource → @discordjs/voice → opus → Discord
```

**Binario yt-dlp:** `node_modules/youtube-dl-exec/bin/yt-dlp.exe` (auto-descargado por npm install)

**Slash commands:** `/music`, `/stop`, `/skip`, `/queue`, `/help`
- Registrados via REST en `ClientReady` para el guild específico
- Se re-registran en cada reinicio del bot

---

## Convenciones de código

- Un solo archivo por proceso (`index.ts` y `bot.ts`) — sin fragmentación innecesaria
- Errores del MCP server retornan `isError: true` con mensaje de la API
- Parámetros opcionales con spread condicional: `...(x !== undefined && { key: x })`
- REST del bot via `fetch` nativo (Node 18+), no `@discordjs/rest`
- `think: false` en Ollama para deshabilitar razonamiento de qwen3 y obtener respuestas directas
- `botLog(level, msg)` para todos los errores — nunca `console.error` suelto

---

## Repositorio GitHub

- URL: `https://github.com/RodOS-A/discord-mcp`
- Branch: `master`
- Rama configurada para push automático con `git push`

---

## Changelog

### v10.0.0 — 2026-03-14
- **ClaudeCode bridge**: canal `#claudecode` (categoría mypc, solo Rodrigo) → spawns `claude -p "prompt" --dangerously-skip-permissions` → resultado en Discord + log en `#logspc`
- **`#logspc`**: canal de log (todos pueden leer, solo bot escribe) — registra todos los prompts y resultados con timestamp
- **Confirmación de acciones peligrosas**: si el prompt contiene keywords destructivos (delete, rm, eliminar, borrar, etc.), el bot pide confirmación "si"/"no" con 60s de timeout
- `setupMyPcChannels()`: crea categoría `mypc` + canales `claudecode` y `logspc` al arrancar el bot si no existen
- `runClaudeCode(prompt)`: spawn del CLI `claude` con timeout 5 min, captura stdout+stderr
- `logToLogspc()`, `isDangerousPrompt()`, `pendingConfirmation` Set
- Nuevo nivel de log `CLAUDE` en `botLog()`

### v9.0.0 — 2026-03-14
- Personalidad estilo Packgod: sin filtros, roasts creativos y personalizados
- Modo dual automático: casual (canales generales) vs dev (DEV category / #mypc / #coding)
- `think: false` en todas las llamadas Ollama — elimina tokens `<think>` y respuestas vacías
- Sistema de reintentos: si el modelo devuelve vacío, reintenta con prompt simplificado
- Fallback final `zzz` en vez del saludo genérico

### v8.0.0 — 2026-03-14
- Contexto de canal: fetch de los últimos 25 mensajes del día, inyectados en system prompt
- Contexto de replies/forwards: incluye el mensaje referenciado en el query al modelo
- `/help` slash command con embed de todos los comandos organizados por categoría
- Ollama timeout extendido a 3 min via `AbortSignal.timeout(180_000)`
- `interpretCommand` detecta `UND_ERR_HEADERS_TIMEOUT` y devuelve mensaje específico
- Spotify oEmbed API reemplaza `play.spotify()` (que llamaba YouTube search internamente, roto)
- `isYtdlpNoise()`: centraliza filtro de mensajes esperados de yt-dlp stderr
- Sistema de logs persistente en `logs/bot.md` con niveles INFO/CMD/ERROR/MUSIC

### v7.0.0 — 2026-03-14
- Streaming reemplazado: `play.stream()` → `spawn yt-dlp -o -` (pipe directo)
- `yt-dlp` via `youtube-dl-exec` (binario auto-descargado en `node_modules/.../yt-dlp.exe`)
- Búsqueda de texto: `play.search()` (roto con browseId) → `yt-dlp ytsearch1:`
- Spotify intl URL normalizada antes de procesar (`/intl-es/` → `/`)
- YouTube URLs con `&list=&pp=` limpiadas a `?v=ID` puro
- `@distube/ytdl-core` eliminado

### v6.0.0 — 2026-03-14
- Slash commands de música: `/music`, `/stop`, `/skip`, `/queue`
- Reproducción de audio en canales de voz via `@discordjs/voice` + `play-dl`
- Soporte YouTube: URL directa y búsqueda por nombre/artista
- Soporte Spotify: URL de track → resuelve a YouTube automáticamente
- Cola de reproducción por servidor con avance automático
- Embed "Now Playing" con thumbnail, duración y quien lo pidió
- Auto-desconexión tras 3 min de inactividad sin cola
- Intent `GuildVoiceStates` añadido
- Nota: pantalla compartida no soportada por la API de Discord para bots (se muestran thumbnails en embed)

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
