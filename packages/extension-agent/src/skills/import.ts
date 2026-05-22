/** @module skills/import */

import { randomUUID } from 'crypto'
import { unzipSync } from 'fflate'
import { cp, mkdir, rm, stat, writeFile } from 'fs/promises'
import { Context } from 'koishi'
import type {} from '@koishijs/plugin-proxy-agent'
import { basename, dirname, join, resolve } from 'path'
import { getSkillsRootPath } from '../config/path'
import {
    SkillImportInput,
    SkillImportPreviewEntry,
    SkillImportPreviewItem,
    SkillImportPreviewResult,
    SkillImportResult
} from '../types'
import { scanSkillRoot } from '../skills/scan'
import { collectFilesRecursive, resolveSafe } from '../utils/fs'

export async function previewSkillsImport(
    ctx: Context,
    input: SkillImportInput
): Promise<SkillImportPreviewResult> {
    if (input.type === 'github') {
        return await previewGithub(ctx, input.url)
    }

    const tmp = resolve(
        ctx.baseDir,
        'data/chatluna/agent/tmp',
        `skills-${randomUUID()}`
    )

    await mkdir(tmp, { recursive: true })

    try {
        const source = await materializeImportSource(ctx, input, tmp)

        return await previewMaterializedSource(
            ctx,
            source.root,
            input.type,
            input.name,
            source.diagnostics
        )
    } finally {
        await rm(tmp, { recursive: true, force: true }).catch(() => {})
    }
}

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
        const preview = await previewMaterializedSource(
            ctx,
            source.root,
            input.type,
            input.type === 'zip'
                ? stripExt(input.name)
                : input.type === 'folder'
                  ? input.name
                  : basename(source.root),
            source.diagnostics
        )

        if (preview.skills.length < 1) {
            throw new Error('导入源中没有找到可用的 Skill 包。')
        }

        const selected = new Set(
            input.selected ?? preview.skills.map((item) => item.dir)
        )
        const picked = preview.skills.filter((item) => selected.has(item.dir))

        if (picked.length < 1) {
            throw new Error('请至少勾选一个要导入的 Skill。')
        }

        if (picked.some((item) => item.state !== 'ready')) {
            throw new Error(
                '已勾选的 Skill 里存在校验失败项，请取消勾选或先修复。'
            )
        }

        const duplicate = picked.find(
            (item, idx) =>
                picked.findIndex(
                    (next) => next.importName === item.importName
                ) !== idx
        )
        if (duplicate) {
            throw new Error(
                `导入列表里存在重复目标目录：${duplicate.importName}`
            )
        }

        const result: SkillImportResult = {
            source: input.type,
            imported: [],
            replaced: [],
            diagnostics: [...preview.diagnostics]
        }
        const skillsRoot = getSkillsRootPath(ctx)

        await mkdir(skillsRoot, { recursive: true })

        for (const item of picked) {
            const dir = join(source.root, item.dir === '.' ? '' : item.dir)
            const dest = join(skillsRoot, item.importName)
            const existed = (
                await stat(dest).catch(() => undefined)
            )?.isDirectory()

            await rm(dest, { recursive: true, force: true })
            await cp(dir, dest, { recursive: true })

            result.imported.push(item.importName)
            if (existed) {
                result.replaced.push(item.importName)
            }
        }

        if (picked.length < preview.skills.length) {
            result.diagnostics.push(
                `已跳过 ${preview.skills.length - picked.length} 个未勾选的 Skill。`
            )
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

async function previewMaterializedSource(
    ctx: Context,
    root: string,
    source: SkillImportInput['type'],
    target: string,
    diagnostics: string[]
): Promise<SkillImportPreviewResult> {
    const entries = await collectPreviewEntries(root)
    const scanned = await scanSkillRoot(root, ctx)
    const skills = scanned.map((item): SkillImportPreviewItem => {
        const dir = item.dir
            .slice(root.length)
            .replaceAll('\\', '/')
            .replace(/^\/+/, '')
        const importName = basename(item.dir)

        return {
            dir: dir || '.',
            importName,
            name: item.name,
            description: item.description,
            state: item.state,
            exists: false,
            diagnostics: item.diagnostics
        }
    })
    const counts = new Map<string, number>()

    for (const item of skills) {
        counts.set(item.importName, (counts.get(item.importName) ?? 0) + 1)
    }

    const skillsRoot = getSkillsRootPath(ctx)
    for (const item of skills) {
        if ((counts.get(item.importName) ?? 0) > 1) {
            item.state = 'invalid'
            item.diagnostics = [
                `重复的导入目录名：${item.importName}`,
                ...item.diagnostics
            ]
        }

        item.exists =
            (
                await stat(join(skillsRoot, item.importName)).catch(
                    () => undefined
                )
            )?.isDirectory() === true
        if (item.exists) {
            item.diagnostics = [
                `将覆盖现有 Skill：${item.importName}`,
                ...item.diagnostics
            ]
        }
    }
    const valid =
        skills.length > 0 && skills.every((item) => item.state === 'ready')
    const notes = [...diagnostics]

    if (skills.length < 1) {
        notes.push('没有找到包含 SKILL.md 的 Skill 目录。')
    }

    if (!valid && skills.length > 0) {
        notes.push('至少有一个 Skill 目录校验失败。')
    }

    return {
        source,
        target: target || basename(root),
        valid,
        entries,
        skills,
        diagnostics: notes
    }
}

async function materializeImportSource(
    ctx: Context,
    input: SkillImportInput,
    tmp: string
): Promise<{ root: string; diagnostics: string[] }> {
    if (input.type === 'github') {
        return await importFromGithub(ctx, input.url, tmp)
    }

    if (input.type === 'zip') {
        const root = join(tmp, stripExt(input.name) || 'archive')
        await mkdir(root, { recursive: true })
        await unzipToDir(Buffer.from(input.data, 'base64'), root)

        const files = await collectFilesRecursive(root, { relative: true })
        const top = Array.from(
            new Set(
                files
                    .map((file) => file.replaceAll('\\', '/').split('/')[0])
                    .filter(Boolean)
            )
        )

        if (top.length === 1) {
            const dir = join(root, top[0])
            const info = await stat(dir).catch(() => undefined)

            if (info?.isDirectory()) {
                return { root: dir, diagnostics: [] }
            }
        }

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

async function previewGithub(ctx: Context, url: string) {
    const info = parseGithubUrl(url)
    if (!info) {
        throw new Error('Unsupported GitHub URL')
    }

    const diagnostics: string[] = []
    const ref =
        info.ref || (await fetchGithubDefaultBranch(ctx, info.owner, info.repo))
    const response = await requestGithub<{
        tree?: { path?: string; type?: string }[]
        truncated?: boolean
    }>(
        ctx,
        `https://api.github.com/repos/${info.owner}/${info.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`
    )
    const tree = Array.isArray(response.data?.tree) ? response.data.tree : []

    if (response.data?.truncated) {
        diagnostics.push('GitHub API 返回的文件树已截断，预览结果可能不完整。')
    }

    const entries: SkillImportPreviewEntry[] = tree
        .map((item) => ({
            path: String(item.path ?? ''),
            type:
                item.type === 'tree'
                    ? ('directory' as const)
                    : ('file' as const)
        }))
        .filter((item) => item.path.length > 0)
        .filter((item) => {
            if (!info.subpath) {
                return true
            }

            return (
                item.path === info.subpath ||
                item.path.startsWith(`${info.subpath}/`)
            )
        })
        .map((item) => ({
            path: info.subpath
                ? item.path.slice(info.subpath.length).replace(/^\/+/, '')
                : item.path,
            type: item.type
        }))
        .filter((item) => item.path.length > 0)
        .sort((a, b) => {
            if (a.path === b.path) {
                return a.type === 'directory' ? -1 : 1
            }

            return a.path.localeCompare(b.path)
        })

    if (entries.length < 1) {
        diagnostics.push('GitHub 地址下没有找到可预览的文件。')
    }

    const tmp = resolve(
        ctx.baseDir,
        'data/chatluna/agent/tmp',
        `skills-${randomUUID()}`
    )

    await mkdir(tmp, { recursive: true })

    try {
        const files = new Set(
            entries
                .filter((item) => item.type === 'file')
                .map((item) => item.path)
        )
        const needed = new Set(
            [...files].filter((item) => basename(item) === 'SKILL.md')
        )

        for (const file of needed) {
            const dir = dirname(file)
            const extra =
                dir === '.' ? 'agents/openai.yaml' : `${dir}/agents/openai.yaml`
            if (files.has(extra)) {
                needed.add(extra)
            }
        }

        await Promise.all(
            [...needed].map(async (file) => {
                const content = await fetchGithubFile(
                    ctx,
                    info.owner,
                    info.repo,
                    info.subpath ? `${info.subpath}/${file}` : file,
                    ref
                )
                const target = resolveSafe(tmp, file)
                if (!target) {
                    return
                }

                await mkdir(dirname(target), { recursive: true })
                await writeFile(target, content, 'utf-8')
            })
        )

        const target = info.subpath
            ? `${info.owner}/${info.repo}/${info.subpath}`
            : `${info.owner}/${info.repo}`
        const scanned = await scanSkillRoot(tmp, ctx)
        const skills = scanned.map((item): SkillImportPreviewItem => {
            const dir =
                item.dir
                    .slice(tmp.length)
                    .replaceAll('\\', '/')
                    .replace(/^\/+/, '') || '.'

            return {
                dir,
                importName: basename(item.dir),
                name: item.name,
                description: item.description,
                state: item.state,
                exists: false,
                diagnostics: item.diagnostics
            }
        })
        const counts = new Map<string, number>()

        for (const item of skills) {
            counts.set(item.importName, (counts.get(item.importName) ?? 0) + 1)
        }

        const skillsRoot = getSkillsRootPath(ctx)
        for (const item of skills) {
            if ((counts.get(item.importName) ?? 0) > 1) {
                item.state = 'invalid'
                item.diagnostics = [
                    `重复的导入目录名：${item.importName}`,
                    ...item.diagnostics
                ]
            }

            item.exists =
                (
                    await stat(join(skillsRoot, item.importName)).catch(
                        () => undefined
                    )
                )?.isDirectory() === true
            if (item.exists) {
                item.diagnostics = [
                    `将覆盖现有 Skill：${item.importName}`,
                    ...item.diagnostics
                ]
            }
        }
        const valid =
            skills.length > 0 && skills.every((item) => item.state === 'ready')

        if (skills.length < 1) {
            diagnostics.push('没有找到包含 SKILL.md 的 Skill 目录。')
        }

        if (!valid && skills.length > 0) {
            diagnostics.push('至少有一个 Skill 目录校验失败。')
        }

        return {
            source: 'github',
            target,
            valid,
            entries,
            skills,
            diagnostics
        } satisfies SkillImportPreviewResult
    } finally {
        await rm(tmp, { recursive: true, force: true }).catch(() => {})
    }
}

async function importFromGithub(ctx: Context, url: string, tmp: string) {
    const info = parseGithubUrl(url)
    const diagnostics: string[] = []

    if (!info) {
        throw new Error('Unsupported GitHub URL')
    }

    const root = join(tmp, `${info.owner}-${info.repo}`)
    await mkdir(root, { recursive: true })

    const response = await requestGithub<ArrayBuffer>(
        ctx,
        info.ref
            ? `https://api.github.com/repos/${info.owner}/${info.repo}/zipball/${encodeURIComponent(info.ref)}`
            : `https://api.github.com/repos/${info.owner}/${info.repo}/zipball`,
        { responseType: 'arraybuffer' }
    )

    await unzipToDir(Buffer.from(response.data), root)

    const files = await collectFilesRecursive(root, { relative: true })
    const tops = Array.from(
        new Set(files.map((file) => file.replaceAll('\\', '/').split('/')[0]))
    ).filter(Boolean)
    const base =
        tops.length === 1 &&
        (await stat(join(root, tops[0])).catch(() => undefined))?.isDirectory()
            ? join(root, tops[0])
            : root

    const searchRoot = info.subpath
        ? await findSubpathRoot(base, info.subpath)
        : undefined

    if (info.subpath && !searchRoot) {
        diagnostics.push(
            `GitHub 子路径 '${info.subpath}' 不存在，已回退到整个仓库继续扫描。`
        )
    }

    return {
        root: searchRoot ?? base,
        diagnostics
    }
}

async function collectPreviewEntries(
    root: string
): Promise<SkillImportPreviewEntry[]> {
    const files = await collectFilesRecursive(root, { relative: true })
    const dirs = new Set<string>()

    for (const file of files) {
        let current = dirname(file)

        while (current && current !== '.') {
            dirs.add(current.replaceAll('\\', '/'))
            current = dirname(current)
        }
    }

    return [
        ...[...dirs]
            .sort((a, b) => a.localeCompare(b))
            .map((path) => ({ path, type: 'directory' as const })),
        ...files.map((path) => ({
            path: path.replaceAll('\\', '/'),
            type: 'file' as const
        }))
    ]
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

    const direct = join(root, clean)
    if ((await stat(direct).catch(() => undefined))?.isDirectory()) {
        return direct
    }

    const entries = await collectFilesRecursive(root, { relative: true })
    const tops = Array.from(
        new Set(entries.map((file) => file.replaceAll('\\', '/').split('/')[0]))
    ).filter(Boolean)

    for (const name of tops) {
        const target = join(root, name, clean)
        if ((await stat(target).catch(() => undefined))?.isDirectory()) {
            return target
        }
    }

    return undefined
}

async function fetchGithubDefaultBranch(
    ctx: Context,
    owner: string,
    repo: string
) {
    const response = await requestGithub<{ default_branch?: string }>(
        ctx,
        `https://api.github.com/repos/${owner}/${repo}`
    )

    const branch = String(response.data?.default_branch ?? '').trim()
    if (!branch) {
        throw new Error('GitHub 仓库没有默认分支。')
    }

    return branch
}

async function fetchGithubFile(
    ctx: Context,
    owner: string,
    repo: string,
    path: string,
    ref: string
) {
    const response = await requestGithub<{ content?: string }>(
        ctx,
        `https://api.github.com/repos/${owner}/${repo}/contents/${path
            .split('/')
            .map((item) => encodeURIComponent(item))
            .join('/')}?ref=${encodeURIComponent(ref)}`
    )
    const content = String(response.data?.content ?? '').replace(/\n/g, '')

    return Buffer.from(content, 'base64').toString('utf-8')
}

function githubHeaders(ctx: Context) {
    const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ChatLuna-Agent'
    }

    const token = ctx.chatluna_agent?.args.config.skills.githubToken?.trim()
    if (token) {
        headers.Authorization = `Bearer ${token}`
    }

    return headers
}

async function requestGithub<T>(
    ctx: Context,
    url: string,
    options: {
        responseType?: 'arraybuffer'
    } = {}
) {
    try {
        return (await ctx.http(url, {
            method: 'get',
            proxyAgent: '',
            headers: githubHeaders(ctx),
            responseType: options.responseType
        })) as unknown as { data: T }
    } catch (err) {
        throw new Error(getGithubError(err))
    }
}

function getGithubError(err: unknown) {
    const value = err as {
        response?: { status?: number }
        status?: number
        statusCode?: number
        message?: string
    }
    const status = Number(
        value.response?.status ?? value.status ?? value.statusCode ?? 0
    )
    const msg = String(value.message ?? err ?? '').trim()

    if (status === 401 || /bad credentials/i.test(msg)) {
        return 'GitHub Token 无效或已过期，请检查后重试。'
    }

    if (status === 403 && /rate limit/i.test(msg)) {
        return 'GitHub API 已触发限流，请稍后重试，或先在导入弹窗里配置 GitHub Token。'
    }

    if (/rate limit/i.test(msg)) {
        return 'GitHub API 已触发限流，请稍后重试，或先在导入弹窗里配置 GitHub Token。'
    }

    if (status === 403) {
        return 'GitHub 拒绝了当前请求，请检查仓库权限或 Token 配置。'
    }

    if (status === 404) {
        return 'GitHub 地址不存在，或当前分支、目录无法访问。'
    }

    if (msg) {
        return `GitHub 请求失败：${msg}`
    }

    return 'GitHub 请求失败，请稍后重试。'
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
        return {
            owner,
            repo,
            ref: parts[3],
            subpath: parts.slice(4).join('/')
        }
    }

    return {
        owner,
        repo,
        ref: '',
        subpath: ''
    }
}

function stripExt(name: string) {
    return name.replace(/\.[^.]+$/, '')
}
