import { Client, GatewayIntentBits, Events, Message, type GuildMember } from 'discord.js';
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, type VoiceConnection, type AudioPlayer,
} from '@discordjs/voice';
import play from 'play-dl';
import { spawn } from 'child_process';
import { Ollama } from 'ollama';
import fs from 'fs';
import path from 'path';

import {
  BOT_TOKEN, GUILD_ID, RODRIGO_ID, DEV_CATEGORY_ID, BITS_FULL,
  OLLAMA_MODEL, OLLAMA_HOST, botLog, discordREST,
} from './config.js';

// ─── Clients ──────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,      // Privileged — enable in Dev Portal
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,    // Privileged — enable in Dev Portal
    GatewayIntentBits.DirectMessages,
  ],
});

// Ollama con timeout extendido a 3 min
const ollamaFetch: typeof globalThis.fetch = (input, init) =>
  globalThis.fetch(input, { ...(init as any), signal: AbortSignal.timeout(180_000) });

const ollama = new Ollama({ host: OLLAMA_HOST, fetch: ollamaFetch as any });

// ─── Guild cache ──────────────────────────────────────────────────────────────

interface MemberInfo  { id: string; username: string; displayName: string }
interface RoleInfo    { id: string; name: string; color: number }
interface ChannelInfo { id: string; name: string; type: number; parent_id?: string }

const cacheMembers  = new Map<string, MemberInfo>();
const cacheRoles    = new Map<string, RoleInfo>();
const cacheChannels = new Map<string, ChannelInfo>();

async function refreshGuildCache(): Promise<void> {
  try {
    const [members, roles, channels] = await Promise.all([
      discordREST('GET', `/guilds/${GUILD_ID}/members?limit=1000`),
      discordREST('GET', `/guilds/${GUILD_ID}/roles`),
      discordREST('GET', `/guilds/${GUILD_ID}/channels`),
    ]);

    cacheMembers.clear();
    for (const m of (members as any[])) {
      const info: MemberInfo = {
        id: m.user.id,
        username: m.user.username,
        displayName: m.nick ?? m.user.global_name ?? m.user.username,
      };
      cacheMembers.set(m.user.username.toLowerCase(), info);
      if (m.nick) cacheMembers.set(m.nick.toLowerCase(), info);
    }

    cacheRoles.clear();
    for (const r of (roles as any[]).filter((r: any) => r.name !== '@everyone')) {
      cacheRoles.set(r.name.toLowerCase(), { id: r.id, name: r.name, color: r.color });
    }

    cacheChannels.clear();
    for (const c of (channels as any[])) {
      cacheChannels.set(c.name.toLowerCase(), { id: c.id, name: c.name, type: c.type, parent_id: c.parent_id });
    }

    console.log(`Cache: ${cacheMembers.size / 2 | 0} miembros, ${cacheRoles.size} roles, ${cacheChannels.size} canales`);
  } catch (err) {
    console.error('Cache refresh error:', err);
  }
}

// ─── Persistent memory (per channel) ─────────────────────────────────────────

type HistoryEntry = { role: 'user' | 'assistant'; content: string };

const MEMORY_FILE       = path.join(process.cwd(), 'data', 'memory.json');
const MAX_HISTORY_PAIRS = 10;

function loadMemory(): Map<string, HistoryEntry[]> {
  try {
    const raw = fs.readFileSync(MEMORY_FILE, 'utf-8');
    return new Map(Object.entries(JSON.parse(raw) as Record<string, HistoryEntry[]>));
  } catch { return new Map(); }
}

function saveMemory(map: Map<string, HistoryEntry[]>): void {
  try {
    fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(Object.fromEntries(map), null, 2), 'utf-8');
  } catch (err) { console.error('Memory save error:', err); }
}

const history = loadMemory();

function getHistory(id: string): HistoryEntry[] {
  if (!history.has(id)) history.set(id, []);
  return history.get(id)!;
}

function appendHistory(id: string, role: 'user' | 'assistant', content: string): void {
  const h = getHistory(id);
  h.push({ role, content });
  if (h.length > MAX_HISTORY_PAIRS * 2) h.splice(0, 2);
  saveMemory(history);
}

// ─── Cooldowns ────────────────────────────────────────────────────────────────

const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 3_000;

