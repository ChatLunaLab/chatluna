import { exec } from 'child_process'
import fs from 'fs/promises'
import path from 'path'

const paths = [
    {
        filePath: 'packages/core/src/middleware.ts',
        importFilesDir: 'packages/core/src/middlewares/**'
    },
    {
        filePath: 'packages/core/src/command.ts',
        importFilesDir: 'packages/core/src/commands'
    },
    {
        filePath: 'packages/service-vector-store/src/vectorstore.ts',
        importFilesDir: 'packages/service-vector-store/src/vectorstore'
    },
    {
        filePath: 'packages/service-embeddings/src/embeddings.ts',
        importFilesDir: 'packages/service-embeddings/src/embeddings'
    },
    {
        filePath: 'packages/extension-tools/src/plugin.ts',
        importFilesDir: 'packages/extension-tools/src/plugins'
    },
    {
        filePath: 'packages/service-search/src/plugin.ts',
        importFilesDir: 'packages/service-search/src/providers'
    },
    {
        filePath: 'packages/extension-long-memory/src/plugin.ts',
        importFilesDir: 'packages/extension-long-memory/src/plugins'
    },
    {
        filePath: 'packages/extension-variable/src/plugin.ts',
        importFilesDir: 'packages/extension-variable/src/plugins'
    }
]

async function main() {
    const args = process.argv.slice(2)

    const needLint = args.includes('--lint') || false

    console.log(`needLint: ${needLint}`)

    for (const subPaths of paths) {
        console.log(`[Processing ${subPaths.filePath}]`)
        const fileParentDir = subPaths.filePath
            .split('/')
            .slice(0, -1)
            .join('/')
        const subDirName = subPaths.importFilesDir.includes('**')
            ? subPaths.importFilesDir
                  .replace(fileParentDir, '')
                  .replace('/**', '')
            : subPaths.importFilesDir.replace(fileParentDir, '')
        const importFilesDir = subPaths.importFilesDir
        await processImports(subPaths.filePath, subDirName, importFilesDir)
    }

    if (needLint) {
        // exec command 'yarn lint-fix‘
        await run('yarn', ['lint-fix'])
    }

    console.log('done process dynamic import')

    process.exit(0)
}

export default async function run(exe: string, args: string[]) {
    return new Promise((resolve, reject) => {
        const env = Object.create(process.env)
        const child = exec([exe, ...args].join(' '), {
            env: {
                ...env
            }
        })
        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')
        child.stdout.on('data', (data) => console.log(data))
        child.stderr.on('data', (data) => console.error(data))
        child.on('error', (error) => reject(error))
        child.on('close', (exitCode) => {
            console.log(
                `run ${[exe, ...args].join(' ')} exit with code ${exitCode}`
            )
            resolve(exitCode)
        })
    })
}

async function processImports(
    path: string,
    subDirName: string,
    importFilesDir: string
) {
    const allImportFiles = await getAllImportFiles(importFilesDir, subDirName)

    // step 1. replace all imports

    let originPathContent = await fs.readFile(path, 'utf-8')

    // match the comment from '// import start' to '// import end', remove the comment match
    const importFiles = originPathContent.match(
        /\/\/ import start([\s\S]*?)\/\/ import end/
    )
    if (!importFiles) {
        throw new Error('no import files')
    }
    const importFilesContent = importFiles[1]

    originPathContent = originPathContent.replace(
        importFilesContent,
        await generateImports(allImportFiles)
    )

    const middlewares = originPathContent.match(
        /\/\/ middleware start([\s\S]*?)\/\/ middleware end/
    )

    originPathContent = originPathContent.replace(
        middlewares[1],
        await generateMiddlewares(allImportFiles)
    )

    if (originPathContent.length > 0) {
        // console.log(originPathContent)
        await fs.writeFile(path, originPathContent)
    }
}

async function generateMiddlewares(allImportFiles: ImportFile[]) {
    const stats = ['', '[']

    for (const info of allImportFiles) {
        //  import { apply as lifecycle } from './middlewares/lifecycle'
        stats.push(`${info.name},`)
    }

    stats.push(']')

    return stats.join('\n')
}

async function generateImports(allImportFiles: ImportFile[]) {
    const stats = ['']

    for (const info of allImportFiles) {
        //  import { apply as lifecycle } from './middlewares/lifecycle'
        stats.push(`import { apply as ${info.name} } from '${info.path}'`)
    }

    return stats.join('\n')
}

async function getAllImportFiles(importFilesDir: string, subDirName: string) {
    const isGlobPattern = importFilesDir.includes('*')

    if (!isGlobPattern) {
        return await getFilesFromDir(importFilesDir, subDirName, '')
    }

    const baseDir = importFilesDir.replace(/\/\*+$/, '') // 移除末尾的 /* 或 /**
    const isRecursive = importFilesDir.includes('**')

    return await getFilesRecursively(baseDir, subDirName, isRecursive)
}

async function getFilesFromDir(
    dir: string,
    subDirName: string,
    relativePath: string
): Promise<ImportFile[]> {
    const files = await fs.readdir(dir)
    const allImportFiles: ImportFile[] = []

    for (const file of files) {
        const filePath = path.join(dir, file)
        const stat = await fs.stat(filePath)

        if (stat.isFile() && file.endsWith('.ts')) {
            const realName = path.basename(file, '.ts')
            const importPath = relativePath
                ? `.${subDirName}/${relativePath}/${realName}`
                : `.${subDirName}/${realName}`

            allImportFiles.push({
                path: importPath,
                name: realName
            })
        }
    }

    return allImportFiles
}

async function getFilesRecursively(
    baseDir: string,
    subDirName: string,
    recursive: boolean
): Promise<ImportFile[]> {
    const allImportFiles: ImportFile[] = []

    async function scanDirectory(currentDir: string, relativePath: string) {
        const files = await fs.readdir(currentDir)

        for (const file of files) {
            const filePath = path.join(currentDir, file)
            const stat = await fs.stat(filePath)

            if (stat.isFile() && file.endsWith('.ts')) {
                const realName = path.basename(file, '.ts')
                const importPath = relativePath
                    ? `.${subDirName}/${relativePath}/${realName}`
                    : `.${subDirName}/${realName}`

                allImportFiles.push({
                    path: importPath,
                    name: realName
                })
            } else if (stat.isDirectory() && recursive) {
                const newRelativePath = relativePath
                    ? `${relativePath}/${file}`
                    : file
                await scanDirectory(filePath, newRelativePath)
            }
        }
    }

    await scanDirectory(baseDir, '')
    return allImportFiles
}

main()

interface ImportFile {
    path: string
    name: string
}
