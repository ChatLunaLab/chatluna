import type { ExecuteResult } from '../types'

/** Shell 单引号转义。 */
export function quoteShell(value: string): string {
    return `'${value.replaceAll("'", `'\\''`)}'`
}

/** 截断输出文本。 */
export function truncateOutput(text: string, limit: number): string {
    if (text.length <= limit) return text
    return `${text.slice(0, limit)}\n...[output truncated]`
}

/** 标准化 execute 输出为单个文本块。 */
export function formatExecuteResult(result: ExecuteResult): string {
    const parts: string[] = []
    if (result.stdout) parts.push(result.stdout)
    if (result.stderr) parts.push(`[stderr]\n${result.stderr}`)
    return parts.join('\n') || '(no output)'
}

export function buildPosixBackgroundCommand(command: string, marker: string) {
    return `${command}\n__chatluna_code=$?\nprintf '\n${marker}:%s\n' "$__chatluna_code"\nexit\n`
}

export function buildHashCommand(entries: [string, string][]) {
    const input = JSON.stringify(entries)
    const node = [
        `const fs=require('fs'),crypto=require('crypto')`,
        `const entries=JSON.parse(process.argv[1])`,
        `const result={}`,
        `for(const [key,file] of entries){try{result[key]=crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex')}catch{}}`,
        `process.stdout.write(JSON.stringify(result))`
    ].join(';')
    const py = `import hashlib,json,sys
entries=json.loads(sys.argv[1])
result={}
for key,path in entries:
    try:
        value=hashlib.sha1()
        with open(path,'rb') as file:
            while True:
                chunk=file.read(1048576)
                if not chunk:
                    break
                value.update(chunk)
        result[key]=value.hexdigest()
    except OSError:
        pass
print(json.dumps(result,separators=(',',':')))`
    return [
        `(node -e ${quoteShell(node)} ${quoteShell(input)}`,
        `python3 -c ${quoteShell(py)} ${quoteShell(input)}`,
        `python -c ${quoteShell(py)} ${quoteShell(input)})`
    ].join(' || ')
}

export function readHashCommandOutput(result: ExecuteResult) {
    if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || result.stdout.trim())
    }

    return new Map<string, string>(
        Object.entries(
            JSON.parse(result.stdout.trim()) as Record<string, string>
        )
    )
}
