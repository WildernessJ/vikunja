import {describe, expect, it} from 'vitest'
import {Schema} from '@tiptap/pm/model'
import type {Decoration} from '@tiptap/pm/view'

import {decorateDocument} from './highlighter'

const schema = new Schema({
	nodes: {
		doc: {content: 'paragraph+'},
		paragraph: {content: 'text*'},
		text: {inline: true},
	},
})

function filterDocument(value: string) {
	return schema.node('doc', null, [
		schema.node('paragraph', null, [schema.text(value)]),
	])
}

// Decoration's attrs live on its internal `type`, which ProseMirror's public types omit.
function attrsOf(decoration: Decoration | undefined): Record<string, string> | undefined {
	return (decoration as unknown as {type?: {attrs?: Record<string, string>}} | undefined)?.type?.attrs
}

describe('filter highlighter', () => {
	it('uses loaded label data when recalculating decorations', () => {
		const doc = filterDocument('labels = "Work"')

		const before = decorateDocument(doc, [])
		const after = decorateDocument(doc, [{id: 1, title: 'Work', hex_color: 'ff006e'}])

		expect(before.find()).not.toEqual(after.find())
	})

	it('marks unquoted date values as clickable', () => {
		const decorations = decorateDocument(filterDocument('dueDate < now/w+1w'), []).find()
		const dateValue = decorations.find(d => attrsOf(d)?.class === 'date-value')
		expect(dateValue).toBeDefined()
		expect(attrsOf(dateValue)?.['data-date-value']).toBe('now/w+1w')
	})

	it('marks unquoted label values', () => {
		const text = 'labels = Work'
		const decorations = decorateDocument(filterDocument(text), [{id: 1, title: 'Work', hex_color: 'ff006e'}]).find()
		const labelValue = decorations.find(d => attrsOf(d)?.class === 'label-value')
		expect(labelValue).toBeDefined()
		const valueStart = text.lastIndexOf('Work')
		expect(labelValue?.from).toBe(valueStart + 1)
		expect(labelValue?.to).toBe(valueStart + 1 + 'Work'.length)
	})

	it('marks the value, not the field name, when field and value share a name', () => {
		const text = 'dueDate < dueDate'
		const decorations = decorateDocument(filterDocument(text), []).find()
		const dateValue = decorations.find(d => attrsOf(d)?.class === 'date-value')
		expect(dateValue).toBeDefined()
		const valueStart = text.lastIndexOf('dueDate')
		expect(dateValue?.from).toBe(valueStart + 1)
		expect(dateValue?.to).toBe(valueStart + 1 + 'dueDate'.length)
	})
})
