import {describe, it, expect} from 'vitest'
import {mount} from '@vue/test-utils'
import {createI18n} from 'vue-i18n'
import en from '@/i18n/lang/en.json'
import CreateEdit from './CreateEdit.vue'

const i18n = createI18n({legacy: false, locale: 'en', messages: {en}})
const passthrough = {template: '<div><slot /><slot name="footer" /></div>'}

function mountIt(props: Record<string, unknown> = {}) {
	return mount(CreateEdit, {
		props: {title: 'T', ...props},
		global: {
			plugins: [i18n],
			mocks: {$router: {back: () => {}}},
			stubs: {
				Modal: passthrough,
				Card: passthrough,
				XButton: {props: ['variant'], template: '<button :data-variant="variant"><slot /></button>'},
			},
		},
	})
}

describe('CreateEdit', () => {
	// #100: a boolean prop with no default is cast to false, so `?? true` never applied.
	it('shows the primary button by default', () => {
		expect(mountIt().find('[data-variant="primary"]').text()).toBe('Create')
	})

	it('hides the primary button when has-primary-action is false', () => {
		expect(mountIt({hasPrimaryAction: false}).find('[data-variant="primary"]').exists()).toBe(false)
	})

	it('uses the given primary label', () => {
		expect(mountIt({primaryLabel: 'Save'}).find('[data-variant="primary"]').text()).toBe('Save')
	})

	it('shows the tertiary button only when a label is given', () => {
		expect(mountIt().find('[data-variant="tertiary"]').exists()).toBe(false)
		expect(mountIt({tertiary: 'Delete'}).find('[data-variant="tertiary"]').text()).toBe('Delete')
	})
})
