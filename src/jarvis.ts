/**
 * jarvis.ts — Bridge entre Discord y Claude Code / comandos del PC
 *
 * Expone:
 *  - initJarvis()               → crea canales mypc/claudecode/logspc al arrancar
 *  - handleClaudeCodeMessage()  → procesa mensajes de #claudecode con Claude Code CLI
 *  - getPcSlashCommands()       → definiciones de los subcomandos /pc
 *  - handlePcCommand()          → handler del slash command /pc
 *  - getClaudeCodeChannelId()   → ID del canal #claudecode (para bot.ts)
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { Message } from 'discord.js';

import { botLog, discordREST, GUILD_ID, RODRIGO_ID, BITS_FULL } from './config.js';

// ─── Channel IDs (populated by initJarvis) ────────────────────────────────────

let MYPC_CATEGORY_ID      = '';
let CLAUDECODE_CHANNEL_ID = '';
let LOGSPC_CHANNEL_ID     = '';

export function getClaudeCodeChannelId(): string { return CLAUDECODE_CHANNEL_ID; }

// ─── Danger detection ─────────────────────────────────────────────────────────

const DANGER_WORDS = [
  'delete', 'remove', 'rm ', 'drop', 'uninstall', 'format', 'truncate',
  'elimina', 'borra ', 'borrar', 'eliminar', 'desinstala', 'truncar', 'formatea',
];

export function isDangerousPrompt(text: string): boolean {
  const lower = text.toLowerCase();
  return DANGER_WORDS.some(k => lower.includes(k));
}

// Bloquea procesar "si"/"no" como prompts mientras hay confirmación pendiente
export const pendingConfirmation = new Set<string>();

// ─── Logspc embed helper ──────────────────────────────────────────────────────

export async function logToLogspc(embed: object): Promise<void> {
  if (!LOGSPC_CHANNEL_ID) return;
  try {
    await discordREST('POST', `/channels/${LOGSPC_CHANNEL_ID}/messages`, { embeds: [embed] });
  } catch { /* non-blocking */ }
}

// ─── Claude Code runner ───────────────────────────────────────────────────────

export async function runClaudeCode(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    botLog('CLAUDE', `Ejecutando: "${prompt.slice(0, 100)}"`);
    const proc = spawn('claude', ['-p', prompt, '--dangerously-skip-permissions'], {
      cwd: process.cwd(),
      shell: true,
    });
    let out = '';
    const timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      resolve('⏰ Timeout: Claude Code tardó más de 5 minutos.');
    }, 5 * 60 * 1000);
    proc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { out += d.toString(); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      botLog('CLAUDE', `Proceso terminó con código ${code}`);
      resolve(out.trim() || '(sin output)');
    });
    proc.on('error', (e) => {
      clearTimeout(timer);
      botLog('ERROR', `runClaudeCode spawn: ${e.message}`);
      resolve(`❌ No se pudo lanzar Claude Code: ${e.message}\n(¿está \`claude\` en el PATH?)`);
    });
  });
}

// ─── PC quick commands (sin IA, respuesta inmediata) ─────────────────────────

function runShell(cmd: string, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn('cmd', ['/c', cmd], { shell: false });
    let out = '';
    const timer = setTimeout(() => { proc.kill(); resolve('⏰ Timeout'); }, timeoutMs);
    proc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { out += d.toString(); });
    proc.on('close', () => { clearTimeout(timer); resolve(out.trim() || '(sin output)'); });
    proc.on('error', (e) => { clearTimeout(timer); resolve(`Error: ${e.message}`); });
  });
}