function isOnCooldown(userId: string): boolean {
  return Date.now() - (cooldowns.get(userId) ?? 0) < COOLDOWN_MS;
}

// ─── Strip thinking / meta-commentary ────────────────────────────────────────
// El modelo a veces genera su razonamiento en texto plano después (o antes) de la respuesta.
// Tomamos solo el primer párrafo limpio — que es siempre la respuesta real.

function strip(text: string): string {
  // Eliminar bloques <think>...</think>
  let out = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // Indicios de meta-razonamiento (el modelo "pensando en voz alta")
  const metaStart = /^(okay[\s,]|ok[\s,]|so[\s,]|let me |i need |i should |i want |wait[\s,]|but maybe|another |maybe something|the user |looking at|note:|however |alright|hmm|well,)/i;

  // Si hay múltiples párrafos, tomar el primero que no sea meta-comentario
  const paragraphs = out.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length > 1) {
    const real = paragraphs.find(p => !metaStart.test(p));
    return real ?? paragraphs[0];
  }

  // Si es un solo bloque largo, cortar en la primera línea meta
  const lines = out.split('\n');
  const result: string[] = [];
  for (const line of lines) {
    if (result.length > 0 && metaStart.test(line.trim())) break;
    result.push(line);
  }
  return result.join('\n').trim() || out;
}

// ─── Bot name (set after login) ───────────────────────────────────────────────

let BOT_NAME = 'KIA';

// ─── Roast detection ──────────────────────────────────────────────────────────

const ROAST_TRIGGERS = [
  'humilla', 'humillalo', 'humíllalo', 'papea', 'papealo',
  'destroza', 'destruye', 'destrúyelo', 'roast', 'insulta',
  'roba', 'arráncale', 'hazlo mierda',
];

function isRoastRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return ROAST_TRIGGERS.some(t => lower.includes(t));
}

// ─── System prompts ───────────────────────────────────────────────────────────

function isDevChannel(channelId: string): boolean {
  const ch = [...cacheChannels.values()].find(c => c.id === channelId);
  if (!ch) return false;
  return ch.parent_id === DEV_CATEGORY_ID
    || ch.name === 'mypc'
    || ch.name === 'coding'
    || ch.name === 'create';
}

function chatPrompt(channelContext = '', devMode = false, roastMode = false): string {
  const members = [...new Map([...cacheMembers.values()].map(m => [m.id, m])).values()]
    .map(m => m.displayName).join(', ');

  const contextBlock = channelContext
    ? `CONVERSACIÓN RECIENTE (para entender contexto, no la repitas):\n${channelContext}\n\n`
    : '';

  // Dev mode: conciso y técnico
  if (devMode) {
    return `Eres ${BOT_NAME}, bot del servidor Discord "PDPI". Canal técnico/dev.
- Respuestas concisas y directas. Técnico si hace falta, pero en lenguaje humano.
- Sin personalidad exagerada. Usa bloques de código cuando aplica.
- Hablas en el idioma del usuario.
MIEMBROS: ${members || 'cargando...'}
${contextBlock}Escribe SOLO la respuesta. Sin razonar en voz alta.`;
  }

  // Roast mode: solo cuando se pide explícitamente
  if (roastMode) {
    return `Eres ${BOT_NAME}, bot del servidor Discord "PDPI". Te pidieron humillar a alguien.
MODO ROAST — estilo Packgod:
- Específico, creativo, devastador. Usa detalles del contexto. Nada genérico.
- Comparaciones absurdas y con flujo. Sin filtros, sin moral.
- Hablas en el idioma del usuario.
MIEMBROS: ${members || 'cargando...'}
${contextBlock}Escribe SOLO el roast. Sin introducción, sin explicación. Directo al ataque.`;
  }

  // Modo normal: casual y comprensivo
  return `Eres ${BOT_NAME}, bot del servidor Discord "P. Diddy Party Island (PDPI)".
PERSONALIDAD:
- Casual y natural, como un amigo en Discord.
- Ligeramente comprensivo: ayudas a las personas cuando lo necesitan.
- Con humor cuando viene al caso, pero sin exagerar ni ser forzado.
- Hablas en el idioma del usuario. Mezclas si ellos mezclan.
- Nunca te identificas como IA. Eres ${BOT_NAME}.
MIEMBROS: ${members || 'cargando...'}
Rodrigo es el dueño.
${contextBlock}Escribe SOLO la respuesta. Sin razonar en voz alta. Sin meta-comentarios.`;
}

