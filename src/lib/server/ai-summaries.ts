import { createHash } from 'node:crypto';
import { error, type RequestEvent } from '@sveltejs/kit';
import { and, count, desc, eq, gt, lt } from 'drizzle-orm';
import type { z } from 'zod';
import type { AiSummaryState } from '../ai-summary.ts';
import { db } from './db/index.ts';
import {
	aiSummaryRequest,
	emergencyContact,
	incident,
	profile,
	report,
	user
} from './db/schema.ts';
import { requireStaff } from './api.ts';
import { latestIncidentNote } from './incident-notes.ts';
import { selectedAiProvider } from './ai-settings.ts';
import { requestSummary } from './summary-providers.ts';
import { SummaryProviderError } from './summary-provider.ts';
import { hasSummaryContent, isDeletionOnly, redactIncidentText } from './summary-privacy.ts';
import { containsSummaryInstructions } from './summary-extract.ts';
import type { aiGenerateInput, aiReviewInput } from './validation.ts';

function target(id: string | undefined) {
	if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
		error(400, 'Invalid incident ID.');
	const row = db.select().from(incident).where(eq(incident.id, id)).get();
	if (!row) error(404, 'Report not found.');
	return row;
}
function owned(event: RequestEvent, id: string | undefined) {
	const actor = requireStaff(event);
	if (actor.role !== 'dispatcher')
		error(403, 'Only the assigned dispatcher can generate or approve summaries.');
	const row = target(id);
	if (row.dispatcherUserId !== actor.id) error(404, 'Report not found.');
	return { actor, row };
}
function identifiers(row: typeof incident.$inferSelect) {
	const person = db.select().from(profile).where(eq(profile.id, row.personProfileId)).get()!;
	const caller = db.select().from(profile).where(eq(profile.userId, row.callerUserId)).get();
	const dispatcher = row.dispatcherUserId
		? db.select().from(user).where(eq(user.id, row.dispatcherUserId)).get()
		: null;
	const accounts = db
		.select({ email: user.email })
		.from(user)
		.where(eq(user.id, person.userId))
		.all();
	const contacts = db
		.select()
		.from(emergencyContact)
		.where(eq(emergencyContact.profileId, person.id))
		.all();
	const names = [
		`${person.firstName} ${person.lastName}`,
		person.firstName,
		person.lastName,
		row.callerName,
		caller?.firstName ?? '',
		caller?.lastName ?? '',
		dispatcher?.name ?? '',
		...contacts.flatMap((contact) => [
			`${contact.firstName} ${contact.lastName}`,
			contact.firstName,
			contact.lastName
		])
	];
	return [
		...names,
		...names.flatMap((name) => name.split(/\s+/)),
		person.phone,
		person.birthday,
		caller?.phone ?? '',
		row.locationLabel,
		String(row.latitude),
		String(row.longitude),
		...accounts.map((account) => account.email),
		...contacts.flatMap((contact) => [contact.phone, contact.email])
	];
}

export function getAiSummaryState(incidentId: string): AiSummaryState {
	const saved = db.select().from(report).where(eq(report.incidentId, incidentId)).get();
	const version = saved?.summaryRequestId
		? db
				.select()
				.from(aiSummaryRequest)
				.where(eq(aiSummaryRequest.id, saved.summaryRequestId))
				.get()
		: null;
	const note = latestIncidentNote(incidentId);
	const choice = selectedAiProvider();
	return {
		configured: choice.configured,
		provider: choice.provider,
		providerRevision: choice.revision,
		generationPending: Boolean(
			db
				.select({ id: aiSummaryRequest.id })
				.from(aiSummaryRequest)
				.where(
					and(
						eq(aiSummaryRequest.incidentId, incidentId),
						eq(aiSummaryRequest.status, 'pending'),
						gt(aiSummaryRequest.createdAt, new Date(Date.now() - 120000))
					)
				)
				.get()
		),
		summary: saved
			? {
					requestId: saved.summaryRequestId,
					summary: saved.summary,
					generatedAt: saved.generatedAt.toISOString(),
					reviewedAt: saved.reviewedAt?.toISOString() ?? null,
					reviewedByUserId: saved.reviewedByUserId,
					model: version?.model ?? null,
					isStale: Boolean(version && version.sourceNoteId !== note?.id)
				}
			: null
	};
}

