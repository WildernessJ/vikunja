import {spawnSync} from 'node:child_process'
import {readFileSync, writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'

// Per-file typecheck ratchet. `vue-tsc` reports ~900 pre-existing errors that
// can only be burned down incrementally (see issue #21). A plain pass/fail gate
// is impossible until the tree is clean, and a single total-count gate is
// gameable (add an error in one file, remove one in another). This tracks a
// committed per-file error budget instead: CI fails if any file exceeds its
// budget, and the budget only ever ratchets down as files are cleaned.

const FRONTEND_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_PATH = join(FRONTEND_DIR, 'typecheck-baseline.json')

// Primary diagnostic lines look like:
//   src/foo/Bar.vue(12,34): error TS2345: Argument of type ...
// Continuation lines are indented and never match this anchor. The path capture
// is non-greedy so a `(` inside a path (e.g. src/legacy(v1)/X.vue) doesn't cut
// it short — it stops at the `(line,col)` position marker, not the first paren.
const ERROR_LINE = /^(src\/.+?)\(\d+,\d+\): error TS\d+:/

function collectErrorsPerFile() {
	// Reuse the canonical `typecheck` script so this stays in sync with whatever
	// flags it uses. vue-tsc exits non-zero when errors exist — that is expected;
	// we parse its output rather than trusting the exit code.
	const run = spawnSync('pnpm', ['run', '--silent', 'typecheck'], {
		cwd: FRONTEND_DIR,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	})

	if (run.error) {
		console.error(`Failed to run vue-tsc: ${run.error.message}`)
		process.exit(2)
	}

	// vue-tsc double-prints some diagnostics across project references, so dedup
	// on the full line before counting.
	const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
	const uniqueLines = new Set()
	for (const line of output.split('\n')) {
		if (ERROR_LINE.test(line)) {
			uniqueLines.add(line.trimEnd())
		}
	}

	// vue-tsc exits 0 only when the tree is clean. A non-zero exit with no parsed
	// diagnostics means it crashed or is misconfigured — treat that as a hard
	// failure rather than silently reporting "0 errors" (which would look like a
	// mass improvement and could erase the whole baseline on --update).
	if (uniqueLines.size === 0 && run.status !== 0) {
		console.error('vue-tsc produced no parseable diagnostics but exited non-zero — it likely crashed. Raw output:\n')
		console.error(output.trim())
		process.exit(2)
	}

	const perFile = {}
	for (const line of uniqueLines) {
		const file = line.match(ERROR_LINE)[1]
		perFile[file] = (perFile[file] ?? 0) + 1
	}
	return perFile
}

function sortedByFile(counts) {
	return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

function total(counts) {
	return Object.values(counts).reduce((sum, n) => sum + n, 0)
}

function update() {
	const current = collectErrorsPerFile()
	writeFileSync(BASELINE_PATH, `${JSON.stringify(sortedByFile(current), null, '\t')}\n`)
	console.log(`Wrote baseline: ${Object.keys(current).length} files, ${total(current)} errors → typecheck-baseline.json`)
}

function check() {
	let baseline
	try {
		baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
	} catch {
		console.error('No typecheck-baseline.json found. Run `pnpm typecheck:update` to create one.')
		process.exit(2)
	}

	const current = collectErrorsPerFile()
	const files = [...new Set([...Object.keys(baseline), ...Object.keys(current)])].sort()

	const regressions = []
	const improvements = []
	for (const file of files) {
		const was = baseline[file] ?? 0
		const now = current[file] ?? 0
		if (now > was) {
			regressions.push({file, was, now})
		} else if (now < was) {
			improvements.push({file, was, now})
		}
	}

	if (regressions.length === 0 && improvements.length === 0) {
		console.log(`✓ Typecheck ratchet holds: ${total(current)} errors across ${Object.keys(current).length} files, all within budget.`)
		return
	}

	if (regressions.length > 0) {
		console.error(`\n✗ Typecheck regressions — these files gained new type errors:\n`)
		for (const {file, was, now} of regressions) {
			console.error(`    ${file}: ${was} → ${now}  (+${now - was})`)
		}
		console.error('\nFix the new errors, or if they are unavoidable, they must be justified in review.')
	}

	if (improvements.length > 0) {
		console.error(`\n↓ Typecheck improvements — the baseline is now stale and must be committed:\n`)
		for (const {file, was, now} of improvements) {
			console.error(`    ${file}: ${was} → ${now}  (${now - was})`)
		}
		console.error('\nRun `pnpm typecheck:update` and commit typecheck-baseline.json to lock in these wins.')
	}

	process.exit(1)
}

const mode = process.argv[2]
if (mode === '--update') {
	update()
} else if (mode === '--check') {
	check()
} else {
	console.error('Usage: node scripts/typecheck-ratchet.mjs --check | --update')
	process.exit(2)
}