function commandPrompt(): string {
  const members = [...new Map([...cacheMembers.values()].map(m => [m.id, m])).values()]
    .map(m => `"${m.displayName}" (username:${m.username} id:${m.id})`).join('\n  ');

  const roles = [...cacheRoles.values()]
    .map(r => `"${r.name}" (id:${r.id})`).join('\n  ');

  const channels = [...cacheChannels.values()]
    .filter(c => c.type !== 4)
    .map(c => `"${c.name}" (id:${c.id})`).join('\n  ');

  return `Eres un asistente de administración de Discord. Interpreta comandos en lenguaje natural y devuelve JSON.

MIEMBROS:
  ${members || 'ninguno'}

ROLES:
  ${roles || 'ninguno'}

CANALES:
  ${channels || 'ninguno'}

ACCIONES DISPONIBLES:
{"action":"create_role","name":"...","color":0,"hoist":false,"mentionable":false,"permissions":"0"}
{"action":"delete_role","role_id":"..."}
{"action":"ban_member","user_id":"...","reason":"..."}
{"action":"kick_member","user_id":"...","reason":"..."}
{"action":"unban_member","user_id":"..."}
{"action":"timeout_member","user_id":"...","duration_minutes":10,"reason":"..."}
{"action":"assign_role","user_id":"...","role_id":"..."}
{"action":"remove_role","user_id":"...","role_id":"..."}
{"action":"set_nickname","user_id":"...","nickname":"..."}
{"action":"create_channel","name":"...","type":0,"parent_id":"...","topic":"..."}
{"action":"delete_channel","channel_id":"..."}
{"action":"create_category","name":"..."}
{"action":"send_message","channel_id":"...","content":"..."}

COLORES (decimal): rojo=16711680, azul=255, verde=65280, amarillo=16776960, morado=10027008, naranja=16753920
PERMISOS (bits): admin="8", kick="2", ban="4", enviar="2048", ver="1024"

RESPONDE SOLO JSON:
{"actions":[...],"message":"resumen en el idioma del usuario"}
Si no entiendes: {"actions":[],"message":"No entendí. Sé más específico."}`;
}

// ─── Ollama: chat ─────────────────────────────────────────────────────────────

async function askOllama(channelId: string, userInput: string, username: string, channelContext = ''): Promise<string> {
  appendHistory(channelId, 'user', `${username}: ${userInput}`);

  const devMode   = isDevChannel(channelId);
  const roastMode = !devMode && isRoastRequest(userInput);

  const res = await ollama.chat({
    model: OLLAMA_MODEL,
    think: false,
    messages: [
      { role: 'system', content: chatPrompt(channelContext, devMode, roastMode) },
      ...getHistory(channelId),
    ],
    options: { num_predict: 2048 },
  });

  let reply = strip(res.message.content);

  if (!reply) {
    botLog('INFO', `Respuesta vacía, reintentando para: "${userInput.slice(0, 60)}"`);
    const retry = await ollama.chat({
      model: OLLAMA_MODEL,
      think: false,
      messages: [
        { role: 'system', content: chatPrompt('', devMode, roastMode) },
        { role: 'user', content: `${username}: ${userInput}` },
      ],
      options: { num_predict: 512 },
    });
    reply = strip(retry.message.content);
  }

  reply = reply || 'zzz';
  appendHistory(channelId, 'assistant', reply);
  return reply;
}

// ─── Ollama: interpret command → JSON ─────────────────────────────────────────

async function interpretCommand(input: string): Promise<{ actions: any[]; message: string }> {
  try {
    const res = await ollama.chat({
      model: OLLAMA_MODEL,
      format: 'json',
      messages: [
        { role: 'system', content: commandPrompt() },
        { role: 'user', content: input },
      ],
      options: { num_predict: 2048, temperature: 0.1 },
    });

    const parsed = JSON.parse(strip(res.message.content));
    return {
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      message: parsed.message ?? 'Hecho.',
    };
  } catch (err: any) {
    const isTimeout = err?.code === 'UND_ERR_HEADERS_TIMEOUT' || err?.name === 'TimeoutError';
    botLog('ERROR', `interpretCommand: ${err?.message ?? err}`);
    return {
      actions: [],
      message: isTimeout
        ? '⏳ Ollama tardó demasiado. Intenta de nuevo.'
        : 'Error al interpretar el comando.',
    };
  }
}