export function previewAiSummary(event: RequestEvent, id: string | undefined) {
	return db.transaction(() => {
		const { row } = owned(event, id);
		const note = latestIncidentNote(row.id);
		if (!note || !note.notes.trim()) error(409, 'Save incident notes before generating a summary.');
		const choice = selectedAiProvider();
		return {
			provider: choice.provider,
			providerRevision: choice.revision,
			sourceNoteId: note.id,
			text: redactIncidentText(note.notes, identifiers(row)),
			warnings: [
				choice.provider === 'gemini'
					? 'Review this text before sending it to Google Gemini, an external cloud service. Automatic redaction cannot find every identifier.'
					: 'Review the exact text before sending it to the configured Ollama server. Automatic redaction cannot find every identifier.',
				'Delete names, addresses, contact details, private history, and unnecessary information. Only delete text; do not add or rewrite it.',
				'AI drafts may be wrong. Verify against incident notes before approving.'
			]
		};
	});
}

function failRequest(id: string) {
	db.update(aiSummaryRequest)
		.set({ status: 'failed', finishedAt: new Date() })
		.where(and(eq(aiSummaryRequest.id, id), eq(aiSummaryRequest.status, 'pending')))
		.run();
}

export async function generateAiSummary(
	event: RequestEvent,
	id: string | undefined,
	input: z.output<typeof aiGenerateInput>
) {
	const reservation = db.transaction(
		(tx) => {
			const { actor, row } = owned(event, id);
			const choice = selectedAiProvider();
			const hash = createHash('sha256').update(input.approvedText).digest('hex');
			const existing = tx
				.select()
				.from(aiSummaryRequest)
				.where(eq(aiSummaryRequest.id, input.requestId))
				.get();
			if (existing) {
				if (
					existing.incidentId !== row.id ||
					existing.requestedByUserId !== actor.id ||
					existing.inputHash !== hash ||
					existing.sourceNoteId !== input.sourceNoteId ||
					(input.provider !== undefined && !existing.model.startsWith(`${input.provider}:`))
				)
					error(409, 'This summary request ID was already used with different information.');
				if (existing.status === 'completed')
					return {
						replayed: true as const,
						incidentId: row.id,
						identifiers: [] as string[],
						choice
					};
				error(
					409,
					existing.status === 'pending'
						? 'A summary is already generating. Refresh the report.'
						: 'This attempt failed. Start a new request after the cooldown.'
				);
			}
			if (
				input.provider === undefined && input.providerRevision === undefined
					? choice.provider !== 'ollama'
					: input.provider !== choice.provider || input.providerRevision !== choice.revision
			)
				error(
					409,
					'AI provider changed. Refresh the preview and confirm where the notes will be sent.'
				);
			if (!choice.configured)
				error(
					503,
					'The selected AI provider is not configured. Ask Admin to review AI settings. Reports remain available.'
				);
			const note = latestIncidentNote(row.id);
			if (!note || note.id !== input.sourceNoteId)
				error(409, 'Incident notes changed. Refresh the preview before generating.');
			const privateValues = identifiers(row);
			const safe = redactIncidentText(note.notes, privateValues);
			if (
				!isDeletionOnly(safe, input.approvedText) ||
				redactIncidentText(input.approvedText, privateValues) !== input.approvedText
			)
				error(
					422,
					'Only delete text from the redacted preview. Refresh it before making other changes.'
				);
			if (!hasSummaryContent(input.approvedText))
				error(422, 'Not enough non-identifying incident information to summarize.');
			if (containsSummaryInstructions(input.approvedText))
				error(
					422,
					'Remove instructions or copied prompts from the approved notes before generating.'
				);
			const now = new Date();
			tx.update(aiSummaryRequest)
				.set({ status: 'failed', finishedAt: now })
				.where(
					and(
						eq(aiSummaryRequest.incidentId, row.id),
						eq(aiSummaryRequest.status, 'pending'),
						lt(aiSummaryRequest.createdAt, new Date(now.getTime() - 120000))
					)
				)
				.run();
			if (
				tx
					.select({ id: aiSummaryRequest.id })
					.from(aiSummaryRequest)
					.where(
						and(eq(aiSummaryRequest.incidentId, row.id), eq(aiSummaryRequest.status, 'pending'))
					)
					.get()
			)
				error(409, 'A summary is already generating for this incident.');
			const recent = tx
				.select()
				.from(aiSummaryRequest)
				.where(eq(aiSummaryRequest.incidentId, row.id))
				.orderBy(desc(aiSummaryRequest.createdAt))
				.get();
			if (recent && now.getTime() - recent.createdAt.getTime() < 60000)
				error(429, 'Wait 60 seconds before another summary attempt.');
			const hourly = tx
				.select({ n: count() })
				.from(aiSummaryRequest)
				.where(
					and(
						eq(aiSummaryRequest.requestedByUserId, actor.id),
						gt(aiSummaryRequest.createdAt, new Date(now.getTime() - 3600000))
					)
				)
				.get()!.n;
			if (hourly >= 10) error(429, 'You can request up to ten summaries per hour.');
			tx.insert(aiSummaryRequest)
				.values({
					id: input.requestId,
					incidentId: row.id,
					requestedByUserId: actor.id,
					sourceNoteId: note.id,
					inputHash: hash,
					model: choice.model,
					createdAt: now
				})
				.run();
			return { replayed: false as const, incidentId: row.id, identifiers: privateValues, choice };
		},
		{ behavior: 'immediate' }
	);
	if (reservation.replayed) return getAiSummaryState(reservation.incidentId);
	let generated: string;
	try {
		generated = await requestSummary(reservation.choice.provider, input.approvedText);
	} catch (failure) {
		failRequest(input.requestId);
		if (failure instanceof SummaryProviderError)
			error(failure.status, `${failure.message} Existing reports and summaries were kept.`);
		error(
			502,
			'AI could not generate a summary. Existing reports and summaries were kept. Try again after the cooldown.'
		);
	}
	try {
		return db.transaction(
			(tx) => {
				const { row } = owned(event, id);
				const current = tx
					.select()
					.from(aiSummaryRequest)
					.where(eq(aiSummaryRequest.id, input.requestId))
					.get();
				if (
					!current ||
					current.status !== 'pending' ||
					selectedAiProvider().revision !== reservation.choice.revision ||
					latestIncidentNote(row.id)?.id !== input.sourceNoteId
				)
					error(
						409,
						'Notes, AI provider, or request state changed while generating. Refresh and review a new preview.'
					);
				// Apply current identifiers again in case profile/contact data changed during the network call.
				const summary = redactIncidentText(generated, [
					...reservation.identifiers,
					...identifiers(row)
				]);
				if (!hasSummaryContent(summary) || summary.length > 1500)
					error(502, 'AI did not return a usable draft. Existing reports were kept.');
				const now = new Date();
				tx.update(aiSummaryRequest)
					.set({ status: 'completed', summary, finishedAt: now })
					.where(eq(aiSummaryRequest.id, input.requestId))
					.run();
				const values = {
					summary,
					summaryRequestId: input.requestId,
					generatedAt: now,
					reviewedAt: null,
					reviewedByUserId: null
				};
				tx.insert(report)
					.values({ ...values, incidentId: row.id })
					.onConflictDoUpdate({ target: report.incidentId, set: values })
					.run();
				return getAiSummaryState(row.id);
			},
			{ behavior: 'immediate' }
		);
	} catch (failure) {
		failRequest(input.requestId);
		throw failure;
	}
}

