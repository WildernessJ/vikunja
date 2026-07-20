import {describe, it, expect} from 'vitest'
import TeamMemberModel from './teamMember'
import UserSettingsModel from './userSettings'
import type {IUserSettings} from '@/modelTypes/IUserSettings'

describe('TeamMemberModel', () => {
	it('wraps settings in a UserSettingsModel even after the subclass re-runs assignData', () => {
		const member = new TeamMemberModel({settings: {name: 'from-payload'} as unknown as IUserSettings})

		expect(member.settings).toBeInstanceOf(UserSettingsModel)
		expect(member.settings.name).toBe('from-payload')
	})

	it('still populates its own fields (admin, teamId) and keeps settings wrapped when the payload omits settings', () => {
		const member = new TeamMemberModel({admin: true, teamId: 7})

		expect(member.admin).toBe(true)
		expect(member.teamId).toBe(7)
		// No settings key → normalize() re-wraps the already-built UserSettingsModel; assert that stays lossless.
		expect(member.settings).toBeInstanceOf(UserSettingsModel)
		expect(member.settings.frontendSettings).toBeDefined()
	})
})
