export type SharingRecipient = {
	userId: string;
	name: string;
	kind: 'trusted' | 'emergency_contact' | 'both';
};

export type LocationPoint = {
	latitude: number;
	longitude: number;
	accuracy: number;
	recordedAt: string;
};

export type SharedLocationSession = {
	id: string;
	ownerName: string;
	startedAt: string;
	expiresAt: string;
	cancelledAt: string | null;
	status: 'active' | 'cancelled' | 'expired';
	isOwner: boolean;
	point: LocationPoint | null;
	recipients: SharingRecipient[];
};

export type SharingState = {
	own: SharedLocationSession | null;
	incoming: SharedLocationSession[];
	recipients: SharingRecipient[];
};