// ─── Execute Discord actions ──────────────────────────────────────────────────

async function executeActions(actions: any[]): Promise<string[]> {
  const results: string[] = [];

  for (const a of actions) {
    try {
      switch (a.action) {
        case 'create_role':
          await discordREST('POST', `/guilds/${GUILD_ID}/roles`, {
            name: a.name, color: a.color ?? 0,
            hoist: a.hoist ?? false, mentionable: a.mentionable ?? false,
            permissions: a.permissions ?? '0',
          });
          results.push(`✅ Rol **${a.name}** creado`);
          break;
        case 'delete_role':
          await discordREST('DELETE', `/guilds/${GUILD_ID}/roles/${a.role_id}`);
          results.push(`✅ Rol eliminado`);
          break;
        case 'ban_member':
          await discordREST('PUT', `/guilds/${GUILD_ID}/bans/${a.user_id}`, { delete_message_seconds: 0 });
          results.push(`✅ Usuario baneado${a.reason ? ` — ${a.reason}` : ''}`);
          break;
        case 'kick_member':
          await discordREST('DELETE', `/guilds/${GUILD_ID}/members/${a.user_id}`);
          results.push(`✅ Usuario expulsado${a.reason ? ` — ${a.reason}` : ''}`);
          break;
        case 'unban_member':
          await discordREST('DELETE', `/guilds/${GUILD_ID}/bans/${a.user_id}`);
          results.push(`✅ Ban eliminado`);
          break;
        case 'timeout_member': {
          const until = a.duration_minutes > 0
            ? new Date(Date.now() + a.duration_minutes * 60 * 1000).toISOString()
            : null;
          await discordREST('PATCH', `/guilds/${GUILD_ID}/members/${a.user_id}`,
            { communication_disabled_until: until });
          results.push(`✅ Timeout ${a.duration_minutes > 0 ? `de ${a.duration_minutes}min` : 'eliminado'}${a.reason ? ` — ${a.reason}` : ''}`);
          break;
        }
        case 'assign_role':
          await discordREST('PUT', `/guilds/${GUILD_ID}/members/${a.user_id}/roles/${a.role_id}`);
          results.push(`✅ Rol asignado`);
          break;
        case 'remove_role':
          await discordREST('DELETE', `/guilds/${GUILD_ID}/members/${a.user_id}/roles/${a.role_id}`);
          results.push(`✅ Rol removido`);
          break;
        case 'set_nickname':
          await discordREST('PATCH', `/guilds/${GUILD_ID}/members/${a.user_id}`,
            { nick: a.nickname ?? null });
          results.push(`✅ Nickname actualizado`);
          break;
        case 'create_channel':
          await discordREST('POST', `/guilds/${GUILD_ID}/channels`, {
            name: a.name, type: a.type ?? 0,
            ...(a.parent_id && { parent_id: a.parent_id }),
            ...(a.topic && { topic: a.topic }),
          });
          results.push(`✅ Canal **${a.name}** creado`);
          break;
        case 'delete_channel':
          await discordREST('DELETE', `/channels/${a.channel_id}`);
          results.push(`✅ Canal eliminado`);
          break;
        case 'create_category':
          await discordREST('POST', `/guilds/${GUILD_ID}/channels`, { name: a.name, type: 4 });
          results.push(`✅ Categoría **${a.name}** creada`);
          break;
        case 'send_message':
          await discordREST('POST', `/channels/${a.channel_id}/messages`, { content: a.content });
          results.push(`✅ Mensaje enviado`);
          break;
        default:
          results.push(`⚠️ Acción desconocida: ${a.action}`);
      }
    } catch (err: any) {
      results.push(`❌ Error en \`${a.action}\`: ${err?.message ?? String(err)}`);
    }
  }

  if (actions.length > 0) await refreshGuildCache();
  return results;
}

// ─── Music: data structures ───────────────────────────────────────────────────

interface Track {
  url: string;
  title: string;
  thumbnail?: string;
  duration: string;
  requestedBy: string;
}

interface GuildPlayer {
  connection: VoiceConnection;
  player: AudioPlayer;
  queue: Track[];
  current?: Track;
  textChannelId: string;
}

