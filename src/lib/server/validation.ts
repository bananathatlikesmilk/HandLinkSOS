import { z } from 'zod';

const name = z.string().trim().min(1).max(100);
export const emptyInput = z.strictObject({});
export const mfaPasswordInput = z.strictObject({ password: z.string().min(12).max(128) });
export const mfaSetupInput = mfaPasswordInput.extend({
	method: z.literal('totp').optional(),
	issuer: z.literal('HandLink').optional()
});
export const mfaTotpInput = z.strictObject({
	code: z.string().regex(/^\d{6}$/),
	trustDevice: z.literal(false).optional()
});
export const mfaBackupInput = z.strictObject({
	code: z.string().regex(/^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/),
	trustDevice: z.literal(false).optional(),
	disableSession: z.literal(false).optional()
});
export const staffAccountInput = z.strictObject({
	name,
	email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
	password: z.string().min(12).max(128),
	role: z.enum(['dispatcher', 'admin']).default('dispatcher')
});
export const accountStatusInput = z.strictObject({ active: z.boolean() });
export const accountListInput = z.strictObject({
	search: z.string().trim().max(100).default(''),
	role: z.enum(['all', 'user', 'dispatcher', 'admin']).default('all'),
	page: z.coerce.number().int().min(1).max(100000).default(1)
});
const phone = z
	.string()
	.trim()
	.max(30)
	.transform((value) => value.replace(/[\s()-]/g, ''))
	.pipe(
		z
			.string()
			.regex(/^\+[1-9]\d{7,14}$/, 'Use an international phone number, such as +639171234567.')
	);
const birthday = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.refine((value) => {
		const date = new Date(`${value}T00:00:00Z`);
		if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
		const today = new Intl.DateTimeFormat('en-CA', {
			timeZone: 'Asia/Manila',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).format(new Date());
		return value <= today;
	}, 'Birthday must be a real date that is not in the future.');
const medicalText = z.string().trim().max(1000);

export const profileInput = z.strictObject({
	firstName: name,
	lastName: name,
	birthday,
	sex: z.enum(['Female', 'Male', 'Other', 'Prefer not to say']),
	phone,
	medical: z.strictObject({
		bloodType: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown']).nullable(),
		chronicCondition: medicalText,
		allergies: medicalText,
		currentMedications: medicalText,
		additionalInformation: z.string().trim().max(2000)
	}),
	emergencyContacts: z
		.array(
			z.strictObject({
				firstName: name,
				lastName: name,
				phone,
				email: z.email().max(254),
				relationship: name
			})
		)
		.min(1)
		.max(10)
});

export const coordinatesInput = z.strictObject({
	latitude: z.number().min(-90).max(90),
	longitude: z.number().min(-180).max(180)
});
export const incidentInput = z.strictObject({
	personProfileId: z.uuid(),
	latitude: z.number().min(-90).max(90),
	longitude: z.number().min(-180).max(180),
	locationLabel: z.string().trim().max(250),
	idempotencyKey: z.uuid()
});
export const confirmationInput = z.strictObject({ verballyConfirmed: z.literal(true) });
export const statusInput = z.strictObject({ status: z.enum(['On route', 'Resolved']) });
export const cancellationInput = z.strictObject({ reason: z.string().trim().min(1).max(500) });
export const cancellationReviewInput = z.strictObject({ decision: z.enum(['approve', 'reject']) });
export const notificationListInput = z.strictObject({
	page: z.coerce.number().int().min(1).max(100000).default(1)
});
export const noteInput = z.strictObject({
	notes: z.string().trim().min(1).max(2000),
	expectedNoteId: z.uuid().nullable().optional()
});
export const addendumInput = z.strictObject({
	id: z.uuid(),
	notes: z.string().trim().min(1).max(2000)
});
export const incidentListInput = z.strictObject({
	view: z.enum(['alerts', 'reports']).default('alerts'),
	search: z.string().trim().max(100).default(''),
	status: z
		.enum(['Active', 'All', 'Not assigned', 'In progress', 'On route', 'Resolved'])
		.default('Active'),
	page: z.coerce.number().int().min(1).max(100000).default(1)
});
export const otpInput = z.strictObject({ requestId: z.uuid(), code: z.string().regex(/^\d{6}$/) });
export const qrScanInput = z.strictObject({
	token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
	relationship: name
});
export const trustedActionInput = z.discriminatedUnion('action', [
	z
		.strictObject({
			action: z.literal('approve'),
			invitationId: z.uuid(),
			requestMutual: z.boolean().default(false),
			mutualRelationship: name.optional()
		})
		.refine((value) => !value.requestMutual || Boolean(value.mutualRelationship), {
			message: 'Enter your relationship for the reverse request.',
			path: ['mutualRelationship']
		}),
	z.strictObject({ action: z.literal('revoke') })
]);
export const locationSessionInput = z.strictObject({
	durationMinutes: z.number().int().min(1).max(240),
	recipientUserIds: z.array(z.string().min(1).max(128)).min(1).max(20)
});
export const locationPointInput = z.strictObject({
	latitude: z.number().min(-90).max(90),
	longitude: z.number().min(-180).max(180),
	accuracy: z.number().nonnegative().max(100000),
	recordedAt: z.iso.datetime().refine((value) => {
		const age = Date.now() - Date.parse(value);
		return age >= -30000 && age <= 300000;
	}, 'Location must be recent.')
});
export const locationStartInput = locationSessionInput
	.extend({
		id: z.uuid(),
		point: locationPointInput
	})
	.refine((input) => new Set(input.recipientUserIds).size === input.recipientUserIds.length, {
		message: 'Choose each recipient only once.',
		path: ['recipientUserIds']
	});
export const deviceInput = z.strictObject({
	platform: z.literal('android'),
	pushToken: z
		.string()
		.min(20)
		.max(4096)
		.regex(/^[A-Za-z0-9_:.-]+$/)
});
export const summaryInput = z.strictObject({ summary: z.string().trim().min(1).max(4000) });
export const aiGenerateInput = z.strictObject({
	requestId: z.uuid(),
	sourceNoteId: z.uuid(),
	approvedText: z.string().trim().min(1).max(2000),
	confirmed: z.literal(true)
});
export const aiReviewInput = z.strictObject({ requestId: z.uuid(), confirmed: z.literal(true) });
