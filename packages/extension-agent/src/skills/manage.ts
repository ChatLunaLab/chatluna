/** @module skills/manage */

import { zipSync } from 'fflate'
import { readFile, rm, stat } from 'fs/promises'
import { basename, relative, resolve } from 'path'
import { SkillExportResult } from '../types'
import { collectFilesRecursive } from '../utils/fs'
import { isPathInside } from '../utils/path'

export async function exportSkillArchive(
    id: string,
    dir: string
): Promise<SkillExportResult> {
    const info = await stat(dir).catch(() => undefined)
    if (!info?.isDirectory()) {
        throw new Error('Skill directory was not found')
    }

    const name = basename(dir)
    const files = await collectFilesRecursive(dir)
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

    if (!isPathInside(target, root)) {
        throw new Error(
            'Only skills inside data/chatluna/skills can be removed'
        )
    }

    await rm(target, { recursive: true, force: true })
}