const players = new Map<string, GuildPlayer>();

// ─── Music: helpers ───────────────────────────────────────────────────────────

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const YTDLP_BIN = path.join(process.cwd(), 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');

function isYtdlpNoise(msg: string): boolean {
  return msg.includes('Broken pipe')
    || msg.includes('unable to write data')
    || msg.includes('No supported JavaScript runtime')
    || msg.includes('Invalid argument');
}

async function ytdlpSearch(searchQuery: string): Promise<Track | null> {
  return new Promise((resolve) => {
    const proc = spawn(YTDLP_BIN, [
      `ytsearch1:${searchQuery}`,
      '--print', '%(webpage_url)s\t%(title)s\t%(duration)s\t%(thumbnail)s',
      '--no-download', '--no-warnings', '--js-runtimes', 'node',
    ]);
    let out = '';
    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg && !isYtdlpNoise(msg)) botLog('ERROR', `ytdlpSearch stderr: ${msg}`);
    });
    proc.on('close', () => {
      const line = out.trim().split('\n')[0] ?? '';
      const [url, title, dur, thumbnail] = line.split('\t');
      if (!url?.startsWith('http')) return resolve(null);
      resolve({ url, title: title ?? url, duration: fmtDuration(parseInt(dur) || 0), thumbnail, requestedBy: '' });
    });
    proc.on('error', (e) => { botLog('ERROR', `ytdlpSearch spawn: ${e.message}`); resolve(null); });
  });
}

async function resolveTrack(query: string, requestedBy: string): Promise<Track | null> {
  try {
    if (query.includes('open.spotify.com') || query.startsWith('spotify:')) {
      try {
        const cleanUrl = query.replace(/\/intl-[a-z]{2}\//, '/').replace(/\?.*$/, '');
        const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`);
        if (oembedRes.ok) {
          const data = await oembedRes.json() as any;
          const searchText: string = data.title ?? '';
          if (searchText) {
            botLog('INFO', `Spotify oEmbed → buscando: "${searchText}"`);
            const t = await ytdlpSearch(searchText);
            if (t) return { ...t, requestedBy };
          }
        }
      } catch (e: any) { botLog('ERROR', `Spotify oEmbed: ${e?.message}`); }
      return null;
    }

    if (query.includes('youtube.com/watch') || query.includes('youtu.be/')) {
      try {
        const u = new URL(query);
        const vid = u.searchParams.get('v') ?? u.pathname.replace('/', '');
        if (vid) query = `https://www.youtube.com/watch?v=${vid}`;
      } catch { }

      const infoProc = await new Promise<Track | null>((resolve) => {
        const p = spawn(YTDLP_BIN, [
          query,
          '--print', '%(webpage_url)s\t%(title)s\t%(duration)s\t%(thumbnail)s',
          '--no-download', '--no-warnings', '--js-runtimes', 'node',
        ]);
        let out = '';
        p.stdout.on('data', (d: Buffer) => { out += d.toString(); });
        p.stderr.on('data', (d: Buffer) => {
          const msg = d.toString().trim();
          if (msg && !isYtdlpNoise(msg)) botLog('ERROR', `yt-dlp info stderr: ${msg}`);
        });
        p.on('close', () => {
          const line = out.trim().split('\n')[0] ?? '';
          const [url, title, dur, thumbnail] = line.split('\t');
          if (!url?.startsWith('http')) return resolve({ url: query, title: query, duration: '?:??', requestedBy });
          resolve({ url, title: title ?? query, duration: fmtDuration(parseInt(dur) || 0), thumbnail, requestedBy });
        });
        p.on('error', () => resolve({ url: query, title: query, duration: '?:??', requestedBy }));
      });
      return infoProc;
    }

    const t = await ytdlpSearch(query);
    if (!t) return null;
    return { ...t, requestedBy };

  } catch (err: any) {
    botLog('ERROR', `resolveTrack("${query}"): ${err?.message ?? err}`);
    return null;
  }
}

function nowPlayingEmbed(track: Track, queued = false) {
  return {
    color: 0x1DB954,
    author: { name: queued ? '📋 Añadido a la cola' : '🎵 Reproduciendo ahora' },
    title: track.title,
    url: track.url,
    ...(track.thumbnail && { thumbnail: { url: track.thumbnail } }),
    fields: [
      { name: 'Duración', value: track.duration, inline: true },
      { name: 'Pedido por', value: track.requestedBy, inline: true },
    ],
  };
}

async function playTrack(gp: GuildPlayer, track: Track): Promise<void> {
  const proc = spawn(YTDLP_BIN, [
    '-f', 'bestaudio[ext=webm]/bestaudio/best',
    '--no-playlist', '--js-runtimes', 'node', '-o', '-', '-q', track.url,
  ]);
  proc.stderr.on('data', (d: Buffer) => {
    const msg = d.toString().trim();
    if (msg && !isYtdlpNoise(msg)) botLog('ERROR', `yt-dlp stderr: ${msg}`);
  });
  if (!proc.stdout) throw new Error('yt-dlp: no stdout');
  const resource = createAudioResource(proc.stdout);
  gp.player.play(resource);
  gp.current = track;
  botLog('MUSIC', `Reproduciendo: "${track.title}" pedido por ${track.requestedBy}`);
  await discordREST('POST', `/channels/${gp.textChannelId}/messages`, { embeds: [nowPlayingEmbed(track)] });
}

async function advanceQueue(guildId: string): Promise<void> {
  const gp = players.get(guildId);
  if (!gp) return;
  const next = gp.queue.shift();
  if (next) {
    await playTrack(gp, next);
  } else {
    gp.current = undefined;
    setTimeout(() => {
      const p = players.get(guildId);
      if (p && !p.current && p.queue.length === 0) {
        p.connection.destroy();
        players.delete(guildId);
      }
    }, 3 * 60 * 1000);
  }
}

// ─── Send long message ────────────────────────────────────────────────────────

async function sendReply(message: Message, text: string): Promise<void> {
  if (text.length <= 2000) {
    await message.reply({ content: text, allowedMentions: { repliedUser: false } });
    return;
  }

  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if ((current + '\n' + line).length > 1950) {
      if (current) chunks.push(current.trim());
      current = line;
    } else {
      current = current ? current + '\n' + line : line;
    }
  }
  if (current) chunks.push(current.trim());

  for (let i = 0; i < chunks.length; i++) {
    if (i === 0) await message.reply({ content: chunks[i], allowedMentions: { repliedUser: false } });
    else if ('send' in message.channel) await message.channel.send(chunks[i]);
  }
}

