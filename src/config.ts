import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

// ─── Environment ──────────────────────────────────────────────────────────────

export const BOT_TOKEN    = process.env.DISCORD_BOT_TOKEN!;
export const GUILD_ID     = process.env.DISCORD_GUILD_ID!;
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen3:4b';
export const OLLAMA_HOST  = process.env.OLLAMA_HOST  ?? 'http://localhost:11434';

if (!BOT_TOKEN) throw new Error('Missing DISCORD_BOT_TOKEN');
if (!GUILD_ID)  throw new Error('Missing DISCORD_GUILD_ID');

// ─── Server constants ─────────────────────────────────────────────────────────

export const DEV_CATEGORY_ID = '1482437015562752093';
export const RODRIGO_ID      = '998386333896687756';
export const BITS_FULL       = '68608'; // VIEW_CHANNEL(1024) + SEND_MESSAGES(2048) + READ_MESSAGE_HISTORY(65536)

// ─── Logger ───────────────────────────────────────────────────────────────────

const LOG_FILE = path.join(process.cwd(), 'logs', 'bot.md');

export function botLog(level: 'INFO' | 'CMD' | 'ERROR' | 'MUSIC' | 'CLAUDE', msg: string): void {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `[${ts}] [${level}] ${msg}\n`;
  process.stdout.write(line);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line, 'utf-8');
  } catch { /* no interrumpir el bot si el log falla */ }
}

// ─── Discord REST helper ──────────────────────────────────────────────────────

export async function discordREST(method: string, endpoint: string, body?: unknown): Promise<any> {
  const res = await fetch(`https://discord.com/api/v10${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bot ${BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  if (res.status === 204) return { success: true };
  return res.json();
}
