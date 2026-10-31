import PDFDocument from 'pdfkit';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { filteredIncidentReports } from './incidents.ts';

const require = createRequire(import.meta.url);
const font = readFileSync(
	require.resolve('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff')
);
const formatTime = (value: string | null) =>
	value
		? new Date(value).toLocaleString('en-PH', {
				timeZone: 'Asia/Manila',
				dateStyle: 'medium',
				timeStyle: 'short'
			})
		: 'Not recorded';

export function reportPdf(data: ReturnType<typeof filteredIncidentReports>): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const doc = new PDFDocument({
			size: 'A4',
			margin: 48,
			info: { Title: 'HandLink filtered incident reports', Author: 'HandLink-SOS' }
		});
		const chunks: Buffer[] = [];
		doc.on('data', (chunk) => chunks.push(chunk));
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);
		doc.font(font);
		const text = (value: string) => {
			doc.fontSize(10).fillColor('#222222').text(value, { paragraphGap: 6 });
		};
		const heading = (value: string) => {
			doc.moveDown(0.5).fontSize(14).fillColor('#111111').text(value);
			doc.moveDown(0.3);
		};
		heading('HandLink | Incident reports');
		text(`Generated: ${formatTime(new Date().toISOString())} (Philippine time)`);
		text(`Access scope: ${data.scope} | Matching reports: ${data.reports.length}`);
		text(
			`Started dates (Philippine time, inclusive): ${data.input.from ?? 'Any'} to ${data.input.to ?? 'Any'}`
		);
		text(
			`Status: ${data.input.status} | SOS type: ${data.input.sosType} | Search: ${data.input.search || 'Any'}`
		);
		const dispatcher = data.reports[0].incident;
		text(
			`Dispatcher: ${data.input.dispatcherId ? (dispatcher.dispatcherName ?? 'Unavailable') : 'All permitted'} | LGU: ${data.input.lguId ? (dispatcher.lguName ?? 'Central review') : 'All permitted'}`
		);
		text(
			'Confidential: contains personal incident information. Share only with authorized recipients.'
		);
		text(
			'Includes all matches across archive pages, up to 100 reports. Saved report snapshot; later changes are not included.'
		);
		for (const report of data.reports) {
			doc.addPage();
			const row = report.incident;
			heading(row.reference);
			text(`LGU: ${row.lguName ?? 'Central review'} | Status: ${row.status}`);
			text(`Person in distress: ${row.personName}`);
			text(`SOS: ${row.isForSomeoneElse ? 'For a trusted person' : 'For self'}`);
			text(
				`Caller: ${row.callerName} | Phone: ${row.callerPhone} | Relationship: ${report.callerRelationship || 'Self'}`
			);
			text(`Dispatcher: ${row.dispatcherName ?? 'Unavailable'}`);
			text(
				`Started: ${formatTime(row.startedAt)} | Confirmed: ${formatTime(row.confirmedAt)} | Ended: ${formatTime(row.endedAt)}`
			);
			if (row.endedAt)
				text(
					`Duration: ${Math.max(0, Math.floor((Date.parse(row.endedAt) - Date.parse(row.startedAt)) / 60000))} minutes`
				);
			text(
				`Reporter GPS: ${report.latitude}, ${report.longitude}${report.locationLabel ? ` | ${report.locationLabel}` : ''}`
			);
			if (row.isForSomeoneElse) {
				const point = report.personLocation;
				text(
					point
						? `Beneficiary shared GPS: ${point.latitude}, ${point.longitude} | Accuracy: ${point.accuracy} m | Recorded: ${formatTime(point.recordedAt)}. Historical snapshot, not live tracking.`
						: 'Beneficiary shared location: unavailable. Reporter GPS is not the beneficiary location.'
				);
			}
			if (report.cancellation)
				text(
					`Cancellation: ${report.cancellation.decision} | Reason: ${report.cancellation.reason}`
				);
			heading('Response notes');
			text(report.notes || 'No notes recorded.');
			for (const addendum of report.addenda) {
				heading(`Addendum | ${formatTime(addendum.createdAt)}`);
				text(`By: ${addendum.authorName}`);
				text(addendum.notes);
			}
			heading('AI-generated summary');
			const ai = report.ai.summary;
			if (ai) {
				text(
					`AI draft: ${ai.reviewedAt ? 'Reviewed' : 'Not reviewed'}${ai.isStale ? ' | Outdated: notes changed' : ''}`
				);
				text(`Generated: ${formatTime(ai.generatedAt)} | Reviewed: ${formatTime(ai.reviewedAt)}`);
				text(ai.summary);
			} else text('No AI summary saved.');
		}
		doc.end();
	});
}
