/**
 * @module utils/id
 * @description 稳定短 ID 生成工具。
 */

import { createHash } from 'crypto'

/** sha1(path).slice(0,16) 生成稳定短 ID。 */
export function createHashId(path: string): string {
    return createHash('sha1').update(path).digest('hex').slice(0, 16)
}
