import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'

import AbstractService from './abstractService'

class TestService extends AbstractService {}

describe('AbstractService.setLoading ref-counting', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('never shows the spinner for a request settling before 100ms', () => {
		const service = new TestService()

		const cancel = service.setLoading()
		vi.advanceTimersByTime(50)
		cancel()

		expect(service.loading).toBe(false)

		vi.advanceTimersByTime(100)
		expect(service.loading).toBe(false)
	})

	it('shows the spinner after 100ms and hides it on cancel for a slow request', () => {
		const service = new TestService()

		const cancel = service.setLoading()
		expect(service.loading).toBe(false)

		vi.advanceTimersByTime(100)
		expect(service.loading).toBe(true)

		cancel()
		expect(service.loading).toBe(false)
	})

	it('keeps the spinner on until BOTH overlapping requests finish', () => {
		const service = new TestService()

		const cancelA = service.setLoading()
		vi.advanceTimersByTime(100)
		expect(service.loading).toBe(true)

		const cancelB = service.setLoading()

		// The first cancel must NOT drop loading while B is still in flight.
		cancelA()
		expect(service.loading).toBe(true)

		cancelB()
		expect(service.loading).toBe(false)
	})

	it('does not get stuck on when a stale timer fires after its cancel already ran', () => {
		const service = new TestService()

		// Request A cancels before its timer fires: its (now irrelevant) timer must
		// not flip loading true later.
		const cancelA = service.setLoading()
		vi.advanceTimersByTime(50)
		cancelA()
		expect(service.loading).toBe(false)

		// A fresh request that also settles fast must remain spinner-free even though
		// A's timer window has elapsed in wall-clock terms.
		const cancelB = service.setLoading()
		vi.advanceTimersByTime(50)
		cancelB()

		vi.advanceTimersByTime(200)
		expect(service.loading).toBe(false)
	})
})
