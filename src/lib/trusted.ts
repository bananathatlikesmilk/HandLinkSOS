export type TrustedConnection = {
	id: string;
	invitationId: string | null;
	ownerProfileId: string;
	ownerName: string;
	requesterProfileId: string;
	requesterName: string;
	relationship: string;
	status: 'pending' | 'approved' | 'revoked';
	createdAt: string;
	approvedAt: string | null;
	revokedAt: string | null;
};