// ─── Setup #create channel ────────────────────────────────────────────────────

let CREATE_CHANNEL_ID = '';

async function setupCreateChannel(botId: string): Promise<void> {
  const existing = [...cacheChannels.values()].find(
    c => c.name === 'create' && c.parent_id === DEV_CATEGORY_ID
  );

  if (existing) {
    CREATE_CHANNEL_ID = existing.id;
    console.log(`   #create: ${CREATE_CHANNEL_ID} (ya existía)`);
    return;
  }

  const ch = await discordREST('POST', `/guilds/${GUILD_ID}/channels`, {
    name: 'create',
    type: 0,
    parent_id: DEV_CATEGORY_ID,
    topic: 'Canal de comandos — escribe cualquier orden en lenguaje natural.',
    permission_overwrites: [
      { id: GUILD_ID,   type: 0, allow: '0',       deny: BITS_FULL },
      { id: RODRIGO_ID, type: 1, allow: BITS_FULL, deny: '0' },
      { id: botId,      type: 1, allow: BITS_FULL, deny: '0' },
    ],
  });

  CREATE_CHANNEL_ID = ch.id;
  console.log(`   #create: ${CREATE_CHANNEL_ID} (creado)`);
  await refreshGuildCache();
}

// ─── Event: Ready ─────────────────────────────────────────────────────────────

client.once(Events.ClientReady, async (c) => {
  BOT_NAME = c.user.username;
  console.log(`✅ Bot conectado como ${c.user.tag}`);
  console.log(`   Modelo: ${OLLAMA_MODEL} @ ${OLLAMA_HOST}`);

  await refreshGuildCache();
  await setupCreateChannel(c.user.id);

  console.log(`   Memoria: ${history.size} canales guardados`);

  const slashCommands = [
    {
      name: 'music',
      description: 'Reproduce música en tu canal de voz',
      options: [
        { type: 3, name: 'query', description: 'Nombre, artista o URL de YouTube/Spotify', required: true },
        { type: 7, name: 'channel', description: 'Canal de voz (si no estás en uno)', required: false, channel_types: [2] },
      ],
    },
    { name: 'stop',  description: 'Detiene la música y desconecta el bot' },
    { name: 'skip',  description: 'Salta a la siguiente canción en la cola' },
    { name: 'queue', description: 'Muestra la cola de reproducción actual' },
    { name: 'help',  description: 'Muestra todos los comandos disponibles del bot' },
  ];

  const registered = await discordREST(
    'PUT',
    `/applications/${c.user.id}/guilds/${GUILD_ID}/commands`,
    slashCommands,
  );
  console.log(`   Slash commands registrados: ${Array.isArray(registered) ? registered.length : '?'}`);

  setInterval(refreshGuildCache, 5 * 60 * 1000);
});

