<template>
	<div class="content">
		<div class="stats-header">
			<h1>{{ $t('user.stats.title') }}</h1>
			<label class="stats-window">
				<span class="stats-window-label">{{ $t('user.stats.window.label') }}</span>
				<div
					class="select"
					:class="{'is-loading': loading}"
				>
					<select
						v-model.number="weeks"
						data-cy="statsWindowSelector"
						:disabled="loading"
					>
						<option
							v-for="option in windowOptions"
							:key="option"
							:value="option"
						>
							{{ $t('user.stats.window.weeks', {count: option}) }}
						</option>
					</select>
				</div>
			</label>
		</div>

		<Message
			v-if="error"
			variant="danger"
			data-cy="statsError"
		>
			{{ $t('user.stats.loadError') }}
		</Message>

		<div
			v-else
			class="stats-tiles"
		>
			<div
				class="stats-tile"
				data-cy="statsCompletedInProjects"
			>
				<span class="stats-tile-value">{{ stats.completedInProjects }}</span>
				<span class="stats-tile-label">{{ $t('user.stats.completedInProjects') }}</span>
				<span class="stats-tile-hint">{{ $t('user.stats.completedInProjectsHint') }}</span>
			</div>
			<div
				class="stats-tile"
				data-cy="statsCreatedByMe"
			>
				<span class="stats-tile-value">{{ stats.createdByMe }}</span>
				<span class="stats-tile-label">{{ $t('user.stats.createdByMe') }}</span>
			</div>
			<div
				class="stats-tile"
				data-cy="statsOpen"
			>
				<span class="stats-tile-value">{{ stats.open }}</span>
				<span class="stats-tile-label">{{ $t('user.stats.open') }}</span>
			</div>
			<div
				class="stats-tile"
				data-cy="statsOverdue"
			>
				<span class="stats-tile-value">{{ stats.overdue }}</span>
				<span class="stats-tile-label">{{ $t('user.stats.overdue') }}</span>
			</div>
		</div>

		<Card
			v-if="!error"
			:title="$t('user.stats.completedInProjects')"
			:loading="loading"
		>
			<svg
				data-cy="statsChart"
				class="stats-chart"
				role="img"
				:aria-label="chartAriaLabel"
				:viewBox="`0 0 ${chartWidth} ${chartHeight}`"
				preserveAspectRatio="none"
			>
				<!-- baseline -->
				<line
					class="stats-chart-axis"
					:x1="padding.left"
					:y1="chartHeight - padding.bottom"
					:x2="chartWidth - padding.right"
					:y2="chartHeight - padding.bottom"
				/>
				<!-- y-axis max gridline + label -->
				<line
					class="stats-chart-grid"
					:x1="padding.left"
					:y1="padding.top"
					:x2="chartWidth - padding.right"
					:y2="padding.top"
				/>
				<text
					class="stats-chart-tick"
					:x="padding.left - 6"
					:y="padding.top + 4"
					text-anchor="end"
				>{{ maxCount }}</text>
				<text
					class="stats-chart-tick"
					:x="padding.left - 6"
					:y="chartHeight - padding.bottom + 4"
					text-anchor="end"
				>0</text>

				<g
					v-for="bar in bars"
					:key="bar.date"
				>
					<rect
						class="stats-chart-bar"
						:x="bar.x"
						:y="bar.y"
						:width="bar.width"
						:height="bar.height"
						rx="2"
					>
						<title>{{ bar.tooltip }}</title>
					</rect>
				</g>
			</svg>
			<p class="stats-chart-caption">
				{{ $t('user.stats.chartCaption', {start: rangeStartLabel, end: rangeEndLabel}) }}
			</p>
		</Card>

		<Card
			v-if="!error"
			:title="$t('user.stats.projectBreakdown')"
			:loading="loading"
		>
			<table
				v-if="stats.projects.length > 0"
				class="table has-actions is-striped is-hoverable is-fullwidth"
			>
				<thead>
					<tr>
						<th>{{ $t('user.stats.project') }}</th>
						<th class="has-text-right">
							{{ $t('user.stats.open') }}
						</th>
						<th class="has-text-right">
							{{ $t('user.stats.completedInWindow') }}
						</th>
						<th class="has-text-right">
							{{ $t('user.stats.overdue') }}
						</th>
					</tr>
				</thead>
				<tbody>
					<tr
						v-for="project in stats.projects"
						:key="project.projectId"
						data-cy="statsProjectRow"
						:data-project-id="project.projectId"
					>
						<td>
							<RouterLink :to="{name: 'project.index', params: {projectId: project.projectId}}">
								{{ projectTitle(project.projectId) }}
							</RouterLink>
						</td>
						<td class="has-text-right">
							{{ project.open }}
						</td>
						<td class="has-text-right">
							{{ project.completedInWindow }}
						</td>
						<td class="has-text-right">
							{{ project.overdue }}
						</td>
					</tr>
				</tbody>
			</table>
			<p v-else>
				{{ $t('user.stats.noProjects') }}
			</p>
		</Card>
	</div>
