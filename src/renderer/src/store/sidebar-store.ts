import { create } from 'zustand'
import { getSidebarTree, type GroupNode, type SidebarNode } from '@renderer/data/workspaces'

export type DragKind = 'channel' | 'group'
export interface DragItem {
  type: DragKind
  id: string
}

function matches(node: SidebarNode, item: DragItem): boolean {
  return item.type === 'channel'
    ? node.type === 'channel' && node.channelId === item.id
    : node.type === 'group' && node.id === item.id
}

/** Remove the dragged node from anywhere in the tree; return the pruned tree + the node. */
function extract(
  nodes: SidebarNode[],
  item: DragItem
): { nodes: SidebarNode[]; removed: SidebarNode | null } {
  let removed: SidebarNode | null = null
  const result: SidebarNode[] = []
  for (const node of nodes) {
    if (matches(node, item)) {
      removed = node
      continue
    }
    if (node.type === 'group') {
      const inner = extract(node.children, item)
      if (inner.removed) removed = inner.removed
      result.push({ ...node, children: inner.nodes })
    } else {
      result.push(node)
    }
  }
  return { nodes: result, removed }
}

/** Insert `node` immediately before `target`, wherever `target` lives. */
function insertBefore(nodes: SidebarNode[], target: DragItem, node: SidebarNode): SidebarNode[] {
  const idx = nodes.findIndex((n) => matches(n, target))
  if (idx !== -1) {
    const copy = nodes.slice()
    copy.splice(idx, 0, node)
    return copy
  }
  return nodes.map((n) =>
    n.type === 'group' ? { ...n, children: insertBefore(n.children, target, node) } : n
  )
}

/** Prepend `node` into the group with `groupId`. */
function insertIntoGroup(nodes: SidebarNode[], groupId: string, node: SidebarNode): SidebarNode[] {
  return nodes.map((n) => {
    if (n.type !== 'group') return n
    if (n.id === groupId) return { ...n, children: [node, ...n.children] }
    return { ...n, children: insertIntoGroup(n.children, groupId, node) }
  })
}

function findGroup(nodes: SidebarNode[], id: string): GroupNode | null {
  for (const node of nodes) {
    if (node.type === 'group') {
      if (node.id === id) return node
      const found = findGroup(node.children, id)
      if (found) return found
    }
  }
  return null
}

function subtreeContains(group: GroupNode, target: DragItem): boolean {
  for (const child of group.children) {
    if (matches(child, target)) return true
    if (child.type === 'group' && subtreeContains(child, target)) return true
  }
  return false
}

interface SidebarStore {
  /** Per-server override of the sidebar tree once the user reorders it. */
  trees: Record<string, SidebarNode[]>
  /** The node currently being dragged (drives the drop indicators). */
  dragItem: DragItem | null
  beginDrag: (item: DragItem) => void
  endDrag: () => void
  move: (serverId: string, dragged: DragItem, target: DragItem) => void
}

export const useSidebarStore = create<SidebarStore>((set, get) => ({
  trees: {},
  dragItem: null,
  beginDrag: (item) => set({ dragItem: item }),
  endDrag: () => set({ dragItem: null }),
  move: (serverId, dragged, target) => {
    if (dragged.type === target.type && dragged.id === target.id) return
    const current = get().trees[serverId] ?? getSidebarTree(serverId)

    // Never drop a group into itself or one of its descendants.
    if (dragged.type === 'group') {
      const group = findGroup(current, dragged.id)
      if (group && subtreeContains(group, target)) return
    }

    const { nodes: without, removed } = extract(current, dragged)
    if (!removed) return

    let next: SidebarNode[]
    if (target.type === 'channel') {
      // Drop on a channel → place before it (within-group reorder OR cross-group move).
      next = insertBefore(without, target, removed)
    } else if (dragged.type === 'channel') {
      // Channel dropped on a group header → move into that group.
      next = insertIntoGroup(without, target.id, removed)
    } else {
      // Group dropped on a group header → reorder before it.
      next = insertBefore(without, target, removed)
    }

    set((state) => ({ trees: { ...state.trees, [serverId]: next } }))
  }
}))
