# CLAUDE_BOT.md — Discord Gateway Bot

> Docs específicas del bot de Discord (`src/bot.ts`).
> Para el Jarvis/PC bridge ver [CLAUDE_JARVIS.md](CLAUDE_JARVIS.md).
> Para overview general ver [CLAUDE.md](CLAUDE.md).

---

## Arquitectura del bot

`src/bot.ts` importa de:
- `./config.js` — `discordREST`, `botLog`, constantes
- `./jarvis.js` — `initJarvis`, `handleClaudeCodeMessage`, `getPcSlashCommands`, `handlePcCommand`, `getClaudeCodeChannelId`

El bot escucha cuatro tipos de entrada:
1. **@mención** en cualquier canal → chat con Ollama
2. **DM directo** al bot → chat con Ollama
3. **Mensaje en #create** → executor de comandos Discord (Ollama JSON mode)
4. **Mensaje en #claudecode** → delega a `handleClaudeCodeMessage()` en jarvis.ts

---

## Chat con IA (Ollama)

### Modelo
- `qwen3:4b` por defecto, configurable via `OLLAMA_MODEL`
- `think: false` → deshabilita razonamiento interno, respuestas directas siempre
- Timeout 3 min via `AbortSignal.timeout(180_000)` en el cliente Ollama

### Personalidad — modo dual automático

**`isDevChannel(channelId)`** detecta canal técnico por:
- `parent_id === DEV_CATEGORY_ID` (categoría DEV)
- nombre: `mypc`, `coding`, `create`

| Canal | Modo | Personalidad |
|-------|------|-------------|
| General / otros | Casual | Packgod: sarcástico, roasts creativos, sin filtros |
| DEV category / #mypc / #coding | Dev | Conciso, directo, técnico, sin personalidad exagerada |

### Contexto inyectado en cada llamada
1. **Últimos 25 mensajes del canal** del día (excluyendo bot, máx 12)
2. **Mensaje referenciado** (reply/forward) → incluido al inicio del prompt

### Historial de conversación
- Archivo: `data/memory.json` (gitignoreado, persiste entre reinicios)
- Máximo 10 pares (20 entradas) por canal
- Clave: `channelId` para canales, `dm_userId` para DMs

### Cooldown
- 3 segundos entre respuestas por usuario
- En cooldown → reacciona con ⏳

---

## Canal #create — Executor de comandos Discord

- Ubicado en categoría DEV (`1482437015562752093`)
- Permisos: solo Rodrigo + bot pueden ver/escribir
- Cualquier mensaje → `interpretCommand()` (Ollama JSON mode, temperatura 0.1) → `executeActions()`

### Acciones disponibles (13 tipos)

| Acción | Descripción |
|--------|-------------|
| `create_role` / `delete_role` | Crear/eliminar rol con color y permisos |
| `assign_role` / `remove_role` | Dar/quitar rol a usuario |
| `ban_member` / `kick_member` / `unban_member` | Moderación |
| `timeout_member` | Silenciar X minutos (0 = quitar timeout) |
| `set_nickname` | Cambiar nickname |
| `create_channel` / `delete_channel` | Canales de texto |
| `create_category` | Categorías |
| `send_message` | Enviar mensaje a canal específico |

### Guild cache
- Carga al arrancar: miembros, roles, canales (hasta 1000 de cada uno)
- Refresh automático cada 5 minutos
- Refresh después de cada ejecución de acción
- Incluido en system prompt de `commandPrompt()` para resolver nombres → IDs

---

## Música — Slash commands

| Comando | Descripción |
|---------|-------------|
| `/music <query>` | URL YouTube, búsqueda texto, URL Spotify |
| `/stop` | Detiene y desconecta |
| `/skip` | Salta al siguiente |
| `/queue` | Muestra cola actual |

### Streaming architecture

```
/music query
  → resolveTrack():
      Spotify URL  → open.spotify.com/oembed → título → ytdlpSearch()
      YouTube URL  → strip params → yt-dlp --print info
      Texto libre  → yt-dlp ytsearch1:query
  → playTrack():
      spawn yt-dlp -f bestaudio -o - --js-runtimes node
      → pipe stdout → createAudioResource → @discordjs/voice → Discord
```

**Binario yt-dlp:** `node_modules/youtube-dl-exec/bin/yt-dlp.exe`

**`isYtdlpNoise()`**: filtra mensajes esperados de stderr (Broken pipe, Invalid argument, etc.)

### Estado de reproducción
- `players: Map<guildId, GuildPlayer>` — un player por servidor
- `GuildPlayer`: `{ connection, player, queue, current, textChannelId }`
- Auto-desconexión tras 3 min de inactividad sin cola

---

## Sistema de logs

- Archivo: `logs/bot.md` (gitignoreado, append automático)
- Función: `botLog(level, msg)` — también a stdout
- Niveles: `INFO`, `CMD`, `ERROR`, `MUSIC`, `CLAUDE`

Para diagnosticar errores: leer `logs/bot.md` ANTES de proponer fix.

---

## Intents requeridos (Privileged — activar en Dev Portal)

- ✅ Server Members Intent
- ✅ Message Content Intent
- ✅ Guild Voice States

---

## Slash commands registrados

```typescript
PUT /applications/{appId}/guilds/{GUILD_ID}/commands
```

En cada `ClientReady`. Los /pc commands vienen de `getPcSlashCommands()` en jarvis.ts.

Total comandos: `/music`, `/stop`, `/skip`, `/queue`, `/help`, `/pc` (3 subcomandos)

---

## Configuración Claude Desktop (MCP Server)

```json
{
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
