export type IncidentStatus = 'Not assigned' | 'In progress' | 'On route' | 'Resolved';

export function incidentDuration(start: string, end: string | null) {
	if (!end) return 'Ongoing';
	const seconds = Math.max(0, Math.floor((Date.parse(end) - Date.parse(start)) / 1000));
	return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ${seconds % 60}s`;
}

export type IncidentLocationSnapshot = {
	latitude: number;
	longitude: number;
	accuracy: number;
	recordedAt: string;
};

export type IncidentCancellation = {
	id: string;
	reason: string;
	decision: 'pending' | 'approved' | 'rejected';
	requestedAt: string;
	reviewedAt: string | null;
	reviewedByUserId: string | null;
};

export type IncidentSummary = {
	provincialWorkflow?: boolean;
	provincialIntake?: boolean;
	suggestedLguId?: string | null;
	suggestedLguName?: string | null;
	suggestionReason?: string | null;
	lguId: string | null;
	lguName: string | null;
	routingReason: string;
	id: string;
	reference: string;
	personName: string;
	callerName: string;
	callerPhone: string;
	isForSomeoneElse: boolean;
	isStranger: boolean;
	emergencyDescription: string;
	locationSource: 'device' | 'reported';
	callerRelationship: string;
	status: IncidentStatus;
	dispatcherUserId: string | null;
	dispatcherName: string | null;
	startedAt: string;
	confirmedAt: string | null;
	endedAt: string | null;
	cancellationPending: boolean;
};

export type IncidentDetail = {
	responseUpdates?: ResponseUpdate[];
	coordination?: {
		latitude: number | null;
		longitude: number | null;
		locationLabel: string;
		personLocation: IncidentLocationSnapshot | null;
		history: { id: string; destination: string; actorName: string; createdAt: string }[];
	};
	noteId: string | null;
	cancellation: IncidentCancellation | null;
	incident: IncidentSummary;
	personal: null | {
		personLocation: IncidentLocationSnapshot | null;
		firstName: string;
		lastName: string;
		age: number;
		sex: string;
		phone: string;
		latitude: number | null;
		longitude: number | null;
		locationLabel: string;
	};
	medical: null | {
		bloodType: string | null;
		chronicCondition: string;
		allergies: string;
		currentMedications: string;
		additionalInformation: string;
	};
	emergencyContacts: {
		firstName: string;
		lastName: string;
		phone: string;
		email: string;
		relationship: string;
	}[];
	notes: string;
	events: { id: string; type: string; notes: string; createdAt: string }[];
};

export type IncidentReport = {
	responseUpdates?: ResponseUpdate[];
	personLocation: IncidentLocationSnapshot | null;
	addenda: {
		id: string;
		notes: string;
		createdAt: string;
		authorName: string;
		actorUserId: string;
	}[];
	ai: import('./ai-summary.ts').AiSummaryState;
	cancellation: IncidentCancellation | null;
	incident: IncidentSummary;
	callerRelationship: string;
	latitude: number | null;
	longitude: number | null;
	locationLabel: string;
	notes: string;
};

export type ResponseUpdate = {
	id: string;
	type: string;
	notes: string;
	createdAt: string;
	actorName: string;
};

export function incidentStatusLabel(incident: IncidentSummary) {
	if (!incident.provincialWorkflow) return incident.status;
	return incident.status === 'Not assigned'
		? 'Received'
		: incident.status === 'In progress'
			? 'Coordinating'
			: incident.status;
}
