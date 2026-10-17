import {useAuthStore} from '@/stores/auth'

import popSoundFile from '@/assets/audio/pop.mp3'

export function playPopSound() {
	const playSoundWhenDone = useAuthStore().settings.frontendSettings.playSoundWhenDone

	if (!playSoundWhenDone)
		return

	const logFailure = (e: unknown) => console.error('Could not play pop sound:', e)
	try {
		// play() rejects asynchronously (e.g. autoplay policy), which the try/catch alone misses.
		new Audio(popSoundFile).play().catch(logFailure)
	} catch (e) {
		logFailure(e)
	}
}
