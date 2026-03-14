import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!BOT_TOKEN) throw new Error('Missing DISCORD_BOT_TOKEN environment variable');
if (!GUILD_ID) throw new Error('Missing DISCORD_GUILD_ID environment variable');

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

const server = new Server(
  { name: 'discord-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// ─── Tool Definitions ────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // ── ROLES ──────────────────────────────────────────────────────────────
    {
      name: 'list_roles',
      description: 'List all roles in the Discord server',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'create_role',
      description: 'Create a new role in the Discord server',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Role name' },
          color: { type: 'number', description: 'Color as decimal integer (e.g. 16711680 = red). Use 0 for default.' },
          hoist: { type: 'boolean', description: 'Display the role separately in the member list' },
          mentionable: { type: 'boolean', description: 'Allow anyone to @mention this role' },
          permissions: { type: 'string', description: 'Permission bit flags as a string integer' },
        },
        required: ['name'],
      },
    },
    {
      name: 'update_role',
      description: 'Update an existing role',
      inputSchema: {
        type: 'object',
        properties: {
          role_id: { type: 'string', description: 'ID of the role to update' },
          name: { type: 'string', description: 'New name' },
          color: { type: 'number', description: 'New color as decimal integer' },
          hoist: { type: 'boolean', description: 'Display separately in member list' },
          mentionable: { type: 'boolean', description: 'Allow @mention' },
          permissions: { type: 'string', description: 'Permission bit flags as string' },
        },
        required: ['role_id'],
      },
    },
    {
      name: 'delete_role',
      description: 'Delete a role from the server',
      inputSchema: {
        type: 'object',
        properties: {
          role_id: { type: 'string', description: 'ID of the role to delete' },
        },
        required: ['role_id'],
      },
    },
    {
      name: 'assign_role',
      description: 'Assign a role to a server member',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'Discord user ID' },
          role_id: { type: 'string', description: 'Role ID to assign' },
        },
        required: ['user_id', 'role_id'],
      },
    },
    {
      name: 'remove_role',
      description: 'Remove a role from a server member',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'Discord user ID' },
          role_id: { type: 'string', description: 'Role ID to remove' },
        },
        required: ['user_id', 'role_id'],
      },
    },

    // ── CHANNELS ───────────────────────────────────────────────────────────
    {
      name: 'list_channels',
      description: 'List all channels in the server',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'create_channel',
      description: 'Create a new channel (text, voice, announcement, forum, etc.)',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Channel name' },
          type: {
            type: 'number',
            description: 'Channel type: 0=text, 2=voice, 5=announcement, 15=forum. Default: 0',
          },
          topic: { type: 'string', description: 'Channel topic/description' },
          category_id: { type: 'string', description: 'Parent category ID' },
          nsfw: { type: 'boolean', description: 'Mark as NSFW' },
          position: { type: 'number', description: 'Position in channel list' },
        },
        required: ['name'],
      },
    },
    {
      name: 'update_channel',
      description: "Update a channel's settings",
      inputSchema: {
        type: 'object',
        properties: {
          channel_id: { type: 'string', description: 'Channel ID' },
          name: { type: 'string', description: 'New name' },
          topic: { type: 'string', description: 'New topic' },
          nsfw: { type: 'boolean', description: 'NSFW flag' },
          position: { type: 'number', description: 'New position' },
          category_id: { type: 'string', description: 'New parent category ID' },
        },
        required: ['channel_id'],
      },
    },
    {
      name: 'delete_channel',
      description: 'Delete a channel',
      inputSchema: {
        type: 'object',
        properties: {
          channel_id: { type: 'string', description: 'Channel ID to delete' },
        },
        required: ['channel_id'],
      },
    },

    // ── CATEGORIES ─────────────────────────────────────────────────────────
    {
      name: 'create_category',
      description: 'Create a new channel category',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Category name' },
          position: { type: 'number', description: 'Position in the channel list' },
        },
        required: ['name'],
      },
    },

    // ── MESSAGES ───────────────────────────────────────────────────────────
    {
      name: 'send_message',
      description: 'Send a message to a channel',
      inputSchema: {
        type: 'object',
        properties: {
          channel_id: { type: 'string', description: 'Channel ID' },
          content: { type: 'string', description: 'Message text content' },
        },
        required: ['channel_id', 'content'],
      },
    },
    {
      name: 'fetch_messages',
      description: 'Fetch recent messages from a channel',
      inputSchema: {
        type: 'object',
        properties: {
          channel_id: { type: 'string', description: 'Channel ID' },
          limit: { type: 'number', description: 'Number of messages to fetch (1-100). Default: 50' },
        },
        required: ['channel_id'],
      },
    },
    {
      name: 'delete_message',
      description: 'Delete a specific message',
      inputSchema: {
        type: 'object',
        properties: {
          channel_id: { type: 'string', description: 'Channel ID' },
          message_id: { type: 'string', description: 'Message ID to delete' },
        },
        required: ['channel_id', 'message_id'],
      },
    },
    {
      name: 'pin_message',
      description: 'Pin a message in a channel',
      inputSchema: {
        type: 'object',
        properties: {
          channel_id: { type: 'string', description: 'Channel ID' },
          message_id: { type: 'string', description: 'Message ID to pin' },
        },
        required: ['channel_id', 'message_id'],
      },
    },

    // ── MEMBERS ────────────────────────────────────────────────────────────
    {
      name: 'list_members',
      description: 'List members in the server',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of members to retrieve (1-1000). Default: 100' },
        },
      },
    },
    {
      name: 'get_member_info',
      description: 'Get detailed information about a specific member',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'Discord user ID' },
        },
        required: ['user_id'],
      },
    },
    {
      name: 'kick_member',
      description: 'Kick a member from the server',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'Discord user ID to kick' },
          reason: { type: 'string', description: 'Reason for kick (appears in audit log)' },
        },
        required: ['user_id'],
      },
    },
    {
      name: 'ban_member',
      description: 'Ban a member from the server',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'Discord user ID to ban' },
          reason: { type: 'string', description: 'Reason for ban (appears in audit log)' },
          delete_message_days: {
            type: 'number',
            description: 'Number of days of messages to delete (0-7). Default: 0',
          },
        },
        required: ['user_id'],
      },
    },
    {
      name: 'unban_member',
      description: 'Remove a ban from a user',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'Discord user ID to unban' },
        },
        required: ['user_id'],
      },
    },

    // ── SERVER ─────────────────────────────────────────────────────────────
    {
      name: 'get_server_info',
      description: 'Get general information about the Discord server',
      inputSchema: { type: 'object', properties: {} },
    },

    // ── WEBHOOKS ───────────────────────────────────────────────────────────
    {
      name: 'list_webhooks',
      description: 'List all webhooks in the server',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'create_webhook',
      description: 'Create a webhook in a channel',
      inputSchema: {
        type: 'object',
        properties: {
          channel_id: { type: 'string', description: 'Channel ID to create webhook in' },
          name: { type: 'string', description: 'Webhook name' },
        },
        required: ['channel_id', 'name'],
      },
    },
    {
      name: 'delete_webhook',
      description: 'Delete a webhook',
      inputSchema: {
        type: 'object',
        properties: {
          webhook_id: { type: 'string', description: 'Webhook ID to delete' },
        },
        required: ['webhook_id'],
      },
    },

    // ── THREADS ────────────────────────────────────────────────────────────
    {
      name: 'list_active_threads',
      description: 'List all active threads in the server',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'create_thread',
      description: 'Create a thread in a channel (optionally from an existing message)',
      inputSchema: {
        type: 'object',
        properties: {
          channel_id: { type: 'string', description: 'Channel ID' },
          name: { type: 'string', description: 'Thread name' },
          message_id: {
            type: 'string',
            description: 'Message ID to create the thread from (optional)',
          },
          auto_archive_duration: {
            type: 'number',
            description: 'Minutes until auto-archive: 60, 1440, 4320, or 10080. Default: 1440',
          },
        },
        required: ['channel_id', 'name'],
      },
    },

    // ── INVITES ────────────────────────────────────────────────────────────
    {
      name: 'list_invites',
      description: 'List all active invites for the server',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'create_invite',
      description: 'Create an invite link for a channel',
      inputSchema: {
        type: 'object',
        properties: {
          channel_id: { type: 'string', description: 'Channel ID to create invite for' },
          max_age: {
            type: 'number',
            description: 'Duration in seconds before invite expires (0 = never). Default: 86400',
          },
          max_uses: {
            type: 'number',
            description: 'Maximum number of uses (0 = unlimited). Default: 0',
          },
          temporary: {
            type: 'boolean',
            description: 'Grant temporary membership (user kicked after leaving). Default: false',
          },
        },
        required: ['channel_id'],
      },
    },
    {
      name: 'delete_invite',
      description: 'Delete an invite link',
      inputSchema: {
        type: 'object',
        properties: {
          invite_code: { type: 'string', description: 'The invite code to delete (e.g. "abc123")' },
        },
        required: ['invite_code'],
      },
    },

    // ── AUDIT LOG ──────────────────────────────────────────────────────────
    {
      name: 'get_audit_log',
      description: 'Get the server audit log (history of moderation actions)',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of entries to retrieve (1-100). Default: 50' },
          action_type: { type: 'number', description: 'Filter by action type number (optional)' },
          user_id: { type: 'string', description: 'Filter by user who performed the action (optional)' },
        },
      },
    },
  ],
}));

