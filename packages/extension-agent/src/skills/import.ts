import { unzipSync } from 'fflate'
import { cp, mkdir, readdir, rm, stat, writeFile } from 'fs/promises'
import { Context } from 'koishi'
import { basename, dirname, join, resolve } from 'path'
import { randomUUID } from 'crypto'
import { getSkillsRootPath } from '../config/path'
import { SkillImportInput, SkillImportResult } from '../types'

export async function importSkills(
    ctx: Context,
    input: SkillImportInput
): Promise<SkillImportResult> {
    const tmp = resolve(
        ctx.baseDir,
        'data/chatluna/agent/tmp',
        `skills-${randomUUID()}`
    )

    await mkdir(tmp, { recursive: true })

    try {
        const source = await materializeImportSource(ctx, input, tmp)
        const dirs = await findSkillDirs(source.root)

        if (dirs.length < 1) {
            throw new Error(
                'No skill directories were found in the imported source'
            )
        }

        const result: SkillImportResult = {
            source: input.type,
            imported: [],
            replaced: [],
            diagnostics: [...source.diagnostics]
        }
        const skillsRoot = getSkillsRootPath(ctx)

        await mkdir(skillsRoot, { recursive: true })

        for (const dir of dirs) {
            const name = basename(dir)
            const dest = join(skillsRoot, name)
            const existed = (
                await stat(dest).catch(() => undefined)
            )?.isDirectory()

            await rm(dest, { recursive: true, force: true })
            await mkdir(dirname(dest), { recursive: true })
            await cp(dir, dest, { recursive: true })

            result.imported.push(name)
            if (existed) {
                result.replaced.push(name)
            }
        }

        result.imported = Array.from(new Set(result.imported)).sort((a, b) =>
            a.localeCompare(b)
        )
        result.replaced = Array.from(new Set(result.replaced)).sort((a, b) =>
            a.localeCompare(b)
        )

        return result
    } finally {
        await rm(tmp, { recursive: true, force: true }).catch(() => {})
    }
}

async function materializeImportSource(
    ctx: Context,
    input: SkillImportInput,
    tmp: string
): Promise<{ root: string; diagnostics: string[] }> {
    if (input.type === 'github') {
        return importFromGithub(ctx, input.url, tmp)
    }

    if (input.type === 'zip') {
        const root = join(tmp, stripExt(input.name) || 'archive')
        await mkdir(root, { recursive: true })
        await unzipToDir(Buffer.from(input.data, 'base64'), root)
        return { root, diagnostics: [] }
    }

    const root = join(tmp, input.name || 'folder')
    await mkdir(root, { recursive: true })

    for (const file of input.files) {
        const target = resolveSafe(root, file.path)
        if (!target) {
            continue
        }

        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, Buffer.from(file.data, 'base64'))
    }

    return { root, diagnostics: [] }
}

async function importFromGithub(ctx: Context, url: string, tmp: string) {
    const info = parseGithubUrl(url)
    const diagnostics: string[] = []

    if (!info) {
        throw new Error('Unsupported GitHub URL')
    }

    const root = join(tmp, `${info.owner}-${info.repo}`)
    await mkdir(root, { recursive: true })

    const response = await ctx.http(info.zipUrl, {
        responseType: 'arraybuffer',
        method: 'get',
        headers: {
            'User-Agent': 'ChatLuna-Agent'
        }
    })

    await unzipToDir(Buffer.from(response.data), root)

    const searchRoot = info.subpath
        ? await findSubpathRoot(root, info.subpath)
        : undefined

    if (info.subpath && !searchRoot) {
        diagnostics.push(
            `GitHub subpath '${info.subpath}' was not found, scanned the whole archive instead`
        )
    }

    return {
        root: searchRoot ?? root,
        diagnostics
    }
}

async function unzipToDir(buffer: Buffer, root: string) {
    const files = unzipSync(new Uint8Array(buffer))

    for (const [name, value] of Object.entries(files)) {
        const target = resolveSafe(root, name)
        if (!target || name.endsWith('/')) {
            continue
        }

        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, Buffer.from(value))
    }
}

async function findSubpathRoot(root: string, subpath: string) {
    const clean = subpath.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
    if (clean.length < 1) {
        return root
    }

    const queue = [root]

    while (queue.length > 0) {
        const current = queue.shift()
        if (!current) {
            continue
        }

        const target = join(current, ...clean.split('/'))
        const info = await stat(target).catch(() => undefined)
        if (info?.isDirectory()) {
            return target
        }

        const entries = await readdir(current, { withFileTypes: true }).catch(
            () => []
        )

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue
            }

            queue.push(join(current, entry.name))
        }
    }

    return undefined
}

async function findSkillDirs(root: string) {
    const queue = [root]
    const result = new Set<string>()

    while (queue.length > 0) {
        const current = queue.shift()
        if (!current) {
            continue
        }

        const entries = await readdir(current, { withFileTypes: true }).catch(
            () => []
        )
        const hasSkill = entries.some(
            (entry) => entry.isFile() && entry.name === 'SKILL.md'
        )

        if (hasSkill) {
            result.add(current)
            continue
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue
            }

            if (entry.name === '.git' || entry.name === 'node_modules') {
                continue
            }

            queue.push(join(current, entry.name))
        }
    }

    return Array.from(result).sort((a, b) => a.localeCompare(b))
}

function parseGithubUrl(url: string) {
    let parsed: URL

    try {
        parsed = new URL(url)
    } catch {
        return undefined
    }

    if (parsed.hostname !== 'github.com') {
        return undefined
    }

    const parts = parsed.pathname
        .replace(/\.git$/, '')
        .split('/')
        .filter(Boolean)

    if (parts.length < 2) {
        return undefined
    }

    const owner = parts[0]
    const repo = parts[1]

    if (owner.length < 1 || repo.length < 1) {
        return undefined
    }

    if (parts[2] === 'tree' && parts[3]) {
        const ref = parts[3]
        const subpath = parts.slice(4).join('/')

        return {
            owner,
            repo,
            zipUrl: `https://api.github.com/repos/${owner}/${repo}/zipball/${ref}`,
            subpath
        }
    }

    return {
        owner,
        repo,
        zipUrl: `https://api.github.com/repos/${owner}/${repo}/zipball`,
        subpath: ''
    }
}

function resolveSafe(root: string, file: string) {
    const target = resolve(root, file)
    const base = resolve(root)

    if (
        target === base ||
        target.startsWith(`${base}/`) ||
        target.startsWith(`${base}\\`)
    ) {
        return target
    }

    return undefined
}

function stripExt(name: string) {
    return name.replace(/\.[^.]+$/, '')
}
