import fs from 'fs/promises'

export async function checkFileExists(path: string) {
    try {
        await fs.access(path)
        return true
    } catch (e) {
        return false
    }
}

export type RemoveKey<T, K extends keyof T> = {
    [P in Exclude<keyof T, K>]: T[P]
}
