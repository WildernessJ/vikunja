import AbstractService from './abstractService'
import TeamProjectModel from '@/models/teamProject'
import type {ITeamProject} from '@/modelTypes/ITeamProject'
import type {ITeam} from '@/modelTypes/ITeam'
import TeamModel from '@/models/team'

export default class TeamProjectService extends AbstractService<ITeamProject> {
	constructor() {
		super({
			create: '/projects/{projectId}/teams',
			getAll: '/projects/{projectId}/teams',
			update: '/projects/{projectId}/teams/{teamId}',
			delete: '/projects/{projectId}/teams/{teamId}',
		})
	}

	modelFactory(data: Partial<ITeamProject>) {
		return new TeamProjectModel(data)
	}

	// The get-all route returns teams (not team-project share records), unlike the base factory contract.
	modelGetAllFactory(data: Partial<ITeamProject>): ITeamProject {
		return new TeamModel(data as unknown as Partial<ITeam>) as unknown as ITeamProject
	}
}
