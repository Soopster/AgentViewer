export type TreeNode = {
  name: string
  path: string
  kind: 'directory' | 'file'
  children: TreeNode[]
}

// Reuse ICU collation state across comparisons and tree refreshes.
export const compareEditorPaths = new Intl.Collator(undefined, { numeric: true }).compare

export function buildEditorFileTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', kind: 'directory', children: [] }
  // Construction-only indexes keep wide directories linear to build. They are
  // discarded with this call rather than retained alongside the rendered tree.
  const childrenByParent = new Map<TreeNode, Map<string, TreeNode>>()
  for (const filePath of paths) {
    const parts = filePath.split('/').filter(Boolean)
    let parent = root
    let nodePath = ''
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index]!
      nodePath = index === 0 ? name : `${nodePath}/${name}`
      let children = childrenByParent.get(parent)
      if (!children) {
        children = new Map()
        childrenByParent.set(parent, children)
      }
      let child = children.get(name)
      if (!child) {
        child = { name, path: nodePath, kind: index === parts.length - 1 ? 'file' : 'directory', children: [] }
        children.set(name, child)
        parent.children.push(child)
      }
      parent = child
    }
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.kind === b.kind ? compareEditorPaths(a.name, b.name) : a.kind === 'directory' ? -1 : 1)
    for (const node of nodes) if (node.children.length > 0) sort(node.children)
  }
  sort(root.children)
  return root.children
}