async function getPcStatusEmbed(): Promise<object> {
  const [diskRaw, memRaw, uptimeRaw] = await Promise.all([
    runShell('wmic logicaldisk get caption,freespace,size /format:csv'),
    runShell('wmic os get freephysicalmemory,totalvisiblememorysize /format:csv'),
    runShell('net stats workstation | findstr /i "since"'),
  ]);

  // Parse disk
  const diskLines = diskRaw.split('\n').filter(l => l.includes(',') && !l.toLowerCase().includes('caption'));
  const diskText = diskLines.map(l => {
    const parts = l.trim().split(',');
    const [, drive, free, total] = parts;
    if (!drive || !total || isNaN(parseInt(free)) || isNaN(parseInt(total))) return null;
    const freeGB = (parseInt(free) / 1e9).toFixed(1);
    const totalGB = (parseInt(total) / 1e9).toFixed(1);
    return `**${drive}** ${freeGB} GB libre / ${totalGB} GB total`;
  }).filter(Boolean).join('\n') || 'N/A';

  // Parse memory
  const memLine = memRaw.split('\n').find(l => l.includes(',') && !l.toLowerCase().includes('free'));
  let memText = 'N/A';
  if (memLine) {
    const parts = memLine.trim().split(',');
    const freeKB = parseInt(parts[1]);
    const totalKB = parseInt(parts[2]);
    if (!isNaN(freeKB) && !isNaN(totalKB)) {
      const freeGB = (freeKB / 1e6).toFixed(1);
      const totalGB = (totalKB / 1e6).toFixed(1);
      const usedPct = (100 - (freeKB / totalKB) * 100).toFixed(0);
      memText = `${freeGB} GB libre / ${totalGB} GB total (${usedPct}% uso)`;
    }
  }

  const uptime = uptimeRaw.replace(/Statistics since/i, '').trim() || 'N/A';

  return {
    color: 0x00bfff,
    title: '🖥️ Estado del PC',
    fields: [
      { name: '💾 Disco', value: diskText, inline: false },
      { name: '🧠 RAM', value: memText, inline: true },
      { name: '⏱️ Online desde', value: uptime, inline: true },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: 'JARVIS — System Monitor' },
  };
}

// ─── /pc slash command definitions ───────────────────────────────────────────

export function getPcSlashCommands() {
  return [
    {
      name: 'pc',
      description: 'Control remoto del PC (solo Rodrigo)',
      options: [
        {
          type: 1, // SUB_COMMAND
          name: 'status',
          description: 'Muestra estado del sistema: disco, RAM y uptime',
        },
        {
          type: 1,
          name: 'run',
          description: 'Ejecuta un comando shell en el PC y muestra el output',
          options: [
            { type: 3, name: 'cmd', description: 'Comando a ejecutar (cmd.exe)', required: true },
          ],
        },
        {
          type: 1,
          name: 'file',
          description: 'Muestra el contenido de un archivo del PC',
          options: [
            { type: 3, name: 'path', description: 'Ruta absoluta o relativa al proyecto', required: true },
          ],
        },
      ],
    },
  ];
}

// ─── /pc handler ──────────────────────────────────────────────────────────────

