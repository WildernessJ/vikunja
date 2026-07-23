import {describe, expect, it, vi, beforeEach} from 'vitest'
import {computed, nextTick, ref} from 'vue'

import {PrefixMode} from '@/modules/quickAddMagic'

const searchProjectMock = vi.fn()
const filterLabelsByQueryMock = vi.fn()
const getLabelsByExactTitlesMock = vi.fn().mockReturnValue([])
const getAllMock = vi.fn()

vi.mock('@/stores/projects', () => ({
	useProjectStore: () => ({
		searchProject: searchProjectMock,
	}),
}))

vi.mock('@/stores/labels', () => ({
	useLabelStore: () => ({
		filterLabelsByQuery: filterLabelsByQueryMock,
		getLabelsByExactTitles: getLabelsByExactTitlesMock,
	}),
}))

vi.mock('@/services/projectUsers', () => ({
	default: class {
		getAll = getAllMock
	},
}))

import {useQuickAddAutocomplete} from './useQuickAddAutocomplete'

describe('useQuickAddAutocomplete', () => {
	beforeEach(() => {
		searchProjectMock.mockReset().mockReturnValue([])
		filterLabelsByQueryMock.mockReset().mockReturnValue([])
		getLabelsByExactTitlesMock.mockReset().mockReturnValue([])
		getAllMock.mockReset().mockResolvedValue([])
	})

	function setup(initialTitle = '') {
		const title = ref(initialTitle)
		const mode = ref(PrefixMode.Default)
		const isMultiline = ref(false)
		const assigneeProjectId = computed(() => 1)
		const autocomplete = useQuickAddAutocomplete({title, mode, isMultiline, assigneeProjectId})
		return {title, mode, isMultiline, autocomplete}
	}

	it('is closed when the caret is not inside a token', () => {
		const {autocomplete} = setup('buy milk')
		autocomplete.setCaretOffset(4)

		expect(autocomplete.isOpen.value).toBe(false)
	})

	it('opens and queries projects when the caret sits inside a project token', async () => {
		searchProjectMock.mockReturnValue([{id: 1, title: 'MyProject'}])
		const {title, autocomplete} = setup()
		title.value = '+MyProj'
		autocomplete.setCaretOffset(title.value.length)
		await nextTick()

		expect(autocomplete.isOpen.value).toBe(true)
		expect(searchProjectMock).toHaveBeenCalledWith('MyProj')
		expect(autocomplete.items.value).toEqual([
			{kind: 'project', id: 1, display: 'MyProject', insertValue: 'MyProject'},
		])
	})

	it('excludes already-typed labels from the label query', async () => {
		getLabelsByExactTitlesMock.mockReturnValue([{id: 5, title: 'errand'}])
		filterLabelsByQueryMock.mockReturnValue([{id: 6, title: 'urgent'}])
		const {title, autocomplete} = setup()
		title.value = '*errand *urg'
		autocomplete.setCaretOffset(title.value.length)
		await nextTick()

		expect(filterLabelsByQueryMock).toHaveBeenCalledWith([{id: 5, title: 'errand'}], 'urg')
		expect(autocomplete.items.value).toEqual([
			{kind: 'label', id: 6, display: 'urgent', insertValue: 'urgent'},
		])
	})

	it('closes without inserting anything when close() is called', async () => {
		const {title, autocomplete} = setup()
		title.value = '+MyProj'
		autocomplete.setCaretOffset(title.value.length)
		await nextTick()
		expect(autocomplete.isOpen.value).toBe(true)

		autocomplete.close()
		expect(autocomplete.isOpen.value).toBe(false)
	})

	it('stays closed when the same caret offset is re-reported after close (Escape keyup)', async () => {
		const {title, autocomplete} = setup()
		title.value = '+MyProj'
		autocomplete.setCaretOffset(title.value.length)
		await nextTick()
		autocomplete.close()

		// The keyup from the Escape press fires setCaretOffset with the unchanged
		// offset; it must not reopen the dropdown we just dismissed.
		autocomplete.setCaretOffset(title.value.length)
		await nextTick()

		expect(autocomplete.isOpen.value).toBe(false)
	})

	it('reopens when the caret moves to a different offset after being closed', async () => {
		const {title, autocomplete} = setup()
		title.value = '+MyProj +Other'
		autocomplete.setCaretOffset(7)
		await nextTick()
		autocomplete.close()

		autocomplete.setCaretOffset(title.value.length)
		await nextTick()

		expect(autocomplete.isOpen.value).toBe(true)
	})

	it('does not query assignees and shows no results when no project id can be resolved', async () => {
		const title = ref('@pe')
		const mode = ref(PrefixMode.Default)
		const isMultiline = ref(false)
		const assigneeProjectId = computed(() => null)
		const autocomplete = useQuickAddAutocomplete({title, mode, isMultiline, assigneeProjectId})

		autocomplete.setCaretOffset(title.value.length)
		await nextTick()

		expect(getAllMock).not.toHaveBeenCalled()
		expect(autocomplete.items.value).toEqual([])
	})

	it('inserts the selected item by delegating to insertTokenAtCaret', async () => {
		searchProjectMock.mockReturnValue([{id: 1, title: 'MyProject'}])
		const {title, autocomplete} = setup()
		title.value = '+MyProj'
		autocomplete.setCaretOffset(title.value.length)
		await nextTick()

		const result = autocomplete.insertItem(autocomplete.items.value[0])

		expect(result).toEqual({text: '+MyProject ', caret: '+MyProject '.length})
	})

	it('is disabled entirely when quickAddMagicMode is Disabled', async () => {
		const title = ref('+MyProj')
		const mode = ref(PrefixMode.Disabled)
		const isMultiline = ref(false)
		const assigneeProjectId = computed(() => 1)
		const autocomplete = useQuickAddAutocomplete({title, mode, isMultiline, assigneeProjectId})

		autocomplete.setCaretOffset(title.value.length)
		await nextTick()

		expect(autocomplete.isOpen.value).toBe(false)
	})

	it('debounces assignee lookups by 300ms', async () => {
		vi.useFakeTimers()
		try {
			getAllMock.mockResolvedValue([{id: 9, username: 'pete', name: 'Pete', email: 'pete@example.com'}])
			const title = ref('@pe')
			const mode = ref(PrefixMode.Default)
			const isMultiline = ref(false)
			const assigneeProjectId = computed(() => 3)
			const autocomplete = useQuickAddAutocomplete({title, mode, isMultiline, assigneeProjectId})

			autocomplete.setCaretOffset(title.value.length)
			await vi.advanceTimersByTimeAsync(0)
			expect(getAllMock).not.toHaveBeenCalled()

			await vi.advanceTimersByTimeAsync(300)
			expect(getAllMock).toHaveBeenCalledWith({projectId: 3}, {s: 'pe'})
			expect(autocomplete.items.value).toEqual([
				{kind: 'assignee', id: 9, display: 'Pete', insertValue: 'pete', user: {id: 9, username: 'pete', name: 'Pete', email: 'pete@example.com'}},
			])
		} finally {
			vi.useRealTimers()
		}
	})

	it('re-fetches assignees when assigneeProjectId changes while the assignee token stays active', async () => {
		vi.useFakeTimers()
		try {
			getAllMock.mockResolvedValue([{id: 9, username: 'pete', name: 'Pete', email: 'pete@example.com'}])
			const title = ref('@pe')
			const mode = ref(PrefixMode.Default)
			const isMultiline = ref(false)
			const projectId = ref<number | null>(null)
			const assigneeProjectId = computed(() => projectId.value)
			const autocomplete = useQuickAddAutocomplete({title, mode, isMultiline, assigneeProjectId})

			autocomplete.setCaretOffset(title.value.length)
			await vi.advanceTimersByTimeAsync(300)
			expect(getAllMock).not.toHaveBeenCalled()

			// Title/caret are unchanged - only the resolvable project flips to a real id.
			projectId.value = 3
			await vi.advanceTimersByTimeAsync(300)

			expect(getAllMock).toHaveBeenCalledWith({projectId: 3}, {s: 'pe'})
			expect(autocomplete.items.value).toEqual([
				{kind: 'assignee', id: 9, display: 'Pete', insertValue: 'pete', user: {id: 9, username: 'pete', name: 'Pete', email: 'pete@example.com'}},
			])
		} finally {
			vi.useRealTimers()
		}
	})

	it('is disabled when the input is multiline', async () => {
		const title = ref('+MyProj\nsecond line')
		const mode = ref(PrefixMode.Default)
		const isMultiline = ref(true)
		const assigneeProjectId = computed(() => 1)
		const autocomplete = useQuickAddAutocomplete({title, mode, isMultiline, assigneeProjectId})

		autocomplete.setCaretOffset(7)
		await nextTick()

		expect(autocomplete.isOpen.value).toBe(false)
	})
})