export function approveAiSummary(
	event: RequestEvent,
	id: string | undefined,
	input: z.output<typeof aiReviewInput>
) {
	return db.transaction(
		(tx) => {
			const { actor, row } = owned(event, id);
			const saved = tx.select().from(report).where(eq(report.incidentId, row.id)).get();
			const version = tx
				.select()
				.from(aiSummaryRequest)
				.where(eq(aiSummaryRequest.id, input.requestId))
				.get();
			if (
				!saved ||
				saved.summaryRequestId !== input.requestId ||
				!version ||
				version.incidentId !== row.id ||
				version.status !== 'completed' ||
				latestIncidentNote(row.id)?.id !== version.sourceNoteId
			)
				error(409, 'This draft changed or its notes are outdated. Refresh before approving.');
			if (saved.reviewedAt) return getAiSummaryState(row.id);
			const now = new Date();
			tx.update(aiSummaryRequest)
				.set({ reviewedAt: now, reviewedByUserId: actor.id })
				.where(eq(aiSummaryRequest.id, version.id))
				.run();
			tx.update(report)
				.set({ reviewedAt: now, reviewedByUserId: actor.id })
				.where(eq(report.id, saved.id))
				.run();
			return getAiSummaryState(row.id);
		},
		{ behavior: 'immediate' }
	);
}
