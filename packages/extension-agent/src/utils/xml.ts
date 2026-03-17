/**
 * @module utils/xml
 * @description XML 文本转义工具。
 */

/** 转义 XML 文本中的特殊字符。 */
export function escapeXml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
}
