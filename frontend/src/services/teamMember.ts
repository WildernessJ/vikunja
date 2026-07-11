import AbstractService from './abstractService'
import TeamMemberModel from '@/models/teamMember'
import type {ITeamMember} from '@/modelTypes/ITeamMember'

export default class TeamMemberService extends AbstractService<ITeamMember> {
	constructor() {
		super({
			create: '/teams/{teamId}/members',
			delete: '/teams/{teamId}/members/{username}',
			update: '/teams/{teamId}/members/{username}/admin',
		})
	}

	modelFactory(data: Partial<ITeamMember>) {
		return new TeamMemberModel(data)
	}

	beforeCreate(model: ITeamMember) {
		// The api wants to get the user id as user_id; ITeamMember has no userId field, so bolt it on for the request payload.
		(model as ITeamMember & {userId?: ITeamMember['id']}).userId = model.id
		model.admin = model.admin === null ? false : model.admin
		return model
	}
}
