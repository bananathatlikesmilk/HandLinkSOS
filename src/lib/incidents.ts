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
	lguId: string | null;
	lguName: string | null;
	routingReason: string;
	id: string;
	reference: string;
	personName: string;
	callerName: string;
	callerPhone: string;
	isForSomeoneElse: boolean;
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
		latitude: number;
		longitude: number;
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
	latitude: number;
	longitude: number;
	locationLabel: string;
	notes: string;
};
