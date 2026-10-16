import type { IncidentStatus } from './incidents.ts';

// Only these operational fields enter the local summary generator. Raw notes and profile fields never enter its output.
export function summarizeResponse(input: { notes: string; status: IncidentStatus }): string {
	const notes = input.notes.toLowerCase();
	let description = 'An emergency assistance request was recorded.';
	if (/heart attack|cardiac|chest pain/.test(notes)) {
		description =
			'Dispatcher notes describe a possible cardiac emergency; this is not a confirmed diagnosis.';
	} else if (/breathing|shortness of breath/.test(notes)) {
		description = 'Dispatcher notes describe breathing difficulty.';
	} else if (/injury|injured|bleeding/.test(notes)) {
		description = 'Dispatcher notes describe an injury requiring assistance.';
	} else if (/confirmed safe|confirmed they were safe|safety check/.test(notes)) {
		description = 'Dispatcher notes record a safety check.';
	}
	return `${description} Response status: ${input.status.toLowerCase()}. Review against dispatcher notes before use.`;
}

export function reportTime(timestamp: number | null): string {
	return timestamp === null
		? 'Ongoing'
		: new Intl.DateTimeFormat('en-PH', {
				timeZone: 'Asia/Manila',
				dateStyle: 'medium',
				timeStyle: 'medium'
			}).format(timestamp);
}

export function reportDuration(startedAt: number, endedAt: number | null): string {
	if (endedAt === null) return 'Ongoing';
	const seconds = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
	return `${Math.floor(seconds / 60)} min ${seconds % 60} sec`;
}
