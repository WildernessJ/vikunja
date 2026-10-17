import pluginVue from 'eslint-plugin-vue'
import js from '@eslint/js'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginDepend from 'eslint-plugin-depend'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import iconButtonAccessibleName from './eslint-rules/icon-button-accessible-name.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfigWithVueTs(
	js.configs.recommended,
	pluginVue.configs['flat/recommended'],
	vueTsConfigs.recommendedTypeChecked,
	pluginDepend.configs['flat/recommended'],
	{
		ignores: [
			'**/*.test.ts',
			'src/client/generated/**',
		],
	},
	{
		plugins: {
			vikunja: {
				rules: {
					'icon-button-accessible-name': iconButtonAccessibleName,
				},
			},
		},
		rules: {
			'vikunja/icon-button-accessible-name': 'error',

			'quotes': ['error', 'single'],
			'comma-dangle': ['error', 'always-multiline'],
			'semi': ['error', 'never'],
			'indent': ['error', 'tab', { 'SwitchCase': 1 }],

			'vue/v-on-event-hyphenation': ['warn', 'never', {'autofix': true}],
			'vue/multi-word-component-names': ['error', {
				ignores: [
					// Existing single-word components grandfathered in.
					// New components must use multi-word names per Vue style guide.
					'404',
					'About',
					'Attachments',
					'Auth',
					'Button.story',
					'Caldav',
					'Card',
					'Card.story',
					'Comments',
					'Datepicker',
					'Description',
					'Done',
					'Dropdown',
					'Error',
					'Expandable',
					'Filters',
					'Flatpickr',
					'Heading',
					'Home',
					'Icon',
					'index',
					'Label',
					'Labels',
					'Legal',
					'List',
					'Loading',
					'Login',
					'Logo',
					'Message',
					'Migration',
					'Modal',
					'Multiselect',
					'Navigation',
					'Nothing',
					'Notification',
					'Notifications',
					'Pagination',
					'Password',
					'Popup',
					'Reactions',
					'Ready',
					'Register',
					'Reminders',
					'Reminders.story',
					'Sessions',
					'Settings',
					'Shortcut',
					'Sort',
					'Subscription',
					'User',
				],
			}],

			// uncategorized rules:
			'vue/component-api-style': ['error', ['script-setup']],
			'vue/component-name-in-template-casing': ['error', 'PascalCase', {
				'globals': ['RouterView', 'RouterLink', 'Icon', 'Notifications', 'Modal', 'Card'],
			}],
			'vue/custom-event-name-casing': ['error', 'camelCase'],
			'vue/define-macros-order': 'error',
			'vue/match-component-file-name': ['error', {
				'extensions': ['.js', '.jsx', '.ts', '.tsx', '.vue'],
				'shouldMatchCase': true,
			}],
			'vue/match-component-import-name': 'error',
			'vue/prefer-separate-static-class': 'warn',

			'vue/padding-line-between-blocks': 'error',
			'vue/next-tick-style': ['error', 'promise'],
			'vue/block-lang': [
				'error',
				{'script': {'lang': 'ts'}},
			],
			'vue/no-duplicate-attr-inheritance': 'error',
			'vue/no-empty-component-block': 'error',
			'vue/html-indent': ['error', 'tab'],

			// vue3
			'vue/no-ref-object-reactivity-loss': 'error',
			'vue/no-setup-props-reactivity-loss': 'error',

			'depend/ban-dependencies': 'warn',

			'no-restricted-syntax': ['error', {
				selector: 'ForInStatement',
				message: 'Use for...of with Object.keys/entries, or .forEach, instead of for...in. See https://github.com/go-vikunja/vikunja/issues/513',
			}],

			// Vue Router reports a failed navigation through its resolved value and
			// router.onError, and nextTick rejects only when its callback throws.
			'@typescript-eslint/no-floating-promises': ['error', {
				allowForKnownSafeCalls: [
					{from: 'package', package: 'vue-router', name: ['push', 'replace']},
					{from: 'package', package: 'vue', name: 'nextTick'},
				],
			}],

			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					// 'args': 'all',
					// 'argsIgnorePattern': '^_',
					'caughtErrors': 'all',
					'caughtErrorsIgnorePattern': '^_',
					// 'destructuredArrayIgnorePattern': '^_',
					'varsIgnorePattern': '^_',
					'ignoreRestSiblings': true,
				},
			],
		},

		// files: ['*.vue', '**/*.vue'],
		languageOptions: {
			parserOptions: {
				parser: '@typescript-eslint/parser',
				ecmaVersion: 'latest',
				tsconfigRootDir: __dirname,
			},
		},


	},
	{
		// typescript-eslint types .vue imports as any, so InstanceType<typeof
		// Component> | null is reported as redundant. vue-tsc checks these types.
		files: ['**/*.vue'],
		rules: {
			'@typescript-eslint/no-redundant-type-constituents': 'off',
		},
	},
)
