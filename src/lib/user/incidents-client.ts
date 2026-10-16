export type SosTarget = { id: string; name: string };

export type PendingSos = {
	personProfileId: string;
	latitude: number;
	longitude: number;
	locationLabel: string;
	idempotencyKey: string;
};

export {
	apiRequest as incidentRequest,
	ApiRequestError as IncidentRequestError
} from '../client/request.ts';

export function readPendingSos(key: string): PendingSos | null {
	const raw = sessionStorage.getItem(key);
	if (!raw) return null;
	const value = JSON.parse(raw) as Partial<PendingSos>;
	if (
		typeof value.personProfileId !== 'string' ||
		typeof value.idempotencyKey !== 'string' ||
		typeof value.latitude !== 'number' ||
		!Number.isFinite(value.latitude) ||
		typeof value.longitude !== 'number' ||
		!Number.isFinite(value.longitude) ||
		typeof value.locationLabel !== 'string'
	)
		throw new Error(
			'Saved SOS request is unreadable. Return to the dashboard and check recent alerts.'
		);
	return value as PendingSos;
}
