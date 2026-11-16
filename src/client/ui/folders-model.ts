/**
 * Pure folder-tree operations. The panel renders the result; every mutation
 * here returns a new tree so the caller can persist it in one write.
 * @module @alexpeng/dsh-custom-plugin/client/ui/folders-model
 */

import type { FolderNode } from '../../protocol.ts'

export type MoveZone = 'before' | 'inside' | 'after'

function cloneNode(node: FolderNode): FolderNode {
  return {
    ...node,
    children: (node.children ?? []).map(cloneNode),
    sessionIds: (node.sessionIds ?? []).slice(),
    workspaceIds: (node.workspaceIds ?? []).slice(),
    prompts: (node.prompts ?? []).slice(),
  }
}

/** Deep copy of a forest. */
export function cloneFolders(nodes: readonly FolderNode[]): FolderNode[] {
  return nodes.map(cloneNode)
}

/** Find one node by id anywhere in the forest. */
export function findFolder(nodes: readonly FolderNode[], id: string): FolderNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const child = findFolder(node.children ?? [], id)
    if (child !== null) return child
  }
  return null
}

/** Total descendants + own refs, used by the count badge. */
export function folderCount(node: FolderNode): number {
  let count = (node.sessionIds ?? []).length + (node.workspaceIds ?? []).length + (node.prompts ?? []).length
  for (const child of node.children ?? []) count += folderCount(child)
  return count
}

/** Append a node under `parentId`, or at the root when `parentId` is null. */
export function addFolder(nodes: readonly FolderNode[], parentId: string | null, node: FolderNode): FolderNode[] {
  const next = cloneFolders(nodes)
  if (parentId === null) { next.push(node); return next }
  const parent = findFolder(next, parentId)
  if (parent === null) return next
  parent.children = (parent.children ?? []).concat(node)
  return next
}

/** Rename one node; an empty name is rejected. */
export function renameFolder(nodes: readonly FolderNode[], id: string, name: string): FolderNode[] {
  const trimmed = name.trim()
  if (trimmed === '') return cloneFolders(nodes)
  const next = cloneFolders(nodes)
  const target = findFolder(next, id)
  if (target !== null) target.name = trimmed
  return next
}

/** Remove one node and its subtree. */
export function deleteFolder(nodes: readonly FolderNode[], id: string): FolderNode[] {
  const next = cloneFolders(nodes)
  const cut = (list: FolderNode[]): boolean => {
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) { list.splice(i, 1); return true }
      if (cut(list[i].children ?? [])) return true
    }
    return false
  }
  cut(next)
  return next
}

/** True when `candidateId` is `ancestorId` or lives inside its subtree. */
export function isDescendant(nodes: readonly FolderNode[], ancestorId: string, candidateId: string): boolean {
  const ancestor = findFolder(nodes, ancestorId)
  if (ancestor === null) return false
  return findFolder(ancestor.children ?? [], candidateId) !== null
}

/** Move a folder relative to another. Refuses cycles and self moves. */
export function moveFolder(
  nodes: readonly FolderNode[],
  sourceId: string,
  targetId: string,
  zone: MoveZone,
): FolderNode[] {
  if (sourceId === targetId) return cloneFolders(nodes)
  if (isDescendant(nodes, sourceId, targetId)) return cloneFolders(nodes)
  const next = cloneFolders(nodes)
  let source: FolderNode | null = null
  const take = (list: FolderNode[]): boolean => {
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === sourceId) { source = list.splice(i, 1)[0]; return true }
      if (take(list[i].children ?? [])) return true
    }
    return false
  }
  const place = (list: FolderNode[]): boolean => {
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === targetId) {
        if (zone === 'inside') (list[i].children = list[i].children ?? []).push(source as FolderNode)
        else list.splice(zone === 'before' ? i : i + 1, 0, source as FolderNode)
        return true
      }
      if (place(list[i].children ?? [])) return true
    }
    return false
  }
  if (take(next) && place(next)) return next
  return cloneFolders(nodes)
}

/** Move within the current sibling list by one position (keyboard path). */
export function moveFolderOrder(nodes: readonly FolderNode[], id: string, direction: -1 | 1): FolderNode[] {
  const next = cloneFolders(nodes)
  const walk = (list: FolderNode[]): boolean => {
    const index = list.findIndex((item) => item.id === id)
    if (index >= 0) {
      const target = index + direction
      if (target < 0 || target >= list.length) return true
      const [moved] = list.splice(index, 1)
      list.splice(target, 0, moved)
      return true
    }
    return list.some((item) => walk(item.children ?? []))
  }
  walk(next)
  return next
}

/**
 * Filter the forest by a free-text query against folder names and referenced
 * ids. A folder survives when it or any descendant matches; matching subtrees
 * keep their original shape.
 */
export function filterFolders(nodes: readonly FolderNode[], query: string): FolderNode[] {
  const q = query.trim().toLowerCase()
  if (q === '') return nodes.slice()
  const walk = (list: readonly FolderNode[]): FolderNode[] => {
    const out: FolderNode[] = []
    for (const node of list) {
      const children = walk(node.children ?? [])
      const refs = [...(node.sessionIds ?? []), ...(node.workspaceIds ?? []), ...(node.prompts ?? [])]
      const selfMatch = node.name.toLowerCase().includes(q) || refs.some((ref) => String(ref).toLowerCase().includes(q))
      if (selfMatch || children.length > 0) out.push({ ...node, children })
    }
    return out
  }
  return walk(nodes)
}
