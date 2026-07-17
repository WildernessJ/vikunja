import UserModel from './user'

import type {ITeamMember} from '@/modelTypes/ITeamMember'
import type {IProject} from '@/modelTypes/IProject'

export default class TeamMemberModel extends UserModel implements ITeamMember {
	admin = false
	teamId: IProject['id'] = 0

	constructor(data: Partial<ITeamMember>) {
		super(data)
		this.assignData(data)

		// assignData re-ran here overwrites the base's date conversion with the raw payload strings.
		this.created = new Date(this.created)
		this.updated = new Date(this.updated)
	}
}