</template>

<script lang="ts" setup>
import {computed, ref, watch} from 'vue'
import {useI18n} from 'vue-i18n'

import Card from '@/components/misc/Card.vue'
import Message from '@/components/misc/Message.vue'
import {useTitle} from '@/composables/useTitle'
import {useProjectStore} from '@/stores/projects'
import {getUserStats} from '@/services/userStats'
import type {IUserStats} from '@/modelTypes/IUserStats'
import {formatDate} from '@/helpers/time/formatDate'

const {t} = useI18n({useScope: 'global'})

useTitle(() => t('user.stats.title'))

const projectStore = useProjectStore()

// Every option is within the API's accepted 1..52 range, so the selector can
// never produce a value the endpoint would reject.
const windowOptions = [4, 12, 26, 52] as const
const weeks = ref<number>(12)

const stats = ref<IUserStats>({
	completedPerDay: [],
	completedInProjects: 0,
	createdByMe: 0,
	open: 0,
	overdue: 0,
	projects: [],
})

const loading = ref(false)
const error = ref(false)

async function loadStats() {
	loading.value = true
	error.value = false
	try {
		stats.value = await getUserStats(weeks.value)
	} catch {
		// Surface a load failure instead of leaving stale-or-zeroed figures that
		// are indistinguishable from a genuinely empty account.
		error.value = true
	} finally {
		loading.value = false
	}
}

watch(weeks, loadStats, {immediate: true})

function projectTitle(projectId: number): string {
	return projectStore.projects[projectId]?.title ?? `#${projectId}`
}

const maxCount = computed(() => Math.max(1, ...stats.value.completedPerDay.map(d => d.count)))

// A fixed viewBox scaled by preserveAspectRatio="none"; the surrounding CSS
// controls the rendered size, so these are just the internal coordinate space.
const chartWidth = 720
const chartHeight = 220
const padding = {top: 12, right: 8, bottom: 20, left: 28}

const bars = computed(() => {
	const days = stats.value.completedPerDay
	const plotWidth = chartWidth - padding.left - padding.right
	const plotHeight = chartHeight - padding.top - padding.bottom
	const count = days.length || 1
	const slot = plotWidth / count
	const gap = Math.min(2, slot * 0.2)
	const barWidth = Math.max(1, slot - gap)

	return days.map((day, i) => {
		const height = (day.count / maxCount.value) * plotHeight
		return {
			date: day.date,
			x: padding.left + i * slot + gap / 2,
			y: chartHeight - padding.bottom - height,
			width: barWidth,
			height,
			tooltip: t('user.stats.barTooltip', {count: day.count, date: day.date}),
		}
	})
})

const chartAriaLabel = computed(() =>
	t('user.stats.chartAriaLabel', {count: stats.value.completedInProjects}),
)

const rangeStartLabel = computed(() => {
	const first = stats.value.completedPerDay[0]
	return first ? formatDate(first.date, 'PP') : ''
})
const rangeEndLabel = computed(() => {
	const last = stats.value.completedPerDay[stats.value.completedPerDay.length - 1]
	return last ? formatDate(last.date, 'PP') : ''
})
</script>

<style lang="scss" scoped>
.stats-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
	flex-wrap: wrap;
}

.stats-window {
	display: flex;
	align-items: center;
	gap: .5rem;
}

.stats-window-label {
	color: var(--text-light);
	font-size: .9rem;
}

.stats-tiles {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
	gap: 1rem;
	margin-block: 1.5rem;
}

.stats-tile {
	display: flex;
	flex-direction: column;
	gap: .25rem;
	padding: 1rem 1.25rem;
	background: var(--card-color, var(--white));
	border: 1px solid var(--card-border-color);
	border-radius: $radius;
}

.stats-tile-value {
	font-size: 2rem;
	font-weight: 700;
	line-height: 1.1;
	color: var(--text-strong, var(--text));
}

.stats-tile-label {
	font-weight: 600;
	color: var(--text);
}

.stats-tile-hint {
	font-size: .8rem;
	color: var(--text-light);
}

.stats-chart {
	display: block;
	inline-size: 100%;
	block-size: 220px;
}

.stats-chart-bar {
	fill: var(--primary);
}

.stats-chart-axis,
.stats-chart-grid {
	stroke: var(--grey-300);
	stroke-width: 1;
}

.stats-chart-grid {
	stroke-dasharray: 2 3;
}

.stats-chart-tick {
	fill: var(--text-light);
	font-size: 11px;
}

.stats-chart-caption {
	margin-block-start: .5rem;
	color: var(--text-light);
	font-size: .85rem;
}
</style>