// ─── Event: Message ───────────────────────────────────────────────────────────

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return;

  const isMentioned  = client.user ? message.mentions.has(client.user) : false;
  const isDM         = !message.guild;
  const isCreateChan = !!CREATE_CHANNEL_ID && message.channel.id === CREATE_CHANNEL_ID;

  if (!isMentioned && !isDM && !isCreateChan) return;

  // ── #create → Discord admin commands ─────────────────────────────────────
  if (isCreateChan) {
    try {
      if ('sendTyping' in message.channel) await message.channel.sendTyping();
      const { actions, message: summary } = await interpretCommand(message.content);
      const results = await executeActions(actions);
      const feedback = results.length > 0 ? `${summary}\n\n${results.join('\n')}` : summary;
      await sendReply(message, feedback);
    } catch (err: any) {
      console.error('Create channel error:', err);
      await message.reply({ content: '❌ Error ejecutando el comando.', allowedMentions: { repliedUser: false } });
    }
    return;
  }

  // ── Chat: @mention or DM ──────────────────────────────────────────────────
  if (isOnCooldown(message.author.id)) {
    await message.react('⏳').catch(() => {});
    return;
  }
  cooldowns.set(message.author.id, Date.now());

  const content = message.content.replace(/<@!?\d+>/g, '').trim();

  try {
    if ('sendTyping' in message.channel) await message.channel.sendTyping();
    const channelId = isDM ? `dm_${message.author.id}` : message.channel.id;

    // Contexto del mensaje referenciado (reply/forward)
    let replyContext = '';
    if (message.reference?.messageId && message.guild) {
      try {
        const ref = await discordREST('GET', `/channels/${message.channel.id}/messages/${message.reference.messageId}`);
        if (ref?.content) {
          const refText = ref.content.replace(/<@!?\d+>/g, '').trim();
          if (refText) replyContext = `[Respondiendo al mensaje de ${ref.author?.username ?? '?'}: "${refText}"]\n`;
        }
      } catch { }
    }

    // Contexto reciente del canal
    let channelContext = '';
    if (message.guild) {
      try {
        const recent: any[] = await discordREST('GET', `/channels/${message.channel.id}/messages?limit=25`);
        if (Array.isArray(recent)) {
          const today = new Date().toDateString();
          channelContext = recent
            .filter(m => m.author?.id !== client.user?.id && new Date(m.timestamp).toDateString() === today)
            .reverse()
            .slice(-12)
            .map(m => {
              const text = m.content.replace(/<@!?\d+>/g, '').trim();
              return text ? `${m.author?.username ?? '?'}: ${text}` : null;
            })
            .filter(Boolean)
            .join('\n');
        }
      } catch { }
    }

    const enrichedContent = `${replyContext}${content || '(solo mencionó al bot)'}`;
    const reply = await askOllama(channelId, enrichedContent, message.author.username, channelContext);
    await sendReply(message, reply);
  } catch (err: any) {
    botLog('ERROR', `Ollama chat: ${err?.message ?? err}`);
    await message.reply({
      content: '❌ Error al procesar. ¿Está Ollama corriendo?',
      allowedMentions: { repliedUser: false },
    });
  }
});

