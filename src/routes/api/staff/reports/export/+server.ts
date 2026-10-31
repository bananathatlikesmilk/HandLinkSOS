import { filteredIncidentReports } from '#lib/server/incidents.ts';
import { reportPdf } from '#lib/server/report-pdf.ts';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const data = filteredIncidentReports(event);
	const pdf = await reportPdf(data);
	// Recheck access after asynchronous generation before releasing personal report data.
	const current = filteredIncidentReports(event);
	if (JSON.stringify(current) !== JSON.stringify(data)) {
		error(409, 'Reports changed while exporting. Refresh and retry.');
	}
	return new Response(new Uint8Array(pdf), {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `attachment; filename="handlink-reports-${new Date().toISOString().slice(0, 10)}.pdf"`,
			'Cache-Control': 'private, no-store',
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
