import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
} from 'discord.js';
import { Ollama } from 'ollama';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN    = process.env.DISCORD_BOT_TOKEN!;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen3:4b';
const OLLAMA_HOST  = process.env.OLLAMA_HOST  ?? 'http://localhost:11434';

if (!BOT_TOKEN) throw new Error('Missing DISCORD_BOT_TOKEN');

// ─── Clients ──────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,   // Privileged — enable in Dev Portal
    GatewayIntentBits.DirectMessages,
  ],
});

const ollama = new Ollama({ host: OLLAMA_HOST });

// ─── Persistent memory (per channel) ─────────────────────────────────────────

type HistoryEntry = { role: 'user' | 'assistant'; content: string };

const MEMORY_FILE     = path.join(process.cwd(), 'data', 'memory.json');
const MAX_HISTORY_PAIRS = 10;

function loadMemory(): Map<string, HistoryEntry[]> {
  try {
    const raw = fs.readFileSync(MEMORY_FILE, 'utf-8');
    return new Map(Object.entries(JSON.parse(raw) as Record<string, HistoryEntry[]>));
  } catch {
    return new Map();
  }
}

function saveMemory(map: Map<string, HistoryEntry[]>): void {
  try {
    fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(Object.fromEntries(map), null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save memory:', err);
  }
}

const history = loadMemory();

function getHistory(channelId: string): HistoryEntry[] {
  if (!history.has(channelId)) history.set(channelId, []);
  return history.get(channelId)!;
}

function appendHistory(channelId: string, role: 'user' | 'assistant', content: string) {
  const h = getHistory(channelId);
  h.push({ role, content });
  if (h.length > MAX_HISTORY_PAIRS * 2) h.splice(0, 2);
  saveMemory(history);
}

// ─── Cooldowns ────────────────────────────────────────────────────────────────

const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 3_000;

function isOnCooldown(userId: string): boolean {
  const last = cooldowns.get(userId) ?? 0;
  return Date.now() - last < COOLDOWN_MS;
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres un asistente de IA integrado como bot en el servidor de Discord "P. Diddy Party Island (PDPI)".

Reglas:
- Responde siempre en el mismo idioma que el usuario.
- Sé conciso y directo — los mensajes de Discord son cortos por naturaleza.
- Si el mensaje no tiene contenido claro, pregunta "¿En qué puedo ayudarte?".
- Puedes usar formato Markdown de Discord: **negrita**, *cursiva*, \`código\`, \`\`\`bloques\`\`\`, > citas.
- No repitas el nombre del usuario al inicio de cada respuesta.
- Si no sabes algo, dilo claramente.`;

// ─── Strip <think> tokens (emitted by qwen3 before the actual answer) ─────────

function stripThinkingTokens(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

// ─── Ollama API call ──────────────────────────────────────────────────────────

async function askOllama(channelId: string, userInput: string, username: string): Promise<string> {
  appendHistory(channelId, 'user', `${username}: ${userInput}`);

  const response = await ollama.chat({
    model: OLLAMA_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...getHistory(channelId),
    ],
    options: { num_predict: 1024 },
  });

  // Strip thinking tokens BEFORE saving to history — prevents the model from
  // receiving its own reasoning as context in subsequent turns.
  const reply = stripThinkingTokens(response.message.content);
  appendHistory(channelId, 'assistant', reply);
  return reply;
}

// ─── Send long message (Discord limit: 2000 chars) ───────────────────────────

async function sendReply(message: Message, text: string): Promise<void> {
  if (text.length <= 2000) {
    await message.reply({ content: text, allowedMentions: { repliedUser: false } });
    return;
  }

  const lines = text.split('\n');
  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    if ((current + '\n' + line).length > 1950) {
      if (current) chunks.push(current.trim());
      current = line;
    } else {
      current = current ? current + '\n' + line : line;
    }
  }
  if (current) chunks.push(current.trim());

  for (let i = 0; i < chunks.length; i++) {
    if (i === 0) {
      await message.reply({ content: chunks[i], allowedMentions: { repliedUser: false } });
    } else if ('send' in message.channel) {
      await message.channel.send(chunks[i]);
    }
  }
}

// ─── Event: Ready ─────────────────────────────────────────────────────────────

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Bot conectado como ${c.user.tag} (${c.user.id})`);
  console.log(`   Modelo: ${OLLAMA_MODEL} @ ${OLLAMA_HOST}`);
  console.log(`   Canales en memoria: ${history.size}`);
});

// ─── Event: Message ───────────────────────────────────────────────────────────

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return;

  const isMentioned = client.user ? message.mentions.has(client.user) : false;
  const isDM        = !message.guild;

  if (!isMentioned && !isDM) return;

  // Cooldown
  if (isOnCooldown(message.author.id)) {
    await message.react('⏳').catch(() => {});
    return;
  }
  cooldowns.set(message.author.id, Date.now());

  // Extract text (strip all @mentions)
  const content = message.content.replace(/<@!?\d+>/g, '').trim();

  // Empty @mention → greeting
  if (!content) {
    await message.reply({
      content: '¡Hola! 👋 ¿En qué puedo ayudarte?',
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  // Show typing indicator
  try {
    if ('sendTyping' in message.channel) await message.channel.sendTyping();
  } catch {}

  const channelId = isDM ? `dm_${message.author.id}` : message.channel.id;

  try {
    const reply = await askOllama(channelId, content, message.author.username);
    await sendReply(message, reply);
  } catch (err: any) {
    console.error('Ollama error:', err?.message ?? err);
    await message.reply({
      content: '❌ Error al procesar tu mensaje. ¿Está Ollama corriendo? (`ollama serve`)',
      allowedMentions: { repliedUser: false },
    });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

client.login(BOT_TOKEN);
