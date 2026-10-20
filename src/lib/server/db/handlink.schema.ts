import { sql } from 'drizzle-orm';
import {
	check,
	index,
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';
import { user, session } from './schema.ts';

const id = () =>
	text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());
const created = () =>
	integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`);
const accountReference = (name: string) =>
	text(name)
		.notNull()
		.references(() => user.id, { onDelete: 'restrict' });

export const aiProviderSetting = sqliteTable(
	'ai_provider_setting',
	{
		id: text('id').primaryKey(),
		provider: text('provider', { enum: ['ollama', 'gemini'] }).notNull(),
		revision: text('revision').notNull(),
		updatedByUserId: accountReference('updated_by_user_id'),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [
		check('ai_provider_singleton', sql`${table.id} = 'summary'`),
		check('ai_provider_allowed', sql`${table.provider} in ('ollama', 'gemini')`)
	]
);

export const accountAudit = sqliteTable(
	'account_audit',
	{
		id: id(),
		actorUserId: accountReference('actor_user_id'),
		targetUserId: accountReference('target_user_id'),
		action: text('action', {
			enum: ['dispatcher_created', 'admin_created', 'deactivated', 'reactivated']
		}).notNull(),
		createdAt: created()
	},
	(t) => [
		index('account_audit_actor_time_idx').on(t.actorUserId, t.createdAt),
		index('account_audit_target_time_idx').on(t.targetUserId, t.createdAt),
		check(
			'account_audit_action',
			sql`${t.action} in ('dispatcher_created','admin_created','deactivated','reactivated')`
		)
	]
);

// Better Auth's user table owns identities, passwords, sessions, and roles.
export const profile = sqliteTable(
	'user_profile',
	{
		id: id(),
		userId: accountReference('user_id').unique(),
		firstName: text('first_name').notNull(),
		lastName: text('last_name').notNull(),
		birthday: text('birthday').notNull(),
		sex: text('sex', { enum: ['Female', 'Male', 'Other', 'Prefer not to say'] }).notNull(),
		phone: text('phone').notNull(),
		deactivatedAt: integer('deactivated_at', { mode: 'timestamp_ms' }),
		createdAt: created(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [
		check('profile_sex', sql`${t.sex} in ('Female','Male','Other','Prefer not to say')`),
		check(
			'profile_names',
			sql`length(trim(${t.firstName})) between 1 and 100 and length(trim(${t.lastName})) between 1 and 100`
		)
	]
);

export const medicalProfile = sqliteTable(
	'medical_profile',
	{
		profileId: text('profile_id')
			.primaryKey()
			.references(() => profile.id, { onDelete: 'restrict' }),
		bloodType: text('blood_type'),
		chronicCondition: text('chronic_condition').notNull().default(''),
		allergies: text('allergies').notNull().default(''),
		currentMedications: text('current_medications').notNull().default(''),
		additionalInformation: text('additional_information').notNull().default('')
	},
	(t) => [
		check(
			'medical_blood_type',
			sql`${t.bloodType} is null or ${t.bloodType} in ('A+','A-','B+','B-','AB+','AB-','O+','O-','Unknown')`
		)
	]
);

export const emergencyContact = sqliteTable(
	'emergency_contact',
	{
		id: id(),
		profileId: text('profile_id')
			.notNull()
			.references(() => profile.id, { onDelete: 'cascade' }),
		linkedUserId: text('linked_user_id').references(() => user.id, { onDelete: 'set null' }),
		firstName: text('first_name').notNull(),
		lastName: text('last_name').notNull(),
		phone: text('phone').notNull(),
		email: text('email').notNull(),
		relationship: text('relationship').notNull()
	},
	(t) => [index('contact_profile_idx').on(t.profileId)]
);

export const qrInvitation = sqliteTable(
	'qr_invitation',
	{
		id: id(),
		ownerProfileId: text('owner_profile_id')
			.notNull()
			.references(() => profile.id, { onDelete: 'restrict' }),
		tokenHash: text('token_hash').notNull().unique(),
		createdAt: created(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		consumedAt: integer('consumed_at', { mode: 'timestamp_ms' })
	},
	(t) => [
		check('qr_expiry', sql`${t.expiresAt} > ${t.createdAt}`),
		check('qr_hash', sql`length(${t.tokenHash}) = 64`)
	]
);

// Direction matters: owner grants requester permission to request SOS on owner's behalf.
export const trustedConnection = sqliteTable(
	'trusted_connection',
	{
		id: id(),
		ownerProfileId: text('owner_profile_id')
			.notNull()
			.references(() => profile.id, { onDelete: 'restrict' }),
		requesterProfileId: text('requester_profile_id')
			.notNull()
			.references(() => profile.id, { onDelete: 'restrict' }),
		invitationId: text('invitation_id').references(() => qrInvitation.id, { onDelete: 'restrict' }),
		relationship: text('relationship').notNull(),
		status: text('status', { enum: ['pending', 'approved', 'revoked'] })
			.notNull()
			.default('pending'),
		createdAt: created(),
		approvedAt: integer('approved_at', { mode: 'timestamp_ms' }),
		revokedAt: integer('revoked_at', { mode: 'timestamp_ms' })
	},
	(t) => [
		uniqueIndex('trusted_pair_unique').on(t.ownerProfileId, t.requesterProfileId),
		check('trusted_not_self', sql`${t.ownerProfileId} <> ${t.requesterProfileId}`),
		check('trusted_status', sql`${t.status} in ('pending','approved','revoked')`),
		check('trusted_approval', sql`${t.status} <> 'approved' or ${t.approvedAt} is not null`)
	]
);

export const verificationRequest = sqliteTable(
	'verification_request',
	{
		id: id(),
		userId: accountReference('user_id'),
		connectionId: text('connection_id').references(() => trustedConnection.id, {
			onDelete: 'restrict'
		}),
		purpose: text('purpose', {
			enum: ['email', 'recovery', 'trusted_approval', 'qr_access']
		}).notNull(),
		codeHash: text('code_hash').notNull(),
		attempts: integer('attempts').notNull().default(0),
		createdAt: created(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		consumedAt: integer('consumed_at', { mode: 'timestamp_ms' })
	},
	(t) => [
		index('verification_user_purpose_idx').on(t.userId, t.purpose),
		check('verification_expiry', sql`${t.expiresAt} > ${t.createdAt}`),
		check('verification_hash', sql`length(${t.codeHash}) = 64`),
		check('verification_attempts', sql`${t.attempts} between 0 and 5`),
		check(
			'verification_purpose',
			sql`${t.purpose} in ('email','recovery','trusted_approval','qr_access')`
		),
		check(
			'verification_binding',
			sql`${t.purpose} <> 'trusted_approval' or ${t.connectionId} is not null`
		)
	]
);

export const incident = sqliteTable(
	'incident',
	{
		id: id(),
		personProfileId: text('person_profile_id')
			.notNull()
			.references(() => profile.id, { onDelete: 'restrict' }),
		callerUserId: accountReference('caller_user_id'),
		callerName: text('caller_name').notNull(),
		callerRelationship: text('caller_relationship').notNull().default(''),
		dispatcherUserId: text('dispatcher_user_id').references(() => user.id, {
			onDelete: 'restrict'
		}),
		status: text('status', { enum: ['Not assigned', 'In progress', 'On route', 'Resolved'] })
			.notNull()
			.default('Not assigned'),
		latitude: real('latitude').notNull(),
		longitude: real('longitude').notNull(),
		locationLabel: text('location_label').notNull().default(''),
		idempotencyKey: text('idempotency_key').notNull(),
		startedAt: created(),
		confirmedAt: integer('confirmed_at', { mode: 'timestamp_ms' }),
		endedAt: integer('ended_at', { mode: 'timestamp_ms' })
	},
	(t) => [
		index('incident_status_idx').on(t.status, t.startedAt),
		index('incident_person_idx').on(t.personProfileId),
		uniqueIndex('incident_retry_unique').on(t.callerUserId, t.idempotencyKey),
		check(
			'incident_coordinates',
			sql`${t.latitude} between -90 and 90 and ${t.longitude} between -180 and 180`
		),
		check(
			'incident_status',
			sql`${t.status} in ('Not assigned','In progress','On route','Resolved')`
		),
		check(
			'incident_assignment',
			sql`(${t.status} = 'Not assigned' and ${t.dispatcherUserId} is null and ${t.confirmedAt} is null) or (${t.status} <> 'Not assigned' and ${t.dispatcherUserId} is not null and ${t.confirmedAt} is not null)`
		),
		check(
			'incident_resolution',
			sql`(${t.status} = 'Resolved' and ${t.endedAt} is not null and ${t.endedAt} >= ${t.startedAt}) or (${t.status} <> 'Resolved' and ${t.endedAt} is null)`
		)
	]
);

export const incidentReference = sqliteTable(
	'incident_reference',
	{
		number: integer('number').primaryKey({ autoIncrement: true }),
		incidentId: text('incident_id')
			.notNull()
			.unique()
			.references(() => incident.id, { onDelete: 'restrict' })
	},
	(t) => [check('incident_reference_positive', sql`${t.number} > 0`)]
);

export const incidentEvent = sqliteTable(
	'incident_event',
	{
		id: id(),
		incidentId: text('incident_id')
			.notNull()
			.references(() => incident.id, { onDelete: 'restrict' }),
		actorUserId: accountReference('actor_user_id'),
		type: text('type', {
			enum: [
				'created',
				'confirmed',
				'on_route',
				'resolved',
				'note',
				'cancellation_requested',
				'cancellation_approved',
				'cancellation_rejected'
			]
		}).notNull(),
		notes: text('notes').notNull().default(''),
		createdAt: created()
	},
	(t) => [
		index('event_incident_idx').on(t.incidentId, t.createdAt),
		check(
			'event_type',
			sql`${t.type} in ('created','confirmed','on_route','resolved','note','cancellation_requested','cancellation_approved','cancellation_rejected')`
		),
		check('event_notes_length', sql`length(${t.notes}) <= 2000`)
	]
);

export const incidentAddendum = sqliteTable(
	'incident_addendum',
	{
		id: id(),
		incidentId: text('incident_id')
			.notNull()
			.references(() => incident.id, { onDelete: 'restrict' }),
		actorUserId: accountReference('actor_user_id'),
		notes: text('notes').notNull(),
		createdAt: created()
	},
	(t) => [
		index('addendum_incident_idx').on(t.incidentId, t.createdAt),
		check('addendum_notes_length', sql`length(trim(${t.notes})) between 1 and 2000`)
	]
);

export const incidentCancellation = sqliteTable(
	'incident_cancellation',
	{
		id: id(),
		incidentId: text('incident_id')
			.notNull()
			.unique()
			.references(() => incident.id, { onDelete: 'restrict' }),
		requesterUserId: accountReference('requester_user_id'),
		reason: text('reason').notNull(),
		decision: text('decision', { enum: ['pending', 'approved', 'rejected'] })
			.notNull()
			.default('pending'),
		requestedAt: created(),
		reviewedAt: integer('reviewed_at', { mode: 'timestamp_ms' }),
		reviewedByUserId: text('reviewed_by_user_id').references(() => user.id, {
			onDelete: 'restrict'
		})
	},
	(t) => [
		check('cancellation_reason', sql`length(trim(${t.reason})) between 1 and 500`),
		check('cancellation_decision', sql`${t.decision} in ('pending','approved','rejected')`),
		check(
			'cancellation_review',
			sql`(${t.decision} = 'pending' and ${t.reviewedAt} is null and ${t.reviewedByUserId} is null) or (${t.decision} <> 'pending' and ${t.reviewedAt} is not null and ${t.reviewedByUserId} is not null and ${t.reviewedAt} >= ${t.requestedAt})`
		)
	]
);

export const aiSummaryRequest = sqliteTable(
	'ai_summary_request',
	{
		id: id(),
		incidentId: text('incident_id')
			.notNull()
			.references(() => incident.id, { onDelete: 'restrict' }),
		requestedByUserId: accountReference('requested_by_user_id'),
		sourceNoteId: text('source_note_id')
			.notNull()
			.references(() => incidentEvent.id, { onDelete: 'restrict' }),
		inputHash: text('input_hash').notNull(),
		model: text('model').notNull(),
		status: text('status', { enum: ['pending', 'completed', 'failed'] })
			.notNull()
			.default('pending'),
		summary: text('summary'),
		createdAt: created(),
		finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
		reviewedAt: integer('reviewed_at', { mode: 'timestamp_ms' }),
		reviewedByUserId: text('reviewed_by_user_id').references(() => user.id, {
			onDelete: 'restrict'
		})
	},
	(t) => [
		index('ai_request_actor_time_idx').on(t.requestedByUserId, t.createdAt),
		index('ai_request_incident_time_idx').on(t.incidentId, t.createdAt),
		uniqueIndex('ai_request_one_pending_idx')
			.on(t.incidentId)
			.where(sql`${t.status} = 'pending'`),
		check('ai_request_hash', sql`length(${t.inputHash}) = 64`),
		check('ai_request_model', sql`length(${t.model}) between 1 and 100`),
		check('ai_request_status', sql`${t.status} in ('pending','completed','failed')`),
		check(
			'ai_request_result',
			sql`(${t.status}='pending' and ${t.summary} is null and ${t.finishedAt} is null) or (${t.status}='failed' and ${t.summary} is null and ${t.finishedAt} is not null and ${t.finishedAt} >= ${t.createdAt}) or (${t.status}='completed' and ${t.summary} is not null and length(trim(${t.summary})) between 1 and 1500 and ${t.finishedAt} is not null and ${t.finishedAt} >= ${t.createdAt})`
		),
		check(
			'ai_request_review',
			sql`(${t.reviewedAt} is null and ${t.reviewedByUserId} is null) or (${t.status}='completed' and ${t.reviewedAt} is not null and ${t.reviewedByUserId} is not null and ${t.reviewedAt} >= ${t.finishedAt})`
		)
	]
);

export const report = sqliteTable(
	'report',
	{
		id: id(),
		summaryRequestId: text('summary_request_id').references(() => aiSummaryRequest.id, {
			onDelete: 'restrict'
		}),
		incidentId: text('incident_id')
			.notNull()
			.unique()
			.references(() => incident.id, { onDelete: 'restrict' }),
		summary: text('summary').notNull(),
		generatedAt: created(),
		reviewedByUserId: text('reviewed_by_user_id').references(() => user.id, {
			onDelete: 'restrict'
		}),
		reviewedAt: integer('reviewed_at', { mode: 'timestamp_ms' })
	},
	(t) => [
		check('report_summary_length', sql`length(${t.summary}) between 1 and 4000`),
		check(
			'report_review_pair',
			sql`(${t.reviewedAt} is null and ${t.reviewedByUserId} is null) or (${t.reviewedAt} is not null and ${t.reviewedByUserId} is not null)`
		)
	]
);

export const callSession = sqliteTable(
	'call_session',
	{
		id: id(),
		incidentId: text('incident_id')
			.notNull()
			.references(() => incident.id, { onDelete: 'restrict' }),
		providerCallId: text('provider_call_id').unique(),
		status: text('status', { enum: ['pending', 'connected', 'ended', 'failed'] })
			.notNull()
			.default('pending'),
		startedAt: created(),
		endedAt: integer('ended_at', { mode: 'timestamp_ms' })
	},
	(t) => [
		check('call_status', sql`${t.status} in ('pending','connected','ended','failed')`),
		check('call_times', sql`${t.endedAt} is null or ${t.endedAt} >= ${t.startedAt}`)
	]
);

export const locationSession = sqliteTable(
	'location_session',
	{
		id: id(),
		ownerProfileId: text('owner_profile_id')
			.notNull()
			.references(() => profile.id, { onDelete: 'restrict' }),
		startedAt: created(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		cancelledAt: integer('cancelled_at', { mode: 'timestamp_ms' }),
		expiryNotifiedAt: integer('expiry_notified_at', { mode: 'timestamp_ms' })
	},
	(t) => [
		index('location_expiry_idx').on(t.expiresAt),
		check('location_duration', sql`${t.expiresAt} - ${t.startedAt} between 60000 and 14400000`),
		check(
			'location_cancel_time',
			sql`${t.cancelledAt} is null or ${t.cancelledAt} >= ${t.startedAt}`
		)
	]
);

export const locationRecipient = sqliteTable(
	'location_recipient',
	{
		id: id(),
		sessionId: text('session_id')
			.notNull()
			.references(() => locationSession.id, { onDelete: 'cascade' }),
		userId: accountReference('user_id'),
		revokedAt: integer('revoked_at', { mode: 'timestamp_ms' })
	},
	(t) => [
		uniqueIndex('location_recipient_unique').on(t.sessionId, t.userId),
		index('location_recipient_user_idx').on(t.userId)
	]
);

export const locationPoint = sqliteTable(
	'location_point',
	{
		id: id(),
		sessionId: text('session_id')
			.notNull()
			.references(() => locationSession.id, { onDelete: 'cascade' }),
		latitude: real('latitude').notNull(),
		longitude: real('longitude').notNull(),
		accuracy: real('accuracy').notNull(),
		recordedAt: integer('recorded_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [
		index('point_session_time_idx').on(t.sessionId, t.recordedAt),
		check(
			'point_coordinates',
			sql`${t.latitude} between -90 and 90 and ${t.longitude} between -180 and 180`
		),
		check('point_accuracy', sql`${t.accuracy} >= 0`)
	]
);

export const device = sqliteTable(
	'device',
	{
		id: id(),
		userId: accountReference('user_id'),
		platform: text('platform', { enum: ['android', 'ios'] }).notNull(),
		pushToken: text('push_token').notNull().unique(),
		sessionId: text('session_id').references(() => session.id, { onDelete: 'cascade' }),
		createdAt: created(),
		revokedAt: integer('revoked_at', { mode: 'timestamp_ms' })
	},
	(t) => [
		index('device_user_idx').on(t.userId),
		check('device_platform', sql`${t.platform} in ('android','ios')`)
	]
);

export const notification = sqliteTable(
	'notification',
	{
		id: id(),
		userId: accountReference('user_id'),
		incidentId: text('incident_id').references(() => incident.id, { onDelete: 'restrict' }),
		locationSessionId: text('location_session_id').references(() => locationSession.id, {
			onDelete: 'restrict'
		}),
		type: text('type', {
			enum: ['sos', 'location_shared', 'location_expiring', 'location_expired', 'trusted_request']
		}).notNull(),
		deliveryKey: text('delivery_key').notNull().unique(),
		createdAt: created(),
		deliveredAt: integer('delivered_at', { mode: 'timestamp_ms' }),
		readAt: integer('read_at', { mode: 'timestamp_ms' })
	},
	(t) => [
		index('notification_user_time_idx').on(t.userId, t.createdAt),
		check(
			'notification_type',
			sql`${t.type} in ('sos','location_shared','location_expiring','location_expired','trusted_request')`
		)
	]
);

export const pushDelivery = sqliteTable(
	'push_delivery',
	{
		id: id(),
		notificationId: text('notification_id')
			.notNull()
			.references(() => notification.id, { onDelete: 'cascade' }),
		deviceId: text('device_id')
			.notNull()
			.references(() => device.id, { onDelete: 'cascade' }),
		state: text('state', { enum: ['pending', 'sent', 'skipped', 'failed'] })
			.notNull()
			.default('pending'),
		attempts: integer('attempts').notNull().default(0),
		nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp_ms' }).notNull(),
		leaseUntil: integer('lease_until', { mode: 'timestamp_ms' }),
		acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
		createdAt: created()
	},
	(t) => [
		uniqueIndex('push_delivery_once').on(t.notificationId, t.deviceId),
		index('push_delivery_pending').on(t.state, t.nextAttemptAt),
		check('push_delivery_state', sql`${t.state} in ('pending','sent','skipped','failed')`),
		check('push_delivery_attempts', sql`${t.attempts} >= 0`)
	]
);
