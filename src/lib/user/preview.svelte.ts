import { getContext } from 'svelte';

export type EmergencyContact = {
	id: string;
	firstName: string;
	lastName: string;
	phone: string;
	email: string;
	relationship: string;
};
export type UserProfile = {
	id: string;
	firstName: string;
	lastName: string;
	birthday: string;
	sex: string;
	phone: string;
	email: string;
	bloodType: string;
	chronicCondition: string;
	allergies: string;
	currentMedications: string;
	additionalInformation: string;
	contacts: EmergencyContact[];
};
export type TrustedProfile = { id: string; name: string };
export type SharedLocation = {
	id: string;
	personId: string;
	name: string;
	startedAt: number;
	expiresAt: number;
	lastUpdatedAt: number;
	latitude: number;
	longitude: number;
};
export type PreviewNotice = { id: number; title: string; detail: string; shareId?: string };
export const USER_PREVIEW = Symbol('handlink-user-preview');
export const DEMO_CODE = '123456';

export function emptyProfile(): UserProfile {
	return {
		id: '',
		firstName: '',
		lastName: '',
		birthday: '',
		sex: '',
		phone: '',
		email: '',
		bloodType: '',
		chronicCondition: '',
		allergies: '',
		currentMedications: '',
		additionalInformation: '',
		contacts: []
	};
}

export class UserPreview {
	profile = $state<UserProfile>(emptyProfile());
	trusted = $state<TrustedProfile[]>([]);
	emailVerified = $state(false);
	accountActive = $state(true);
	loggedIn = $state(false);
	recoveryEmail = $state('');
	recoveryVerified = $state(false);
	recoveryCode = $state('');
	clock = $state(Date.now());
	allowLocation = $state(false);
	allowOverlay = $state(false);
	qrApprovedUntil = $state(0);
	notifications = $state<PreviewNotice[]>([]);
	notificationTrayOpen = $state(false);
	showIncomingNotice = $state(false);
	incoming = $state<SharedLocation[]>([]);
	sharing = $state<{ startedAt: number; expiresAt: number } | null>(null);
	alert = $state<{
		phase: 'idle' | 'countdown' | 'cancelled' | 'sent' | 'call';
		targetId: string;
		name: string;
		deadline: number;
		redirectAt: number;
	}>({ phase: 'idle', targetId: '', name: '', deadline: 0, redirectAt: 0 });
	private noticeId = 0;

	loadAccount(profile: UserProfile | null, signedIn: boolean) {
		this.profile = profile ? structuredClone($state.snapshot(profile)) : emptyProfile();
		this.loggedIn = signedIn;
		this.emailVerified = signedIn;
		this.trusted = [];
		this.incoming = [];
		this.notifications = [];
		this.sharing = null;
		this.alert.phase = 'idle';
		this.qrApprovedUntil = 0;
	}

	get fullName() {
		return `${this.profile.firstName} ${this.profile.lastName}`.trim();
	}
	get countdown() {
		return Math.max(0, Math.ceil((this.alert.deadline - this.clock) / 1000));
	}
	get sharingRemaining() {
		return this.sharing ? Math.max(0, Math.ceil((this.sharing.expiresAt - this.clock) / 1000)) : 0;
	}
	get qrUnlocked() {
		return this.accountActive && this.qrApprovedUntil > this.clock;
	}
	registerProfile(profile: UserProfile) {
		this.logout();
		this.profile = structuredClone(profile);
		this.trusted = [];
		this.incoming = [];
		this.notifications = [];
		this.notificationTrayOpen = false;
		this.showIncomingNotice = false;
		this.emailVerified = false;
		this.accountActive = true;
		this.recoveryEmail = '';
		this.recoveryVerified = false;
	}

	notify(title: string, detail: string, shareId?: string) {
		this.notifications.unshift({ id: ++this.noticeId, title, detail, shareId });
	}

	tick(now = Date.now()) {
		this.clock = now;
	}
	startSos(targetId = this.profile.id) {
		void targetId;
		return false;
	}

	cancelSos() {
		if (this.alert.phase !== 'countdown') return;
		this.alert.phase = 'cancelled';
	}

	startSharing(minutes: number) {
		void minutes;
		return false;
	}

	stopSharing() {
		if (!this.sharing) return;
		this.sharing = null;
		this.notify(
			'Location sharing cancelled',
			'Sharing stopped in this preview. No location was transmitted.'
		);
	}

	unlockQr(code: string) {
		if (code !== DEMO_CODE || !this.emailVerified || !this.accountActive) return false;
		this.tick();
		this.qrApprovedUntil = this.clock + 10 * 60_000;
		return true;
	}

	get qrPayload() {
		return JSON.stringify({
			kind: 'handlink-preview-profile',
			version: 1,
			id: this.profile.id,
			name: this.fullName,
			expiresAt: this.qrApprovedUntil
		});
	}

	parseSharedProfile(raw: string): TrustedProfile {
		if (raw.length > 2000) throw new Error('This QR code is too large.');
		let value: unknown;
		try {
			value = JSON.parse(raw);
		} catch {
			throw new Error('This is not a HandLink preview QR code.');
		}
		if (!value || typeof value !== 'object' || Array.isArray(value))
			throw new Error('Invalid profile QR code.');
		const record = value as Record<string, unknown>;
		if (
			record.kind !== 'handlink-preview-profile' ||
			record.version !== 1 ||
			typeof record.id !== 'string' ||
			!/^[a-zA-Z0-9-]{1,80}$/.test(record.id) ||
			typeof record.name !== 'string' ||
			!record.name.trim() ||
			record.name.length > 100 ||
			typeof record.expiresAt !== 'number' ||
			!Number.isFinite(record.expiresAt)
		)
			throw new Error('Invalid HandLink preview profile.');
		if (record.expiresAt <= Date.now() || record.expiresAt > Date.now() + 11 * 60_000)
			throw new Error('This QR code has expired or has an invalid expiry. Ask for a new code.');
		if (record.id === this.profile.id)
			throw new Error('This is your own QR code. Scan another person’s code.');
		if (this.trusted.some((person) => person.id === record.id))
			throw new Error('This person is already in your trusted profiles.');
		return { id: record.id, name: record.name.trim() };
	}

	removeTrusted(id: string) {
		this.trusted = this.trusted.filter((person) => person.id !== id);
	}
	logout() {
		this.loggedIn = false;
		this.sharing = null;
		this.alert.phase = 'idle';
		this.qrApprovedUntil = 0;
	}
	deactivate() {
		this.logout();
		this.accountActive = false;
		this.notify(
			'Account deactivated in preview',
			'The sample account record is retained in this preview. No real account was changed.'
		);
	}
}

export function getUserPreview() {
	return getContext<UserPreview>(USER_PREVIEW);
}

export function formatRemaining(seconds: number) {
	return `${Math.floor(seconds / 60)
		.toString()
		.padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
