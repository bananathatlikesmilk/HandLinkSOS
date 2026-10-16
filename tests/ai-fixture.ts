import { expect, type APIRequestContext } from '@playwright/test';
import { database, headers } from './incident-fixture';

export function provider(mode = 'success', delay = 0) {
	const db = database();
	try {
		db.exec(
			"CREATE TABLE IF NOT EXISTS test_ai_provider (id INTEGER PRIMARY KEY,mode TEXT NOT NULL DEFAULT 'success',delay_ms INTEGER NOT NULL DEFAULT 0,calls INTEGER NOT NULL DEFAULT 0,last_payload TEXT)"
		);
		db.prepare('INSERT OR IGNORE INTO test_ai_provider (id) VALUES (1)').run();
		db.prepare(
			'UPDATE test_ai_provider SET mode=?,delay_ms=?,calls=0,last_payload=NULL WHERE id=1'
		).run(mode, delay);
	} finally {
		db.close();
	}
}
export function providerState() {
	const db = database();
	try {
		return db.prepare('SELECT calls,last_payload FROM test_ai_provider WHERE id=1').get() as {
			calls: number;
			last_payload: string | null;
		};
	} finally {
		db.close();
	}
}
export async function addNotes(
	request: APIRequestContext,
	id: string,
	notes = 'Caller reports chest pain. Dispatch assistance requested.'
) {
	const r = await request.post(`/api/staff/incidents/${id}/notes`, { headers, data: { notes } });
	expect(r.status(), await r.text()).toBe(200);
}
export async function preview(request: APIRequestContext, id: string) {
	const response = await request.get(`/api/staff/reports/${id}/summary/preview`);
	expect(response.status(), await response.text()).toBe(200);
	return (await response.json()) as { sourceNoteId: string; text: string };
}
export function generation(input: { sourceNoteId: string; text: string }) {
	return {
		requestId: crypto.randomUUID(),
		sourceNoteId: input.sourceNoteId,
		approvedText: input.text,
		confirmed: true
	};
}
export function ageRequest(id: string, ageMs = 61000) {
	const db = database();
	try {
		db.prepare('UPDATE ai_summary_request SET created_at=? WHERE id=?').run(Date.now() - ageMs, id);
	} finally {
		db.close();
	}
}
