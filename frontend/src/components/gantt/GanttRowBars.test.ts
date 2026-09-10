import {describe, it, expect} from 'vitest'
import {mount} from '@vue/test-utils'
import {createI18n} from 'vue-i18n'

import GanttRowBars from './GanttRowBars.vue'
import en from '@/i18n/lang/en.json'

const i18n = createI18n({legacy: false, locale: 'en', messages: {en}})

const DAY_WIDTH = 10
// a canonical date-only bar: three days wide (8, 9, 10)
const bar = {
	id: '1',
	start: new Date(2026, 8, 8, 0, 0, 0, 0),
	end: new Date(2026, 8, 10, 23, 59, 59, 999),
	meta: {label: 'task'},
}

function mountBars(edge?: 'start' | 'end', currentDays = 0) {
	return mount(GanttRowBars, {
		props: {
			bars: [bar],
			totalWidth: 300,
			dateFromDate: new Date(2026, 8, 1),
			dateToDate: new Date(2026, 8, 30, 23, 59, 59, 999),
			dayWidthPixels: DAY_WIDTH,
			isDragging: false,
			isResizing: edge !== undefined,
			dragState: edge === undefined ? null : {
				barId: bar.id,
				startX: 0,
				originalStart: bar.start,
				originalEnd: bar.end,
				currentDays,
				edge,
			},
			focusedRow: null,
			focusedCell: null,
			rowId: 'row-1',
			isParent: false,
			isCollapsed: false,
		},
		global: {plugins: [i18n]},
	})
}

function width(wrapper: ReturnType<typeof mountBars>) {
	return Number(wrapper.find('rect.gantt-bar').attributes('width'))
}

describe('GanttRowBars resize preview', () => {
	it('draws the static bar three days wide', () => {
		expect(width(mountBars())).toBe(3 * DAY_WIDTH)
	})

	it.each(['start', 'end'] as const)('keeps the width on %s-edge pointer-down before any movement', (edge) => {
		expect(width(mountBars(edge, 0))).toBe(3 * DAY_WIDTH)
	})

	it('grows by one day-width when the end edge moves a day', () => {
		expect(width(mountBars('end', 1))).toBe(4 * DAY_WIDTH)
	})

	it('shrinks by one day-width when the start edge moves a day', () => {
		expect(width(mountBars('start', 1))).toBe(2 * DAY_WIDTH)
	})
})
