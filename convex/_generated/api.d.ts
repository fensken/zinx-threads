/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as apiTools from "../apiTools.js";
import type * as boards from "../boards.js";
import type * as bots from "../bots.js";
import type * as channelMembers from "../channelMembers.js";
import type * as channels from "../channels.js";
import type * as cleanup from "../cleanup.js";
import type * as crons from "../crons.js";
import type * as dms from "../dms.js";
import type * as email from "../email.js";
import type * as events from "../events.js";
import type * as files from "../files.js";
import type * as gifs from "../gifs.js";
import type * as groups from "../groups.js";
import type * as http from "../http.js";
import type * as inbox from "../inbox.js";
import type * as invitations from "../invitations.js";
import type * as lib_activity from "../lib/activity.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_boardSeed from "../lib/boardSeed.js";
import type * as lib_brand from "../lib/brand.js";
import type * as lib_channelMembers from "../lib/channelMembers.js";
import type * as lib_channels from "../lib/channels.js";
import type * as lib_demoSeed from "../lib/demoSeed.js";
import type * as lib_dms from "../lib/dms.js";
import type * as lib_mcp from "../lib/mcp.js";
import type * as lib_mcpAuth from "../lib/mcpAuth.js";
import type * as lib_messages from "../lib/messages.js";
import type * as lib_notifications from "../lib/notifications.js";
import type * as lib_post from "../lib/post.js";
import type * as lib_reactions from "../lib/reactions.js";
import type * as lib_recurrence from "../lib/recurrence.js";
import type * as lib_threads from "../lib/threads.js";
import type * as lib_tokens from "../lib/tokens.js";
import type * as lib_unread from "../lib/unread.js";
import type * as mcp from "../mcp.js";
import type * as members from "../members.js";
import type * as messages from "../messages.js";
import type * as migrations from "../migrations.js";
import type * as pages from "../pages.js";
import type * as presence from "../presence.js";
import type * as rateLimiter from "../rateLimiter.js";
import type * as resend from "../resend.js";
import type * as sharedChannels from "../sharedChannels.js";
import type * as threads from "../threads.js";
import type * as unread from "../unread.js";
import type * as unsplash from "../unsplash.js";
import type * as users from "../users.js";
import type * as voice from "../voice.js";
import type * as whiteboards from "../whiteboards.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  apiTools: typeof apiTools;
  boards: typeof boards;
  bots: typeof bots;
  channelMembers: typeof channelMembers;
  channels: typeof channels;
  cleanup: typeof cleanup;
  crons: typeof crons;
  dms: typeof dms;
  email: typeof email;
  events: typeof events;
  files: typeof files;
  gifs: typeof gifs;
  groups: typeof groups;
  http: typeof http;
  inbox: typeof inbox;
  invitations: typeof invitations;
  "lib/activity": typeof lib_activity;
  "lib/auth": typeof lib_auth;
  "lib/boardSeed": typeof lib_boardSeed;
  "lib/brand": typeof lib_brand;
  "lib/channelMembers": typeof lib_channelMembers;
  "lib/channels": typeof lib_channels;
  "lib/demoSeed": typeof lib_demoSeed;
  "lib/dms": typeof lib_dms;
  "lib/mcp": typeof lib_mcp;
  "lib/mcpAuth": typeof lib_mcpAuth;
  "lib/messages": typeof lib_messages;
  "lib/notifications": typeof lib_notifications;
  "lib/post": typeof lib_post;
  "lib/reactions": typeof lib_reactions;
  "lib/recurrence": typeof lib_recurrence;
  "lib/threads": typeof lib_threads;
  "lib/tokens": typeof lib_tokens;
  "lib/unread": typeof lib_unread;
  mcp: typeof mcp;
  members: typeof members;
  messages: typeof messages;
  migrations: typeof migrations;
  pages: typeof pages;
  presence: typeof presence;
  rateLimiter: typeof rateLimiter;
  resend: typeof resend;
  sharedChannels: typeof sharedChannels;
  threads: typeof threads;
  unread: typeof unread;
  unsplash: typeof unsplash;
  users: typeof users;
  voice: typeof voice;
  whiteboards: typeof whiteboards;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  r2: import("@convex-dev/r2/_generated/component.js").ComponentApi<"r2">;
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
  presence: import("@convex-dev/presence/_generated/component.js").ComponentApi<"presence">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
