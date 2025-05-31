import { Context } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'
import { Lunar } from 'lunar-javascript'
import Holidays from 'date-holidays'

export async function apply(
    ctx: Context,
    config: Config,
    _plugin: ChatLunaPlugin
) {
    if (config.lunar !== true) {
        return
    }

    ctx.on(
        'chatluna/before-chat',
        async (_session, _message, promptVariables) => {
            // Get lunar calendar information
            const lunarDate = getChineseLunarDate()

            // Get holiday information for China and US (can be customized)
            const holidayInfo = getCurrentHoliday(['CN', 'US'])

            promptVariables.lunar_date = lunarDate.fullLunarDate
            promptVariables.lunar_year = lunarDate.year
            promptVariables.lunar_month = lunarDate.month
            promptVariables.lunar_day = lunarDate.day
            promptVariables.lunar_zodiac = lunarDate.zodiac
            promptVariables.lunar_year_ganzhi = lunarDate.yearGanZhi

            // Holiday information
            promptVariables.current_holiday = holidayInfo
        }
    )
}

/**
 * Get the current Chinese lunar calendar date information
 * @returns An object containing lunar calendar details
 */
export function getChineseLunarDate() {
    const date = new Date()
    const lunar = Lunar.fromDate(date)

    return {
        year: lunar.getYearInChinese(),
        month: lunar.getMonthInChinese(),
        day: lunar.getDayInChinese(),
        yearGanZhi: lunar.getYearInGanZhi(),
        zodiac: lunar.getYearShengXiao(),
        lunarFestival: lunar.getFestivals().join(', '),
        fullLunarDate: `${lunar.getYearInChinese()}年${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}日`,
        rawLunar: lunar
    }
}

/**
 * Get information about the current holiday(s) for a given region
 * @param regions Array of region codes. Defaults to ['CN', 'US']
 * @returns Current holiday information or empty string if no holiday
 */
export function getCurrentHoliday(regions: string[] = ['CN', 'US']) {
    const date = new Date()
    const currentHolidays = []

    for (const region of regions) {
        try {
            const hd = new Holidays(region)
            const holidays = hd.isHoliday(date)

            if (holidays && holidays.length > 0) {
                currentHolidays.push(
                    ...holidays.map((h) => `${h.name} (${region})`)
                )
            }
        } catch (error) {
            // Skip invalid regions
        }
    }

    // Also check lunar calendar for traditional Chinese festivals
    const lunar = getChineseLunarDate()
    if (lunar.lunarFestival) {
        currentHolidays.push(lunar.lunarFestival)
    }

    return currentHolidays.length > 0 ? currentHolidays.join(', ') : ''
}
