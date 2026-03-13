import { zipSync } from 'fflate'
import { readFile, readdir, rm, stat } from 'fs/promises'
import { basename, join, relative, resolve } from 'path'
import { SkillExportResult } from '../types'

export async function exportSkillArchive(
    id: string,
    dir: string
): Promise<SkillExportResult> {
    const info = await stat(dir).catch(() => undefined)
    if (!info?.isDirectory()) {
        throw new Error('Skill directory was not found')
    }

    const name = basename(dir)
    const files = await collectFiles(dir)
    const archive = zipSync(
        Object.fromEntries(
            await Promise.all(
                files.map(async (file) => {
                    const rel = relative(dir, file).replaceAll('\\', '/')
                    return [`${name}/${rel}`, await readFile(file)]
                })
            )
        )
    )

    return {
        id,
        name,
        fileName: `${name}.zip`,
        data: Buffer.from(archive).toString('base64')
    }
}

export async function removeSkillDirectory(root: string, dir: string) {
    const target = resolve(dir)
    const base = resolve(root)

    if (
        !target.startsWith(`${base}\\`) &&
        !target.startsWith(`${base}/`) &&
        target !== base
    ) {
        throw new Error(
            'Only skills inside data/chatluna/skills can be removed'
        )
    }

    await rm(target, { recursive: true, force: true })
}

async function collectFiles(root: string): Promise<string[]> {
    const result: string[] = []
    const queue = [root]

    while (queue.length > 0) {
        const current = queue.shift()
        if (!current) {
            continue
        }

        const entries = await readdir(current, { withFileTypes: true })

        for (const entry of entries) {
            const file = join(current, entry.name)

            if (entry.isDirectory()) {
                if (entry.name === '.git' || entry.name === 'node_modules') {
                    continue
                }

                queue.push(file)
                continue
            }

            if (entry.isFile()) {
                result.push(file)
            }
        }
    }

    return result.sort((a, b) => a.localeCompare(b))
}
