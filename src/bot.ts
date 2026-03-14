import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  TextChannel,
  DMChannel,
  NewsChannel,
  ThreadChannel,
} from 'discord.js';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN      = process.env.DISCORD_BOT_TOKEN!;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY!;
const GUILD_ID       = process.env.DISCORD_GUILD_ID!;

if (!BOT_TOKEN)     throw new Error('Missing DISCORD_BOT_TOKEN');
if (!ANTHROPIC_KEY) throw new Error('Missing ANTHROPIC_API_KEY');

// ─── Clients ──────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,   // Privileged — enable in Dev Portal
    GatewayIntentBits.DirectMessages,
  ],
});

const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ─── Conversation history (per channel, in-memory) ───────────────────────────

type HistoryEntry = { role: 'user' | 'assistant'; content: string };
const history = new Map<string, HistoryEntry[]>();
const MAX_HISTORY_PAIRS = 10; // keep last 10 exchanges

function getHistory(channelId: string): HistoryEntry[] {
  if (!history.has(channelId)) history.set(channelId, []);
  return history.get(channelId)!;
}

function appendHistory(channelId: string, role: 'user' | 'assistant', content: string) {
  const h = getHistory(channelId);
  h.push({ role, content });
  // Trim to max pairs (each pair = 2 entries)
  if (h.length > MAX_HISTORY_PAIRS * 2) h.splice(0, 2);
}

// ─── Cooldowns ────────────────────────────────────────────────────────────────

const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 3_000;

function isOnCooldown(userId: string): boolean {
  const last = cooldowns.get(userId) ?? 0;
  return Date.now() - last < COOLDOWN_MS;
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres Claude, un asistente de IA integrado como bot en el servidor de Discord "P. Diddy Party Island (PDPI)".

Reglas:
- Responde siempre en el mismo idioma que el usuario.
- Sé conciso y directo — los mensajes de Discord son cortos por naturaleza.
- Si el mensaje no tiene contenido claro, pregunta "¿En qué puedo ayudarte?".
- Puedes usar formato Markdown de Discord: **negrita**, *cursiva*, \`código\`, \`\`\`bloques\`\`\`, > citas.
- No repitas el nombre del usuario al inicio de cada respuesta.
- Si no sabes algo, dilo claramente.`;

// ─── Claude API call ──────────────────────────────────────────────────────────

async function askClaude(channelId: string, userInput: string, username: string): Promise<string> {
  appendHistory(channelId, 'user', `${username}: ${userInput}`);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: getHistory(channelId),
  });

  const reply =
    response.content[0].type === 'text'
      ? response.content[0].text
      : '(no response)';

  appendHistory(channelId, 'assistant', reply);
  return reply;
}

// ─── Send long message (Discord limit: 2000 chars) ───────────────────────────

async function sendReply(message: Message, text: string): Promise<void> {
  if (text.length <= 2000) {
    await message.reply({ content: text, allowedMentions: { repliedUser: false } });
    return;
  }

  // Split on newlines, keep chunks under 1950 chars
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
  console.log(`   Servidores: ${c.guilds.cache.size}`);
});

// ─── Event: Message ───────────────────────────────────────────────────────────

client.on(Events.MessageCreate, async (message: Message) => {
  // Ignore bots (including self)
  if (message.author.bot) return;

  const isMentioned = client.user ? message.mentions.has(client.user) : false;
  const isDM        = !message.guild;

  // Only respond to: @mention in server, or any DM
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

  // Call Claude
  const channelId = isDM ? `dm_${message.author.id}` : message.channel.id;

  try {
    const reply = await askClaude(channelId, content, message.author.username);
    await sendReply(message, reply);
  } catch (err: any) {
    console.error('Claude API error:', err?.message ?? err);
    await message.reply({
      content: '❌ Error al procesar tu mensaje. Inténtalo de nuevo.',
      allowedMentions: { repliedUser: false },
    });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

client.login(BOT_TOKEN);
