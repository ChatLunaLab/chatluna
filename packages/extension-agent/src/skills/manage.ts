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
    if (!(await stat(dir).catch(() => undefined))?.isDirectory()) {
        throw new Error('Skill directory was not found')
    }

    const name = basename(dir)

    return {
        id,
        name,
        fileName: `${name}.zip`,
        data: Buffer.from(
            zipSync(
                Object.fromEntries(
                    await Promise.all(
                        (await collectFilesRecursive(dir)).map(async (file) => [
                            `${name}/${relative(dir, file).replaceAll('\\', '/')}`,
                            await readFile(file)
                        ])
                    )
                )
            )
        ).toString('base64')
    }
}

export async function removeSkillDirectory(root: string, dir: string) {
    if (!isPathInside(resolve(dir), root)) {
        throw new Error(
            'Only skills inside data/chatluna/skills can be removed'
        )
    }

    await rm(resolve(dir), { recursive: true, force: true })
}
