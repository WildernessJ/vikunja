import TeamShareBaseModel from './teamShareBase'

import type {ITeamProject} from '@/modelTypes/ITeamProject'
import type {IProject} from '@/modelTypes/IProject'

export default class TeamProjectModel extends TeamShareBaseModel implements ITeamProject {
	projectId: IProject['id'] = 0

	constructor(data: Partial<ITeamProject>) {
		super(data)
		this.assignData(data)

		// assignData re-ran here overwrites the base's date conversion with the raw payload strings.
		this.created = new Date(this.created)
		this.updated = new Date(this.updated)
	}
}
