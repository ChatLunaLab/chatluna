import type { SkillImportPreviewEntry } from '../../../src/types'

export interface ImportTreeNode {
    key: string
    label: string
    type: 'directory' | 'file'
    children?: ImportTreeNode[]
}

export function buildImportTree(entries: SkillImportPreviewEntry[]) {
    const roots: ImportTreeNode[] = []
    const nodes = new Map<string, ImportTreeNode>()

    for (const item of entries) {
        const parts = item.path.split('/').filter(Boolean)
        let list = roots
        let path = ''

        for (let idx = 0; idx < parts.length; idx++) {
            path = path ? `${path}/${parts[idx]}` : parts[idx]
            const type = idx === parts.length - 1 ? item.type : 'directory'
            let node = nodes.get(path)

            if (!node) {
                node = {
                    key: path,
                    label: parts[idx],
                    type,
                    children: type === 'directory' ? [] : undefined
                }
                nodes.set(path, node)
                list.push(node)
            }

            if (node.type === 'directory') {
                node.children ??= []
                list = node.children
            }
        }
    }

    sortTree(roots)
    return roots
}

function sortTree(nodes: ImportTreeNode[]) {
    nodes.sort((a, b) => {
        if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1
        }

        return a.label.localeCompare(b.label)
    })

    for (const node of nodes) {
        if (node.children && node.children.length > 0) {
            sortTree(node.children)
        }
    }
}
