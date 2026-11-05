export type SosTarget = { id: string; name: string; favorite: boolean };

export type PendingSos = {
	personProfileId: string | null;
	strangerName?: string;
	emergencyDescription?: string;
	locationSource?: 'device' | 'reported';
	latitude: number | null;
	longitude: number | null;
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
		(typeof value.personProfileId !== 'string' && value.personProfileId !== null) ||
		(value.personProfileId === null &&
			(typeof value.strangerName !== 'string' ||
				typeof value.emergencyDescription !== 'string' ||
				!value.emergencyDescription.trim() ||
				!['device', 'reported'].includes(value.locationSource ?? ''))) ||
		typeof value.idempotencyKey !== 'string' ||
		!(
			(typeof value.latitude === 'number' &&
				Number.isFinite(value.latitude) &&
				typeof value.longitude === 'number' &&
				Number.isFinite(value.longitude)) ||
			(value.personProfileId === null &&
				value.locationSource === 'reported' &&
				value.latitude === null &&
				value.longitude === null)
		) ||
		typeof value.locationLabel !== 'string'
	)
		throw new Error(
			'Saved SOS request is unreadable. Return to the dashboard and check recent alerts.'
		);
	return value as PendingSos;
}
