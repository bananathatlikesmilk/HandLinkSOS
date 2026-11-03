import PDFDocument from 'pdfkit';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { filteredIncidentReports } from './incidents.ts';
import { incidentDuration, incidentStatusLabel } from '../incidents.ts';

const require = createRequire(import.meta.url);
const loadFont = (weight: number) =>
	readFileSync(
		require.resolve(`@fontsource/noto-sans/files/noto-sans-latin-${weight}-normal.woff`)
	);
const regular = loadFont(400),
	bold = loadFont(700);
const ink = '#243842',
	muted = '#586b73',
	accent = '#15685e',
	rule = '#dce6e7';
const formatTime = (value: string | null) =>
	value
		? new Date(value).toLocaleString('en-PH', {
				timeZone: 'Asia/Manila',
				dateStyle: 'medium',
				timeStyle: 'medium'
			})
		: 'Not recorded';

export function reportPdf(data: ReturnType<typeof filteredIncidentReports>): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const doc = new PDFDocument({
			size: 'A4',
			margins: { top: 88, bottom: 54, left: 44, right: 44 },
			bufferPages: true,
			info: { Title: 'HandLink filtered incident reports', Author: 'HandLink-SOS' }
		});
		const chunks: Buffer[] = [];
		doc.on('data', (chunk) => chunks.push(chunk));
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);
		doc.registerFont('Body', regular).registerFont('Bold', bold).font('Body');
		const left = 44,
			width = doc.page.width - 88;
		let currentReference = '';
		const pageReferences = [''];
		doc.on('pageAdded', () => pageReferences.push(currentReference));
		const room = (height: number) => {
			if (doc.y + height > doc.page.height - 54) doc.addPage();
		};
		const text = (value: string, color = ink, size = 9.5) => {
			doc
				.font('Body')
				.fontSize(size)
				.fillColor(color)
				.text(value, left, doc.y, { width, lineGap: 2, paragraphGap: 7 });
		};
		const section = (title: string, ai = false) => {
			room(65);
			const y = doc.y + 5;
			doc.rect(left, y, width, 25).fill(ai ? '#fff3d5' : '#edf5f3');
			doc.rect(left, y, 3, 25).fill(ai ? '#a86608' : accent);
			doc
				.font('Bold')
				.fontSize(10.5)
				.fillColor(ai ? '#81500a' : accent)
				.text(title, left + 11, y + 5, { width: width - 22 });
			doc.y = y + 33;
			doc.x = left;
		};
		const fields = (cells: [string, string][]) => {
			const gap = 10,
				cellWidth = (width - gap) / 2;
			for (let i = 0; i < cells.length; i += 2) {
				const row = cells.slice(i, i + 2);
				doc.font('Body').fontSize(9.5);
				const height =
					Math.max(
						...row.map(([, value]) =>
							doc.heightOfString(value, { width: cellWidth - 20, lineGap: 1 })
						)
					) + 24;
				room(height + 5);
				const y = doc.y;
				row.forEach(([label, value], column) => {
					const x = left + column * (cellWidth + gap);
					doc.rect(x, y, cellWidth, height).fillAndStroke('#f7f9fa', rule);
					doc
						.font('Bold')
						.fontSize(8)
						.fillColor(muted)
						.text(`${label}:`, x + 10, y + 5, { width: cellWidth - 20 });
					doc
						.font('Body')
						.fontSize(9.5)
						.fillColor(ink)
						.text(value, x + 10, y + 17, { width: cellWidth - 20, lineGap: 1 });
				});
				doc.x = left;
				doc.y = y + height + 5;
			}
		};
		const first = data.reports[0].incident;
		const sosType =
			data.input.sosType === 'self'
				? 'For self'
				: data.input.sosType === 'trusted'
					? 'For a trusted person'
					: 'All types';
		const metadata = [
			`Generated: ${formatTime(new Date().toISOString())} | ${data.reports.length} matching reports`,
			`Incident start date range: ${data.input.from ?? 'Any'} to ${data.input.to ?? 'Any'} (both dates included)`,
			`Status: ${data.input.status} | SOS type: ${sosType} | Access scope: ${data.scope}`,
			`Dispatcher: ${data.input.dispatcherId ? (first.dispatcherName ?? 'Unavailable') : 'All permitted'} | LGU: ${data.input.lguId ? (first.lguName ?? 'Central review') : 'All permitted'}`,
			...(data.input.search ? [`Search: ${data.input.search}`] : []),
			'All times are Philippine time. Saved snapshot of all matches across archive pages.'
		].join('\n');
		doc.font('Body').fontSize(8);
		const metadataHeight = doc.heightOfString(metadata, { width: width - 22, lineGap: 3 }) + 20;
		const metadataY = doc.y;
		doc.roundedRect(left, metadataY, width, metadataHeight, 5).fillAndStroke('#edf5f3', '#cedfda');
		doc
			.fillColor(muted)
			.text(metadata, left + 11, metadataY + 9, { width: width - 22, lineGap: 3 });
		doc.x = left;
		doc.y = metadataY + metadataHeight + 16;
		for (const [index, report] of data.reports.entries()) {
			const row = report.incident;
			currentReference = row.reference;
			if (index > 0) doc.addPage();
			else pageReferences[0] = currentReference;
			doc
				.font('Bold')
				.fontSize(8)
				.fillColor(muted)
				.text(`CASE ${index + 1} OF ${data.reports.length}`, left, doc.y);
			doc.moveDown(0.3).font('Bold').fontSize(21).fillColor(accent).text(row.reference);
			text(
				report.cancellation?.decision === 'approved'
					? 'Cancellation approved'
					: incidentStatusLabel(row),
				muted,
				9
			);
			section('Incident details');
			fields([
				['Person in distress', row.personName],
				['SOS', row.isForSomeoneElse ? 'For a trusted person' : 'For self'],
				['Caller', row.callerName],
				['Caller phone', row.callerPhone],
				['Caller relationship', report.callerRelationship || 'Self'],
				['Dispatcher', row.dispatcherName ?? 'Unavailable'],
				['LGU', row.lguName ?? 'Central review'],
				['Status', incidentStatusLabel(row)],
				['Started', formatTime(row.startedAt)],
				['Confirmed', formatTime(row.confirmedAt)],
				['Ended', formatTime(row.endedAt)],
				['Response duration', incidentDuration(row.startedAt, row.endedAt)]
			]);
			section('Location');
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
			if (report.cancellation) {
				section('Cancellation');
				text(`Decision: ${report.cancellation.decision} | Reason: ${report.cancellation.reason}`);
			}
			section('Response notes');
			text(report.notes || 'No notes recorded.');
			if (report.incident.provincialWorkflow) {
				section('Confirmed response updates');
				if (!report.responseUpdates?.length) text('No confirmed updates recorded.', muted);
				for (const update of report.responseUpdates ?? []) {
					room(60);
					text(
						`${update.type === 'on_route' ? 'On route' : update.type === 'cancellation_approved' ? 'Cancellation approved' : 'Resolved'} | Recorded: ${formatTime(update.createdAt)} | By: ${update.actorName}`,
						muted,
						8
					);
					text(update.notes);
				}
			}
			section('Report addenda');
			if (!report.addenda.length) text('No addenda recorded.', muted);
			for (const addendum of report.addenda) {
				room(60);
				text(`${formatTime(addendum.createdAt)} | By: ${addendum.authorName}`, muted, 8);
				text(addendum.notes);
			}
			section('AI-generated summary', true);
			const ai = report.ai.summary;
			if (ai) {
				text(
					`AI draft: ${ai.reviewedAt ? 'Reviewed' : 'Not reviewed'}${ai.isStale ? ' | Outdated: notes changed' : ''}`,
					'#81500a'
				);
				text(
					`Generated: ${formatTime(ai.generatedAt)} | Reviewed: ${formatTime(ai.reviewedAt)}`,
					muted,
					8
				);
				text(ai.summary);
			} else text('No AI summary saved.', muted);
		}
		// Add running identification and page counts after all flowing content has been laid out.
		const range = doc.bufferedPageRange();
		for (let i = range.start; i < range.start + range.count; i++) {
			doc.switchToPage(i);
			doc
				.font('Bold')
				.fontSize(20)
				.fillColor(accent)
				.text('HANDLINK', left, 27, { lineBreak: false });
			doc
				.font('Body')
				.fontSize(8)
				.fillColor(muted)
				.text(`INCIDENT REPORTS | ${pageReferences[i] ?? ''}`, left, 55, { lineBreak: false });
			doc
				.font('Bold')
				.fontSize(8)
				.text('CONFIDENTIAL', left, 34, { width, align: 'right', lineBreak: false });
			doc
				.moveTo(left, 74)
				.lineTo(left + width, 74)
				.lineWidth(1.5)
				.strokeColor(accent)
				.stroke();
			const bottom = doc.page.height - 32;
			doc
				.moveTo(left, bottom - 9)
				.lineTo(left + width, bottom - 9)
				.lineWidth(0.5)
				.strokeColor(rule)
				.stroke();
			doc
				.font('Body')
				.fontSize(7)
				.fillColor(muted)
				.text('Confidential · Share only with authorized recipients.', left, bottom, {
					lineBreak: false
				});
			const pageNumber = `Page ${i + 1} of ${range.count}`;
			doc.text(pageNumber, left + width - doc.widthOfString(pageNumber), bottom, {
				lineBreak: false
			});
		}
		doc.end();
	});
}
