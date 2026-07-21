import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'

import AbstractService from './abstractService'
import AttachmentService from './attachment'
import type {IAttachment} from '@/modelTypes/IAttachment'

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

function serviceWithBlobResponse(blob: Blob) {
	const service = new AttachmentService()
	service.http = vi.fn().mockResolvedValue({data: blob}) as unknown as typeof service.http
	return service
}

describe('getBlobUrl', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('keeps the mime type of the fetched blob', async () => {
		// A blob url without a type downloads instead of rendering when used as iframe src
		const service = serviceWithBlobResponse(new Blob(['%PDF-1.4'], {type: 'application/pdf'}))
		const createObjectURL = vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:mock')

		const url = await service.getBlobUrl({taskId: 1, id: 1} as IAttachment)

		expect(url).toBe('blob:mock')
		const blob = createObjectURL.mock.calls[0][0] as Blob
		expect(blob.type).toBe('application/pdf')
		expect(blob.size).toBeGreaterThan(0)
	})

	it('converts svg blobs to data urls', async () => {
		const service = serviceWithBlobResponse(new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], {type: 'image/svg+xml'}))

		const url = await service.getBlobUrl({taskId: 1, id: 2} as IAttachment)

		expect(url).toMatch(/^data:image\/svg\+xml/)
	})
})
