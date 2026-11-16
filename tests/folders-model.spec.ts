/**
 * Unit tests for the folder-tree model.
 * @module @alexpeng/dsh-custom-plugin/tests/folders-model
 */

import { describe, expect, it } from 'vitest'
import type { FolderNode } from '../src/protocol.ts'
import {
  addFolder,
  deleteFolder,
  filterFolders,
  findFolder,
  folderCount,
  moveFolder,
  moveFolderOrder,
  renameFolder,
} from '../src/client/ui/folders-model.ts'

function node(id: string, name: string, children: FolderNode[] = [], extra: Partial<FolderNode> = {}): FolderNode {
  return { id, name, children, sessionIds: [], workspaceIds: [], prompts: [], ...extra }
}

describe('findFolder / folderCount', () => {
  const tree = [node('a', 'A', [node('b', 'B', [], { sessionIds: ['s1'] })], { workspaceIds: ['w1'] })]
  it('finds nested nodes', () => {
    expect(findFolder(tree, 'b')?.name).toBe('B')
    expect(findFolder(tree, 'missing')).toBeNull()
  })
  it('counts own and descendant refs', () => {
    expect(folderCount(tree[0])).toBe(2)
  })
})

describe('addFolder / renameFolder / deleteFolder', () => {
  const tree = [node('a', 'A')]
  it('adds at the root and under a parent', () => {
    const root = addFolder(tree, null, node('b', 'B'))
    expect(root.map((item) => item.id)).toEqual(['a', 'b'])
    const nested = addFolder(tree, 'a', node('c', 'C'))
    expect(nested[0].children.map((item) => item.id)).toEqual(['c'])
  })
  it('renames and rejects blank names', () => {
    expect(renameFolder(tree, 'a', '  New  ')[0].name).toBe('New')
    expect(renameFolder(tree, 'a', '   ')[0].name).toBe('A')
  })
  it('deletes a subtree', () => {
    const nested = [node('a', 'A', [node('b', 'B')])]
    expect(deleteFolder(nested, 'b')[0].children).toEqual([])
  })
})

describe('moveFolder', () => {
  const tree = [node('a', 'A', [node('a1', 'A1')]), node('b', 'B')]
  it('moves before, after and inside', () => {
    expect(moveFolder(tree, 'b', 'a', 'before').map((item) => item.id)).toEqual(['b', 'a'])
    expect(moveFolder(tree, 'b', 'a', 'after').map((item) => item.id)).toEqual(['a', 'b'])
    expect(moveFolder(tree, 'b', 'a', 'inside')[0].children.map((item) => item.id)).toEqual(['a1', 'b'])
  })
  it('refuses self moves and cycles', () => {
    expect(moveFolder(tree, 'a', 'a', 'inside').map((item) => item.id)).toEqual(['a', 'b'])
    expect(moveFolder(tree, 'a', 'a1', 'inside').map((item) => item.id)).toEqual(['a', 'b'])
  })
  it('moves within the sibling list', () => {
    expect(moveFolderOrder(tree, 'b', -1).map((item) => item.id)).toEqual(['b', 'a'])
    expect(moveFolderOrder(tree, 'a1', -1)[0].children.map((item) => item.id)).toEqual(['a1'])
  })
})

describe('filterFolders', () => {
  const tree = [node('a', '工作', [node('b', '周报')]), node('c', '生活')]
  it('keeps ancestors of matching descendants', () => {
    expect(filterFolders(tree, '周报').map((item) => item.id)).toEqual(['a'])
  })
  it('matches referenced ids', () => {
    const withRef = [node('a', 'A', [], { sessionIds: ['session-42'] })]
    expect(filterFolders(withRef, '42').map((item) => item.id)).toEqual(['a'])
  })
  it('returns the full forest for an empty query', () => {
    expect(filterFolders(tree, '  ').map((item) => item.id)).toEqual(['a', 'c'])
  })
})
