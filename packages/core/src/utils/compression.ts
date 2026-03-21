import { gunzip, gzip } from 'zlib'
import { promisify } from 'util'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

type Encoding = 'buffer' | 'base64' | 'hex'
type BufferType<T extends Encoding> = T extends 'buffer'
    ? Buffer
    : T extends 'base64'
      ? string
      : T extends 'hex'
        ? string
        : never

export async function gzipEncode<T extends Encoding = 'buffer'>(
    data: string,
    encoding: T = 'buffer' as T
): Promise<BufferType<T>> {
    const result = await gzipAsync(data)
    return (encoding === 'buffer'
        ? result
        : result.toString(encoding)) as BufferType<T>
}

export async function gzipDecode(data: ArrayBuffer | ArrayBufferView) {
    const buffer = ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : Buffer.from(data)
    return (await gunzipAsync(buffer)).toString()
}

export function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
    return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer
}
