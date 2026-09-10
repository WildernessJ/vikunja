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

function mountBars(edge?: 'start' | 'end', currentDays = 0, theBar = bar) {
	return mount(GanttRowBars, {
		props: {
			bars: [theBar],
			totalWidth: 300,
			dateFromDate: new Date(2026, 8, 1),
			dateToDate: new Date(2026, 8, 30, 23, 59, 59, 999),
			dayWidthPixels: DAY_WIDTH,
			isDragging: false,
			isResizing: edge !== undefined,
			dragState: edge === undefined ? null : {
				barId: bar.id,
				startX: 0,
				originalStart: theBar.start,
				originalEnd: theBar.end,
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

// [x, width] in day-widths
function geometry(wrapper: ReturnType<typeof mountBars>) {
	const rect = wrapper.find('rect.gantt-bar')
	return [Number(rect.attributes('x')) / DAY_WIDTH, Number(rect.attributes('width')) / DAY_WIDTH]
}

describe('GanttRowBars resize preview', () => {
	it('draws the static bar three days wide from day 7', () => {
		expect(geometry(mountBars())).toEqual([7, 3])
	})

	it('draws a legacy midnight end (date-only off) two days wide', () => {
		expect(geometry(mountBars(undefined, 0, {...bar, end: new Date(2026, 8, 10, 0, 0)}))).toEqual([7, 2])
	})

	it.each(['start', 'end'] as const)('keeps the geometry on %s-edge pointer-down before any movement', (edge) => {
		expect(geometry(mountBars(edge, 0))).toEqual([7, 3])
	})

	it('moves only the right edge when the end edge moves a day', () => {
		expect(geometry(mountBars('end', 1))).toEqual([7, 4])
	})

	it('moves only the left edge when the start edge moves a day', () => {
		expect(geometry(mountBars('start', 1))).toEqual([8, 2])
	})
})
