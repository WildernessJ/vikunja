import {computed, watch} from 'vue'
import {createSharedComposable, tryOnMounted} from '@vueuse/core'
import {useAuthStore} from '@/stores/auth'
import {rootFontSize, fontFamilyStack} from '@/helpers/appearance'

// Mirrors useColorScheme: watches the two appearance settings from the auth
// store and drives the root <html> element. font-size scales every rem-based
// value (a mild app zoom). We override Bulma's own --body-family variable,
// which it applies to body AND every form control (button/input/select/
// textarea) — headings keep their Quicksand brand font ($vikunja-font) because
// those carry an explicit font-family that outranks the inherited variable.
export const useAppearance = createSharedComposable(() => {
	const authStore = useAuthStore()

	const fontSize = computed(() => rootFontSize(authStore.settings.frontendSettings.fontSize))
	const fontFamily = computed(() => fontFamilyStack(authStore.settings.frontendSettings.fontFamily))

	function apply() {
		const el = window?.document.documentElement
		if (!el) {
			return
		}
		el.style.fontSize = fontSize.value
		el.style.setProperty('--body-family', fontFamily.value)
	}

	watch([fontSize, fontFamily], apply, {flush: 'post'})

	tryOnMounted(apply)
})