// ─── Tool Handlers ────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, any>;

  try {
    let result: unknown;

    switch (name) {
      // ── ROLES ─────────────────────────────────────────────────────────────
      case 'list_roles':
        result = await rest.get(Routes.guildRoles(GUILD_ID));
        break;

      case 'create_role':
        result = await rest.post(Routes.guildRoles(GUILD_ID), {
          body: {
            name: a.name,
            ...(a.color !== undefined && { color: a.color }),
            ...(a.hoist !== undefined && { hoist: a.hoist }),
            ...(a.mentionable !== undefined && { mentionable: a.mentionable }),
            ...(a.permissions !== undefined && { permissions: a.permissions }),
          },
        });
        break;

      case 'update_role':
        result = await rest.patch(Routes.guildRole(GUILD_ID, a.role_id), {
          body: {
            ...(a.name !== undefined && { name: a.name }),
            ...(a.color !== undefined && { color: a.color }),
            ...(a.hoist !== undefined && { hoist: a.hoist }),
            ...(a.mentionable !== undefined && { mentionable: a.mentionable }),
            ...(a.permissions !== undefined && { permissions: a.permissions }),
          },
        });
        break;

      case 'delete_role':
        await rest.delete(Routes.guildRole(GUILD_ID, a.role_id));
        result = { success: true, message: `Role ${a.role_id} deleted` };
        break;

      case 'assign_role':
        await rest.put(Routes.guildMemberRole(GUILD_ID, a.user_id, a.role_id));
        result = { success: true, message: `Role ${a.role_id} assigned to ${a.user_id}` };
        break;

      case 'remove_role':
        await rest.delete(Routes.guildMemberRole(GUILD_ID, a.user_id, a.role_id));
        result = { success: true, message: `Role ${a.role_id} removed from ${a.user_id}` };
        break;

      // ── CHANNELS ──────────────────────────────────────────────────────────
      case 'list_channels':
        result = await rest.get(Routes.guildChannels(GUILD_ID));
        break;

      case 'create_channel':
        result = await rest.post(Routes.guildChannels(GUILD_ID), {
          body: {
            name: a.name,
            type: a.type ?? 0,
            ...(a.topic !== undefined && { topic: a.topic }),
            ...(a.category_id !== undefined && { parent_id: a.category_id }),
            ...(a.nsfw !== undefined && { nsfw: a.nsfw }),
            ...(a.position !== undefined && { position: a.position }),
          },
        });
        break;

      case 'update_channel':
        result = await rest.patch(Routes.channel(a.channel_id), {
          body: {
            ...(a.name !== undefined && { name: a.name }),
            ...(a.topic !== undefined && { topic: a.topic }),
            ...(a.nsfw !== undefined && { nsfw: a.nsfw }),
            ...(a.position !== undefined && { position: a.position }),
            ...(a.category_id !== undefined && { parent_id: a.category_id }),
          },
        });
        break;

      case 'delete_channel':
        await rest.delete(Routes.channel(a.channel_id));
        result = { success: true, message: `Channel ${a.channel_id} deleted` };
        break;

      // ── CATEGORIES ────────────────────────────────────────────────────────
      case 'create_category':
        result = await rest.post(Routes.guildChannels(GUILD_ID), {
          body: {
            name: a.name,
            type: 4,
            ...(a.position !== undefined && { position: a.position }),
          },
        });
        break;

      // ── MESSAGES ──────────────────────────────────────────────────────────
      case 'send_message':
        result = await rest.post(Routes.channelMessages(a.channel_id), {
          body: { content: a.content },
        });
        break;

      case 'fetch_messages':
        result = await rest.get(Routes.channelMessages(a.channel_id), {
          query: new URLSearchParams({ limit: String(a.limit ?? 50) }),
        });
        break;

      case 'delete_message':
        await rest.delete(Routes.channelMessage(a.channel_id, a.message_id));
        result = { success: true, message: 'Message deleted' };
        break;

      case 'pin_message':
        await rest.put(Routes.channelPin(a.channel_id, a.message_id));
        result = { success: true, message: 'Message pinned' };
        break;

      // ── MEMBERS ───────────────────────────────────────────────────────────
      case 'list_members':
        result = await rest.get(Routes.guildMembers(GUILD_ID), {
          query: new URLSearchParams({ limit: String(a.limit ?? 100) }),
        });
        break;

      case 'get_member_info':
        result = await rest.get(Routes.guildMember(GUILD_ID, a.user_id));
        break;

      case 'kick_member':
        await rest.delete(Routes.guildMember(GUILD_ID, a.user_id), {
          headers: a.reason ? { 'X-Audit-Log-Reason': a.reason } : {},
        });
        result = { success: true, message: `User ${a.user_id} kicked` };
        break;

      case 'ban_member':
        await rest.put(Routes.guildBan(GUILD_ID, a.user_id), {
          body: { delete_message_seconds: (a.delete_message_days ?? 0) * 86400 },
          headers: a.reason ? { 'X-Audit-Log-Reason': a.reason } : {},
        });
        result = { success: true, message: `User ${a.user_id} banned` };
        break;

      case 'unban_member':
        await rest.delete(Routes.guildBan(GUILD_ID, a.user_id));
        result = { success: true, message: `User ${a.user_id} unbanned` };
        break;

      // ── SERVER ────────────────────────────────────────────────────────────
      case 'get_server_info':
        result = await rest.get(Routes.guild(GUILD_ID));
        break;

      // ── WEBHOOKS ──────────────────────────────────────────────────────────
      case 'list_webhooks':
        result = await rest.get(Routes.guildWebhooks(GUILD_ID));
        break;

      case 'create_webhook':
        result = await rest.post(Routes.channelWebhooks(a.channel_id), {
          body: { name: a.name },
        });
        break;

      case 'delete_webhook':
        await rest.delete(Routes.webhook(a.webhook_id));
        result = { success: true, message: `Webhook ${a.webhook_id} deleted` };
        break;

      // ── THREADS ───────────────────────────────────────────────────────────
      case 'list_active_threads':
        result = await rest.get(Routes.guildActiveThreads(GUILD_ID));
        break;

      case 'create_thread':
        result = await rest.post(Routes.threads(a.channel_id, a.message_id), {
          body: {
            name: a.name,
            ...(a.message_id === undefined && { type: 11 }), // PUBLIC_THREAD for standalone
            auto_archive_duration: a.auto_archive_duration ?? 1440,
          },
        });
        break;

      // ── INVITES ───────────────────────────────────────────────────────────
      case 'list_invites':
        result = await rest.get(Routes.guildInvites(GUILD_ID));
        break;

      case 'create_invite':
        result = await rest.post(Routes.channelInvites(a.channel_id), {
          body: {
            max_age: a.max_age ?? 86400,
            max_uses: a.max_uses ?? 0,
            temporary: a.temporary ?? false,
          },
        });
        break;

      case 'delete_invite':
        await rest.delete(Routes.invite(a.invite_code));
        result = { success: true, message: `Invite ${a.invite_code} deleted` };
        break;

      // ── AUDIT LOG ─────────────────────────────────────────────────────────
      case 'get_audit_log': {
        const params = new URLSearchParams({ limit: String(a.limit ?? 50) });
        if (a.action_type !== undefined) params.set('action_type', String(a.action_type));
        if (a.user_id !== undefined) params.set('user_id', a.user_id);
        result = await rest.get(Routes.guildAuditLog(GUILD_ID), { query: params });
        break;
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error: any) {
    const message = error?.rawError?.message ?? error?.message ?? String(error);
    return {
      content: [{ type: 'text', text: `Discord API error: ${message}` }],
      isError: true,
    };
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Discord MCP server running');
