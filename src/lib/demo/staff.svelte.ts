import { getContext, setContext } from 'svelte';
import { sampleIncidents, type IncidentStatus } from './incidents.ts';

const contextKey = Symbol('handlink-staff-preview');

export class StaffPreview {
	incidents = $state(sampleIncidents.map((incident) => ({ ...incident })));
	readonly dispatcherName = 'Jamie Reyes';

	confirm(id: string, verballyConfirmed: boolean) {
		const incident = this.incidents.find((record) => record.id === id);
		if (!incident || incident.status !== 'Not assigned' || !verballyConfirmed) return false;
		incident.status = 'In progress';
		incident.dispatcher = this.dispatcherName;
		return true;
	}

	transition(id: string, status: IncidentStatus) {
		const incident = this.incidents.find((record) => record.id === id);
		if (!incident || incident.dispatcher !== this.dispatcherName) return false;
		if (
			!(incident.status === 'In progress' && status === 'On route') &&
			!(incident.status === 'On route' && status === 'Resolved')
		)
			return false;
		incident.status = status;
		incident.summary = '';
		if (status === 'Resolved') incident.endedAt = Date.now();
		return true;
	}

	saveNotes(id: string, notes: string) {
		const incident = this.incidents.find((record) => record.id === id);
		if (
			!incident ||
			incident.status === 'Not assigned' ||
			incident.dispatcher !== this.dispatcherName ||
			notes.length > 2000
		)
			return false;
		incident.notes = notes.trim();
		incident.summary = '';
		return true;
	}
}

export function createStaffPreview() {
	return setContext(contextKey, new StaffPreview());
}

export function getStaffPreview(): StaffPreview {
	const preview = getContext<StaffPreview>(contextKey);
	if (!preview) throw new Error('Staff preview must be created by the staff layout.');
	return preview;
}
