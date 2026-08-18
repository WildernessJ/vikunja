import {createDateFromString} from '@/helpers/time/createDateFromString'
import dayjs from 'dayjs'

import {i18n} from '@/i18n'
import {translate} from '@/message'
import {createSharedComposable} from '@vueuse/core'
import {computed, toValue, type MaybeRefOrGetter} from 'vue'
import {useDateDisplay} from '@/composables/useDateDisplay'
import {useGlobalNow} from '@/composables/useGlobalNow'
import {useTimeFormat} from '@/composables/useTimeFormat'
import {DATE_DISPLAY, type DateDisplay} from '@/constants/dateDisplay'
import {TIME_FORMAT, type TimeFormat} from '@/constants/timeFormat'
import {DAYJS_LOCALE_MAPPING} from '@/i18n/useDayjsLanguageSync.ts'

export function dateIsValid(date: Date | string | null): date is Date {
	if (date === null) {
		return false
	}

	return date instanceof Date && !isNaN(date.getTime())
}

export const formatDate = (date: Date | string | null, f: string) => {
	if (!dateIsValid(date)) {
		return ''
	}

	date = createDateFromString(date)

	const locale = DAYJS_LOCALE_MAPPING[i18n.global.locale.value.toLowerCase() as keyof typeof DAYJS_LOCALE_MAPPING] ?? 'en'

	return date
		? dayjs(date).locale(locale).format(f)
		: ''
}

export function formatDateLong(date: Date | string | null, dateOnly = false) {
	return formatDate(date, dateOnly ? 'LL' : 'LLLL')
}

export function formatDateShort(date: Date | string | null) {
	return formatDate(date, 'lll')
}

export const formatDateSince = (date: Date | string | null) => {
	if (!dateIsValid(date)) {
		return ''
	}

	date = createDateFromString(date)

	const locale = DAYJS_LOCALE_MAPPING[i18n.global.locale.value.toLowerCase() as keyof typeof DAYJS_LOCALE_MAPPING] ?? 'en'

	// Computing the relative string against the shared, ticking `now` (instead of fromNow's
	// internal Date.now()) makes every reactive caller re-render on the 60s tick, so open views
	// don't keep showing a stale "x minutes ago".
	const {now} = useGlobalNow()

	return date
		? dayjs(date).locale(locale).from(now.value)
		: ''
}

export function formatISO(date: Date | string | null) {
	return date ? new Date(date).toISOString() : ''
}

/**
 * Because `Intl.DateTimeFormat` is expensive to instatiate we try to reuse it as often as possible,
 * by creating a shared composable.
 */
export const useDateTimeFormatter = createSharedComposable((options?: MaybeRefOrGetter<Intl.DateTimeFormatOptions>) => {
	return computed(() => new Intl.DateTimeFormat(i18n.global.locale.value, toValue(options)))
})

export function useWeekDayFromDate() {
	const dateTimeFormatter = useDateTimeFormatter({weekday: 'short'})

	return computed(() => (date: Date) => dateTimeFormatter.value.format(date))
}

/**
 * Day-granular counterpart to formatDateSince: "Today" / "Tomorrow" / "in 3 days",
 * never "in 3 hours". Only task dates use it — activity timestamps keep their clocks.
 */
export const formatDateSinceDay = (date: Date | string | null) => {
	if (typeof date === 'string') {
		date = createDateFromString(date)
	}

	if (!dateIsValid(date)) {
		return ''
	}

	const locale = DAYJS_LOCALE_MAPPING[i18n.global.locale.value.toLowerCase() as keyof typeof DAYJS_LOCALE_MAPPING] ?? 'en'

	const {now} = useGlobalNow()
	const day = dayjs(date).startOf('day')
	const today = dayjs(now.value).startOf('day')

	switch (day.diff(today, 'day')) {
		case 0:
			return translate('input.datepicker.today')
		case 1:
			return translate('input.datepicker.tomorrow')
		case -1:
			return translate('input.datepicker.yesterday')
		default:
			return day.locale(locale).from(today)
	}
}

export function formatDisplayDate(date: Date | string | null, dateOnly = false) {
	const {store: dateDisplay} = useDateDisplay()
	const {store: timeFormat} = useTimeFormat()

	return formatDisplayDateFormat(date, dateDisplay.value, timeFormat.value, dateOnly)	
}

export function formatDisplayDateFormat(date: Date | string | null, format: DateDisplay, timeFormat?: TimeFormat, dateOnly = false) {
	if (typeof date === 'string') {
		date = createDateFromString(date)
	}
	
	if (date === null || !dateIsValid(date)) {
		return ''
	}

	// Determine the time format string to use
	// For 24-hour: HH:mm (24-hour format)
	// For 12-hour: hh:mm A (explicit 12-hour format with AM/PM, ignoring locale default)
	const timeFormatString = timeFormat === TIME_FORMAT.HOURS_24 ? 'HH:mm' : 'hh:mm A'
	// The separating space belongs to the time part, so it goes when the time goes.
	const withTime = (dateFormat: string) => formatDate(date, dateOnly ? dateFormat : `${dateFormat} ${timeFormatString}`)

	switch (format) {
		case DATE_DISPLAY.MM_DD_YYYY:
			return withTime('MM-DD-YYYY')
		case DATE_DISPLAY.DD_MM_YYYY:
			return withTime('DD-MM-YYYY')
		case DATE_DISPLAY.YYYY_MM_DD:
			return withTime('YYYY-MM-DD')
		case DATE_DISPLAY.MM_SLASH_DD_YYYY:
			return withTime('MM/DD/YYYY')
		case DATE_DISPLAY.DD_SLASH_MM_YYYY:
			return withTime('DD/MM/YYYY')
		case DATE_DISPLAY.YYYY_SLASH_MM_DD:
			return withTime('YYYY/MM/DD')
		case DATE_DISPLAY.DAY_MONTH_YEAR: {
			const hour12 = timeFormat !== TIME_FORMAT.HOURS_24
			const time = dateOnly ? {} : {hour: 'numeric', minute: 'numeric', hour12} as const
			return new Intl.DateTimeFormat(i18n.global.locale.value, {day: 'numeric', month: 'long', year: 'numeric', ...time}).format(date)
		}
		case DATE_DISPLAY.WEEKDAY_DAY_MONTH_YEAR: {
			const hour12 = timeFormat !== TIME_FORMAT.HOURS_24
			const time = dateOnly ? {} : {hour: 'numeric', minute: 'numeric', hour12} as const
			return new Intl.DateTimeFormat(i18n.global.locale.value, {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', ...time}).format(date)
		}
		case DATE_DISPLAY.RELATIVE:
		default:
			return dateOnly ? formatDateSinceDay(date) : formatDateSince(date)
	}
}
