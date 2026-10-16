import type { IncidentCancellation, IncidentStatus } from './incidents.ts';

export type SosNotification = {
	type: 'sos';
	id: string;
	incidentId: string;
	incidentReference: string;
	callerName: string;
	personName: string;
	status: IncidentStatus;
	createdAt: string;
	readAt: string | null;
	cancellation: IncidentCancellation | null;
};

export type LocationNotification = {
	id: string;
	type: 'location_shared' | 'location_expiring' | 'location_expired';
	sessionId: string;
	expiresAt: string;
	ownerName: string;
	isOwner: boolean;
	sessionStatus: 'active' | 'cancelled' | 'expired' | 'unavailable';
	createdAt: string;
	readAt: string | null;
};

export type AppNotification = SosNotification | LocationNotification;
