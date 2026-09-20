import {VueRenderer} from '@tiptap/vue-3'
import type {Editor, Range} from '@tiptap/core'
import {PluginKey, type EditorState} from '@tiptap/pm/state'
import type {SuggestionProps} from '@tiptap/suggestion'

import EmojiList from './EmojiList.vue'
import {loadEmojis, filterEmojis, type EmojiEntry} from './emojiData'
import {getPopupContainer} from '../popupContainer'
import {createSuggestionPopup, type SuggestionPopup} from '../suggestionPopup'

export const EmojiSuggestionPluginKey = new PluginKey('emojiSuggestion')

const SHORTCODE_RE = /^[a-zA-Z0-9_]*$/

export default function emojiSuggestionSetup() {
	return {
		pluginKey: EmojiSuggestionPluginKey,
		char: ':',
		allowedPrefixes: [' ', '\t', '\n'],
		startOfLine: false,

		allow: ({state, range}: {state: EditorState, range: Range}) => {
			const text = state.doc.textBetween(range.from, range.to, '\n', '\n')
			// Drop the leading ':' trigger character.
			const query = text.startsWith(':') ? text.slice(1) : text
			return SHORTCODE_RE.test(query)
		},

		items: async ({query}: {query: string}): Promise<EmojiEntry[]> => {
			if (query === '') return []
			try {
				const index = await loadEmojis()
				return filterEmojis(index, query)
			} catch (err) {
				console.error('Failed to load emoji index:', err)
				return []
			}
		},

		command: ({editor, range, props}: {editor: Editor, range: Range, props: EmojiEntry}) => {
			editor
				.chain()
				.focus()
				.deleteRange(range)
				.insertContent(props.emoji)
				.run()
		},

		render: () => {
			let component: VueRenderer
			let popup: SuggestionPopup | null = null

			const unmount = () => {
				popup?.destroy()
				popup = null
				component?.destroy()
			}

			const mount = (props: SuggestionProps<EmojiEntry, EmojiEntry>) => {
				unmount()

				component = new VueRenderer(EmojiList, {
					props,
					editor: props.editor,
				})

				if (!props.clientRect) {
					unmount()
					return
				}

				popup = createSuggestionPopup(
					getPopupContainer(props.editor),
					component.element!,
					props.clientRect,
					props.editor.view.dom,
				)
			}

			return {
				onStart: (props: SuggestionProps<EmojiEntry, EmojiEntry>) => {
					if (!props.items.length && props.query === '') return
					mount(props)
				},

				onUpdate(props: SuggestionProps<EmojiEntry, EmojiEntry>) {
					if (!popup) {
						if (props.items.length || props.query !== '') mount(props)
						return
					}
					component?.updateProps(props)
					popup.reposition()
				},

				onKeyDown(props: {event: KeyboardEvent}) {
					if (props.event.key === 'Escape') {
						if (props.event.isComposing) return false
						if (popup) popup.element.style.display = 'none'
						return true
					}
					return component?.ref?.onKeyDown(props)
				},

				onExit: unmount,
			}
		},
	}
}
