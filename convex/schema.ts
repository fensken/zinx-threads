import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

// zinx-threads Convex schema.
//
// This starts with the *identity* model only — deliberately provider-agnostic so
// WorkOS AuthKit (and later enterprise SSO/SCIM) maps on cleanly without a
// rewrite. The app's chat tables (workspaces' channels, messages, threads, …)
// currently live as mock data in `src/renderer/src/data/workspaces.ts`; port
// them here table-by-table as the backend comes online.
//
// The key SSO-ready choices:
//  • `users.externalId` + `users.provider` — the bridge between the IdP-issued
//    JWT subject and our own row. WorkOS user id today; any IdP tomorrow.
//  • `workspaces.organizationId` — WorkOS Organization id when a workspace is an
//    enterprise org (enables per-org SSO + SCIM); null for self-serve workspaces.
//  • `workspaceMembers.directoryUserId` — SCIM directory user id, so automated
//    de-provisioning can find + deactivate the member.
//  • `roles.groupKeys` — maps IdP/SCIM group names → an app role (group-to-role).
export default defineSchema({
  users: defineTable({
    externalId: v.string(), // provider-issued user id (JWT subject)
    provider: v.string(), // "workos" (future: other IdPs)
    email: v.string(),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string())
  })
    .index('by_external_id', ['externalId'])
    .index('by_email', ['email']),

  workspaces: defineTable({
    name: v.string(),
    slug: v.string(),
    organizationId: v.optional(v.string()) // WorkOS Organization id (enterprise)
  })
    .index('by_slug', ['slug'])
    .index('by_organization', ['organizationId']),

  roles: defineTable({
    workspaceId: v.id('workspaces'),
    key: v.string(), // "owner" | "admin" | "member" | custom
    name: v.string(),
    groupKeys: v.optional(v.array(v.string())) // IdP/SCIM group → this role
  }).index('by_workspace', ['workspaceId']),

  workspaceMembers: defineTable({
    workspaceId: v.id('workspaces'),
    userId: v.id('users'),
    roleId: v.id('roles'),
    directoryUserId: v.optional(v.string()), // SCIM directory user id
    active: v.boolean() // SCIM active:false → deactivated
  })
    .index('by_workspace', ['workspaceId'])
    .index('by_user', ['userId'])
    .index('by_workspace_user', ['workspaceId', 'userId'])
})
