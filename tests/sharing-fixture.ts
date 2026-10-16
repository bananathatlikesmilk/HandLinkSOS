import { database } from './incident-fixture';

export function approveSharingTrust(ownerProfileId: string, requesterProfileId: string) {
	const id = crypto.randomUUID();
	const db = database();
	try {
		db.prepare(
			"INSERT INTO trusted_connection (id,owner_profile_id,requester_profile_id,relationship,status,approved_at) VALUES (?,?,?,'Sibling','approved',?)"
		).run(id, ownerProfileId, requesterProfileId, Date.now());
	} finally {
		db.close();
	}
	return id;
}

export function sharingInput(userId: string, durationMinutes = 15) {
	return {
		id: crypto.randomUUID(),
		durationMinutes,
		recipientUserIds: [userId],
		point: {
			latitude: 14.5995,
			longitude: 120.9842,
			accuracy: 12,
			recordedAt: new Date().toISOString()
		}
	};
}

export function expireSharing(id: string) {
	const db = database();
	try {
		const end = Date.now() - 1000;
		db.prepare('UPDATE location_session SET created_at=?,expires_at=? WHERE id=?').run(
			end - 60000,
			end,
			id
		);
	} finally {
		db.close();
	}
}
