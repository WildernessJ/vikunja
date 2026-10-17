interface IUserStatsDay {
	date: string
	count: number
}

interface IUserProjectStats {
	projectId: number
	open: number
	completedInWindow: number
	overdue: number
}

export interface IUserStats {
	completedPerDay: IUserStatsDay[]
	completedInProjects: number
	createdByMe: number
	open: number
	overdue: number
	projects: IUserProjectStats[]
}