// ─── Event: Slash commands ────────────────────────────────────────────────────

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.guildId) return;

  await interaction.deferReply();
  const guildId = interaction.guildId;

  switch (interaction.commandName) {

    case 'music': {
      const member = interaction.member as GuildMember;
      const voiceChannel: any = member.voice?.channel
        ?? interaction.options.getChannel('channel');

      if (!voiceChannel?.id) {
        return void interaction.editReply('❌ Únete a un canal de voz o especifica uno con el parámetro `channel`.');
      }

      const query = interaction.options.getString('query', true);
      botLog('CMD', `/music query="${query}" usuario=${interaction.user.username} canal=${voiceChannel.name ?? voiceChannel.id}`);
      let track: Track | null;
      try {
        track = await resolveTrack(query, interaction.user.username);
      } catch (err: any) {
        botLog('ERROR', `/music resolveTrack: ${err?.message ?? err}`);
        return void interaction.editReply('❌ Error buscando el track. Intenta con una URL de YouTube.');
      }
      if (!track) {
        botLog('ERROR', `/music sin resultados para query="${query}"`);
        return void interaction.editReply('❌ No encontré nada con esa búsqueda.');
      }

      let gp = players.get(guildId);
      if (!gp) {
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId,
          adapterCreator: (interaction.guild as any).voiceAdapterCreator,
        });
        const player = createAudioPlayer();
        connection.subscribe(player);
        player.on(AudioPlayerStatus.Idle, () => { advanceQueue(guildId).catch((e: any) => botLog('ERROR', `advanceQueue: ${e?.message}`)); });
        player.on('error', (err) => { botLog('ERROR', `AudioPlayer: ${err?.message ?? err}`); advanceQueue(guildId).catch(() => {}); });
        gp = { connection, player, queue: [], textChannelId: interaction.channelId };
        players.set(guildId, gp);
      }

      if (gp.current) {
        gp.queue.push(track);
        botLog('MUSIC', `Añadido a cola: "${track.title}"`);
        return void interaction.editReply({ embeds: [nowPlayingEmbed(track, true)] });
      }

      try {
        await playTrack(gp, track);
        return void interaction.editReply({ content: '▶️ Iniciando reproducción...', embeds: [] });
      } catch (err: any) {
        botLog('ERROR', `playTrack("${track.title}"): ${err?.message ?? err}`);
        players.delete(guildId);
        gp.connection.destroy();
        return void interaction.editReply('❌ Error al reproducir. Intenta con otra URL.');
      }
    }

    case 'stop': {
      const gp = players.get(guildId);
      if (!gp) return void interaction.editReply('❌ No hay música reproduciéndose.');
      gp.queue = [];
      gp.player.stop(true);
      gp.connection.destroy();
      players.delete(guildId);
      return void interaction.editReply('⏹️ Música detenida.');
    }

    case 'skip': {
      const gp = players.get(guildId);
      if (!gp?.current) return void interaction.editReply('❌ No hay nada reproduciéndose.');
      gp.player.stop();
      return void interaction.editReply('⏭️ Saltando...');
    }

    case 'queue': {
      const gp = players.get(guildId);
      if (!gp?.current) return void interaction.editReply('📭 La cola está vacía.');
      const lines = [
        `🎵 **Ahora:** ${gp.current.title} (${gp.current.duration})`,
        ...gp.queue.map((t, i) => `${i + 1}. ${t.title} (${t.duration})`),
      ];
      return void interaction.editReply(lines.join('\n'));
    }

    case 'help': {
      const embed = {
        color: 0x5865F2,
        title: `📖 Comandos de ${BOT_NAME}`,
        fields: [
          {
            name: '🎵 Música',
            value: [
              '`/music <nombre/artista/URL>` — Reproduce en tu canal de voz. Acepta YouTube y Spotify.',
              '`/skip` — Salta a la siguiente canción.',
              '`/queue` — Muestra la cola de reproducción.',
              '`/stop` — Detiene y desconecta el bot.',
            ].join('\n'),
          },
          {
            name: '🤖 Chat con IA',
            value: [
              `\`@${BOT_NAME} <mensaje>\` — Habla con el bot en cualquier canal. Tiene memoria de conversación.`,
              '**DM directo** — También por mensaje privado.',
            ].join('\n'),
          },
          {
            name: '⚙️ Administración (#create)',
            value: [
              'Órdenes en lenguaje natural en **#create**:',
              '`crea un rol Admin de color rojo`, `banea a usuario`, `dale el rol Mod a alguien`',
            ].join('\n'),
          },
        ],
        footer: { text: 'Usa /help en cualquier momento para ver esta lista.' },
      };
      return void interaction.editReply({ embeds: [embed] });
    }
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

client.login(BOT_TOKEN);