export async function handlePcCommand(interaction: any): Promise<void> {
  if (interaction.user.id !== RODRIGO_ID) {
    await interaction.editReply('❌ Solo Rodrigo puede usar `/pc`.');
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'status') {
    const embed = await getPcStatusEmbed();
    await interaction.editReply({ embeds: [embed] });
    await logToLogspc({ color: 0x00bfff, title: '📊 /pc status consultado', timestamp: new Date().toISOString() });
    return;
  }

  if (sub === 'run') {
    const cmd = interaction.options.getString('cmd', true);

    if (isDangerousPrompt(cmd)) {
      await interaction.editReply({
        embeds: [{
          color: 0xff6600,
          title: '⚠️ Comando peligroso',
          description: `\`${cmd}\`\n\nResponde **si** en 30s para confirmar, o **no** para cancelar.`,
        }],
      });
      const collected = await interaction.channel.awaitMessages({
        filter: (m: Message) => m.author.id === RODRIGO_ID && ['si', 'sí', 'no'].includes(m.content.toLowerCase().trim()),
        max: 1, time: 30_000,
      }).catch(() => null);
      const resp = (collected as any)?.first()?.content?.toLowerCase()?.trim();
      if (resp !== 'si' && resp !== 'sí') {
        await interaction.editReply({ content: '❌ Cancelado.', embeds: [] });
        return;
      }
    }

    const output = await runShell(cmd, 30_000);
    const preview = output.slice(0, 1900);
    await interaction.editReply({ content: `\`\`\`\n${preview}\n\`\`\``, embeds: [] });
    await logToLogspc({
      color: 0xffa500,
      title: '⚡ /pc run',
      fields: [
        { name: 'Comando', value: `\`${cmd}\``, inline: false },
        { name: 'Output', value: `\`\`\`\n${output.slice(0, 800)}\n\`\`\``, inline: false },
      ],
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (sub === 'file') {
    const filePath = interaction.options.getString('path', true);
    try {
      const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
      const content = fs.readFileSync(abs, 'utf-8');
      const preview = content.slice(0, 1800);
      const truncated = content.length > 1800 ? '\n*(truncado — usa #claudecode para ver el archivo completo)*' : '';
      await interaction.editReply({ content: `📄 **${filePath}**\n\`\`\`\n${preview}\n\`\`\`${truncated}`, embeds: [] });
    } catch (e: any) {
      await interaction.editReply({ content: `❌ No se pudo leer: \`${e.message}\``, embeds: [] });
    }
    return;
  }
}

// ─── #claudecode message handler ─────────────────────────────────────────────

export async function handleClaudeCodeMessage(message: Message): Promise<void> {
  if (message.author.id !== RODRIGO_ID) return;

  const prompt = message.content.trim();
  if (!prompt) return;

  // Ignorar mensajes "si"/"no" de confirmaciones pendientes
  if (pendingConfirmation.has(message.channel.id)) return;

  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const startMs = Date.now();

  // Confirmación para prompts peligrosos
  if (isDangerousPrompt(prompt)) {
    pendingConfirmation.add(message.channel.id);
    try {
      await discordREST('POST', `/channels/${message.channel.id}/messages`, {
        embeds: [{
          color: 0xff6600,
          title: '⚠️ Acción peligrosa detectada',
          description: `\`\`\`\n${prompt.slice(0, 500)}\n\`\`\``,
          footer: { text: 'Responde "si" para confirmar o "no" para cancelar (60s)' },
        }],
        message_reference: { message_id: message.id },
      });

      const collected = await (message.channel as any).awaitMessages({
        filter: (m: Message) =>
          m.author.id === RODRIGO_ID &&
          ['si', 'sí', 'no'].includes(m.content.toLowerCase().trim()),
        max: 1, time: 60_000,
      }).catch(() => null);

      const resp = (collected as any)?.first()?.content?.toLowerCase()?.trim();
      if (resp !== 'si' && resp !== 'sí') {
        const reason = collected ? 'cancelado' : 'timeout (60s)';
        await discordREST('POST', `/channels/${message.channel.id}/messages`, {
          content: `❌ Acción ${reason}.`,
          message_reference: { message_id: message.id },
        });
        await logToLogspc({
          color: 0xff0000,
          title: `❌ CANCELADO (${reason})`,
          description: `\`\`\`\n${prompt.slice(0, 500)}\n\`\`\``,
          timestamp: new Date().toISOString(),
        });
        return;
      }
    } finally {
      pendingConfirmation.delete(message.channel.id);
    }
  }

  botLog('CLAUDE', `Prompt: "${prompt.slice(0, 100)}"`);

  // Embed de "procesando" — aparece inmediatamente
  const processingMsg = await discordREST('POST', `/channels/${message.channel.id}/messages`, {
    embeds: [{
      color: 0x5865f2,
      author: { name: '🤖 JARVIS — Procesando...' },
      description: `\`\`\`\n${prompt.slice(0, 500)}\n\`\`\``,
      footer: { text: '⏳ Claude Code en ejecución — puede tardar varios segundos' },
    }],
    message_reference: { message_id: message.id },
  });

  await logToLogspc({
    color: 0x5865f2,
    title: '📥 Prompt recibido',
    description: `\`\`\`\n${prompt.slice(0, 800)}\n\`\`\``,
    footer: { text: `[${ts}]` },
  });

  const result = await runClaudeCode(prompt);
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);

  // Editar el embed de "procesando" con el resultado
  const resultPreview = result.slice(0, 1800);
  const truncNote = result.length > 1800 ? '\n*(truncado — output completo en #logspc)*' : '';

  await discordREST('PATCH', `/channels/${message.channel.id}/messages/${processingMsg.id}`, {
    embeds: [{
      color: 0x57f287,
      author: { name: '✅ JARVIS — Completado' },
      description: `\`\`\`\n${resultPreview}\n\`\`\`${truncNote}`,
      footer: { text: `Ejecutado en ${elapsed}s` },
    }],
  });

  await logToLogspc({
    color: 0x57f287,
    title: '✅ Resultado',
    description: `\`\`\`\n${result.slice(0, 1500)}\n\`\`\``,
    footer: { text: `[${ts}] · ${elapsed}s de ejecución` },
  });
}

// ─── Channel setup ────────────────────────────────────────────────────────────

export async function initJarvis(
  botId: string,
  cacheChannels: Map<string, { id: string; name: string; type: number; parent_id?: string }>,
  refreshGuildCache: () => Promise<void>,
): Promise<void> {

  // 1. Buscar o crear categoría mypc
  const mypcCat = [...cacheChannels.values()].find(c => c.type === 4 && c.name.toLowerCase() === 'mypc');
  if (mypcCat) {
    MYPC_CATEGORY_ID = mypcCat.id;
  } else {
    const cat = await discordREST('POST', `/guilds/${GUILD_ID}/channels`, { name: 'mypc', type: 4 });
    MYPC_CATEGORY_ID = cat.id;
    await refreshGuildCache();
  }

  // 2. Buscar o crear #claudecode — solo Rodrigo y el bot
  const ccChan = [...cacheChannels.values()].find(c => c.name === 'claudecode' && c.parent_id === MYPC_CATEGORY_ID);
  if (ccChan) {
    CLAUDECODE_CHANNEL_ID = ccChan.id;
  } else {
    const ch = await discordREST('POST', `/guilds/${GUILD_ID}/channels`, {
      name: 'claudecode',
      type: 0,
      parent_id: MYPC_CATEGORY_ID,
      topic: 'Escribe un prompt en lenguaje natural y Jarvis (Claude Code) lo ejecuta en el PC.',
      permission_overwrites: [
        { id: GUILD_ID,   type: 0, allow: '0',       deny: BITS_FULL },
        { id: RODRIGO_ID, type: 1, allow: BITS_FULL, deny: '0' },
        { id: botId,      type: 1, allow: BITS_FULL, deny: '0' },
      ],
    });
    CLAUDECODE_CHANNEL_ID = ch.id;
  }
  // Asegurar permisos correctos en canal existente (fix de privacidad)
  await discordREST('PUT', `/channels/${CLAUDECODE_CHANNEL_ID}/permissions/${GUILD_ID}`,   { type: 0, allow: '0', deny: BITS_FULL });
  await discordREST('PUT', `/channels/${CLAUDECODE_CHANNEL_ID}/permissions/${RODRIGO_ID}`, { type: 1, allow: BITS_FULL, deny: '0' });
  await discordREST('PUT', `/channels/${CLAUDECODE_CHANNEL_ID}/permissions/${botId}`,      { type: 1, allow: BITS_FULL, deny: '0' });

  // 3. Buscar o crear #logspc — PRIVADO: solo Rodrigo y el bot
  const logsChan = [...cacheChannels.values()].find(c => c.name === 'logspc' && c.parent_id === MYPC_CATEGORY_ID);
  if (logsChan) {
    LOGSPC_CHANNEL_ID = logsChan.id;
  } else {
    const ch = await discordREST('POST', `/guilds/${GUILD_ID}/channels`, {
      name: 'logspc',
      type: 0,
      parent_id: MYPC_CATEGORY_ID,
      topic: 'Log privado de todas las acciones ejecutadas por Jarvis.',
      permission_overwrites: [
        { id: GUILD_ID,   type: 0, allow: '0',       deny: BITS_FULL },
        { id: RODRIGO_ID, type: 1, allow: BITS_FULL, deny: '0' },
        { id: botId,      type: 1, allow: BITS_FULL, deny: '0' },
      ],
    });
    LOGSPC_CHANNEL_ID = ch.id;
  }
  // Asegurar privacidad en canal existente
  await discordREST('PUT', `/channels/${LOGSPC_CHANNEL_ID}/permissions/${GUILD_ID}`,   { type: 0, allow: '0', deny: BITS_FULL });
  await discordREST('PUT', `/channels/${LOGSPC_CHANNEL_ID}/permissions/${RODRIGO_ID}`, { type: 1, allow: BITS_FULL, deny: '0' });
  await discordREST('PUT', `/channels/${LOGSPC_CHANNEL_ID}/permissions/${botId}`,      { type: 1, allow: BITS_FULL, deny: '0' });

  console.log(`   Jarvis: mypc=${MYPC_CATEGORY_ID} claudecode=${CLAUDECODE_CHANNEL_ID} logspc=${LOGSPC_CHANNEL_ID}`);
  await refreshGuildCache();
}
