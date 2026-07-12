import AbstractService from './abstractService'
import UserProjectModel from '@/models/userProject'
import type {IUserProject} from '@/modelTypes/IUserProject'
import type {IUser} from '@/modelTypes/IUser'
import UserModel from '@/models/user'

export default class UserProjectService extends AbstractService<IUserProject> {
	constructor() {
		super({
			create: '/projects/{projectId}/users',
			getAll: '/projects/{projectId}/users',
			update: '/projects/{projectId}/users/{username}',
			delete: '/projects/{projectId}/users/{username}',
		})
	}

	modelFactory(data: Partial<IUserProject>) {
		return new UserProjectModel(data)
	}

	// The get-all route returns users (not user-project share records), unlike the base factory contract.
	modelGetAllFactory(data: Partial<IUserProject>): IUserProject {
		return new UserModel(data as unknown as Partial<IUser>) as unknown as IUserProject
	}
}
