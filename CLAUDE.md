# discord-mcp — Overview General

> **REGLA:** Cada cambio en el proyecto → actualizar Changelog → commit → `git push`.
>
> **Docs detalladas por módulo:**
> - [CLAUDE_BOT.md](CLAUDE_BOT.md) — Bot de Discord: música, chat, #create, personalidad
> - [CLAUDE_JARVIS.md](CLAUDE_JARVIS.md) — Jarvis: #claudecode, /pc, logspc, arquitectura

---

## Qué es este proyecto

Tres sistemas que corren desde el mismo repo:

| Sistema | Archivo | Comando | Descripción |
|---------|---------|---------|-------------|
| MCP Server | `src/index.ts` | `npm start` | 49 herramientas REST para Claude Desktop via stdio |
| Gateway Bot | `src/bot.ts` | `npm run start:bot` | Bot Discord: chat IA, música, admin, Jarvis |
| Config compartida | `src/config.ts` | — | constantes, discordREST, botLog |
| Jarvis bridge | `src/jarvis.ts` | — | #claudecode → Claude Code CLI → PC |

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Runtime | Node.js v24 (ESM modules) |
| Lenguaje | TypeScript 5.5 |
| MCP | `@modelcontextprotocol/sdk` v1.10 |
| Discord REST | `fetch` nativo (Node 18+) |
| Discord Gateway | `discord.js` v14.25 |
| IA local | `ollama` v0.6.3 → `qwen3:4b` |
| Audio | `@discordjs/voice` + `youtube-dl-exec` (yt-dlp) |
| Config | `dotenv` → `.env` (nunca commiteado) |

---

## Variables de entorno

```
DISCORD_BOT_TOKEN=<token>     # requerido
DISCORD_GUILD_ID=<ID guild>   # requerido
OLLAMA_MODEL=qwen3:4b         # opcional
OLLAMA_HOST=http://localhost:11434  # opcional
```

---

## IDs importantes del servidor PDPI

| Entidad | ID |
|---------|----|
| Servidor (PDPI) | `1482410402850668575` |
| @everyone role | `1482410402850668575` |
| Bot (KIA v1) | `1482414582579466240` |
| Bot role (BOT1) | `1482415879449870451` |
| Rodrigo (owner) | `998386333896687756` |
| Canal #coding | `1482425745660841986` |
| Categoría DEV | `1482437015562752093` |

---

## Comandos

```bash
npm run build       # Compila TypeScript → build/
npm start           # MCP server (para Claude Desktop)
npm run start:bot   # Gateway bot (requiere Ollama corriendo)
npm run dev         # Compila + MCP server
npm run dev:bot     # Compila + Gateway bot
```

---

## Arquitectura de archivos

```
discord-mcp/
├── src/
│   ├── config.ts       # Constantes, botLog, discordREST — importado por bot y jarvis
│   ├── bot.ts          # Gateway bot — Ollama chat, música, #create, orquesta jarvis
│   ├── jarvis.ts       # Jarvis bridge — #claudecode, /pc commands, logspc
│   └── index.ts        # MCP server — 49 tools, stdio transport
├── build/              # Compilado (gitignoreado)
├── data/               # memory.json — historial Ollama por canal (gitignoreado)
├── logs/               # bot.md — log persistente del bot (gitignoreado)
├── .env                # Credenciales reales (gitignoreado)
├── CLAUDE.md           # Este archivo — overview general
├── CLAUDE_BOT.md       # Docs del Discord bot
└── CLAUDE_JARVIS.md    # Docs del Jarvis bridge
```

---

## Changelog

### v11.0.0 — 2026-03-14
- **Refactor arquitectura**: extraído `src/config.ts` (constantes + discordREST + botLog) y `src/jarvis.ts` (Jarvis bridge completo) de `bot.ts`
- **Fix #logspc privado**: permisos corregidos → solo Rodrigo + bot pueden ver el canal; se patchean en cada arranque del bot
- **UX Jarvis mejorada**: respuestas en embeds estructurados (procesando → completado con tiempo de ejecución)
- **`/pc` slash commands**: `/pc status` (disco/RAM/uptime), `/pc run <cmd>` (shell directo), `/pc file <path>` (leer archivo)
- **`/help` actualizado**: incluye sección de PC Remoto / Jarvis
- **3 CLAUDE.md files**: CLAUDE.md (overview), CLAUDE_BOT.md (bot), CLAUDE_JARVIS.md (jarvis)

### v10.0.0 — 2026-03-14
- ClaudeCode bridge: #claudecode → claude -p → resultado en Discord + log en #logspc
- #logspc para auditoría de acciones (privacidad corregida en v11)
- Confirmación para acciones peligrosas (delete/rm/eliminar/etc.)
- setupMyPcChannels() crea categoría mypc + canales al arrancar

### v9.0.0 — 2026-03-14
- Personalidad estilo Packgod: sin filtros, roasts creativos
- Modo dual: casual (general) vs dev (DEV category / #mypc / #coding)
- `think: false` en todas las llamadas Ollama
- Sistema de reintentos para respuestas vacías

### v8.0.0 — 2026-03-14
- Contexto canal: fetch últimos 25 mensajes del día
- Contexto replies/forwards
- `/help` slash command
- Ollama timeout 3 min, Spotify oEmbed API, logs persistentes `logs/bot.md`

### v7.0.0 — 2026-03-14
- Streaming: `play.stream()` → `spawn yt-dlp -o -` (pipe directo)
- Búsqueda: `play.search()` → `yt-dlp ytsearch1:`
- Spotify intl URL normalizada, YouTube params limpios

### v6.0.0 — 2026-03-14
- Slash commands música: `/music`, `/stop`, `/skip`, `/queue`
- `@discordjs/voice` + play-dl + yt-dlp

### v5.0.0 — 2026-03-14
- Personalidad, guild cache, canal #create con ejecutor de comandos (13 acciones)

### v4.0.0 — 2026-03-14
- Anthropic API → Ollama local (qwen3:4b), memoria persistente

### v1–3 — 2026-03-14
- MCP server (49 tools), Gateway bot inicial, historial por canal
