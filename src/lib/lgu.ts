export function routingDescription(reason: string) {
	const labels: Record<string, string> = {
		gps: 'GPS boundary match',
		manual: 'Assigned by provincial coordination',
		provincial_intake: 'Provincial intake and case coordination',
		legacy: 'Existing incident',
		unconfigured: 'GPS boundaries not configured',
		ambiguous: 'Overlapping boundaries ? central review',
		outside_boundaries: 'Outside configured boundaries',
		beneficiary_location_unavailable: 'No current shared location for the person needing help',
		reported_address: 'Caller-reported address; confirm the municipality with the caller'
	};
	return Object.hasOwn(labels, reason) ? labels[reason] : 'Routing review required';
}

export type LguBoundary =
	| { type: 'Polygon'; coordinates: number[][][] }
	| { type: 'MultiPolygon'; coordinates: number[][][][] };

export function parseBoundary(input: unknown): LguBoundary | null {
	if (input === null) return null;
	if (input && typeof input === 'object' && 'type' in input && input.type === 'FeatureCollection') {
		if (!('features' in input) || !Array.isArray(input.features) || input.features.length !== 1)
			throw new Error(
				'Import one LGU feature at a time. A FeatureCollection must contain exactly one feature.'
			);
		input = input.features[0];
	}
	if (
		input &&
		typeof input === 'object' &&
		'type' in input &&
		input.type === 'Feature' &&
		'geometry' in input
	)
		input = input.geometry;
	if (
		!input ||
		typeof input !== 'object' ||
		!('type' in input) ||
		!('coordinates' in input) ||
		!['Polygon', 'MultiPolygon'].includes(String(input.type))
	)
		throw new Error('Use GeoJSON Polygon, MultiPolygon, or a Feature containing one.');
	const polygons = input.type === 'Polygon' ? [input.coordinates] : input.coordinates;
	let vertices = 0;
	if (!Array.isArray(polygons) || !polygons.length || polygons.length > 1000)
		throw new Error('Boundary must contain valid polygons.');
	const cleaned = polygons.map((polygon: unknown) => {
		if (!Array.isArray(polygon) || !polygon.length || polygon.length > 100)
			throw new Error('Each polygon needs an outer ring and optional holes.');
		return polygon.map((ring: unknown) => {
			if (!Array.isArray(ring) || ring.length < 4 || (vertices += ring.length) > 10000)
				throw new Error(
					'Use closed rings with at least four points and at most 10,000 total vertices.'
				);
			const points = ring.map((point: unknown) => {
				if (
					!Array.isArray(point) ||
					point.length < 2 ||
					typeof point[0] !== 'number' ||
					typeof point[1] !== 'number' ||
					!Number.isFinite(point[0]) ||
					!Number.isFinite(point[1]) ||
					Math.abs(point[0]) > 180 ||
					Math.abs(point[1]) > 90
				)
					throw new Error('GeoJSON coordinates must be [longitude, latitude] within valid ranges.');
				return [point[0], point[1]];
			});
			const first = points[0],
				last = points[points.length - 1];
			if (first[0] !== last[0] || first[1] !== last[1])
				throw new Error('Every boundary ring must be closed.');
			let area = 0;
			for (let i = 1; i < points.length; i++) {
				if (Math.abs(points[i][0] - points[i - 1][0]) > 180)
					throw new Error('Split antimeridian crossings into separate polygons.');
				area += points[i - 1][0] * points[i][1] - points[i][0] * points[i - 1][1];
			}
			if (Math.abs(area) < 1e-12) throw new Error('A boundary ring must enclose an area.');
			return points;
		});
	});
	return input.type === 'Polygon'
		? { type: 'Polygon', coordinates: cleaned[0] }
		: { type: 'MultiPolygon', coordinates: cleaned };
}

function inRing(ring: number[][], x: number, y: number): 0 | 1 | 2 {
	let inside = false;
	for (let i = 1; i < ring.length; i++) {
		const [ax, ay] = ring[i - 1],
			[bx, by] = ring[i];
		const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
		if (
			Math.abs(cross) < 1e-10 &&
			x >= Math.min(ax, bx) &&
			x <= Math.max(ax, bx) &&
			y >= Math.min(ay, by) &&
			y <= Math.max(ay, by)
		)
			return 2;
		if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
	}
	return inside ? 1 : 0;
}

export function boundaryContains(boundary: LguBoundary, latitude: number, longitude: number) {
	const polygons = boundary.type === 'Polygon' ? [boundary.coordinates] : boundary.coordinates;
	return polygons.some((rings) => {
		const outer = inRing(rings[0], longitude, latitude);
		if (!outer) return false;
		if (outer === 2) return true;
		for (const hole of rings.slice(1)) {
			const result = inRing(hole, longitude, latitude);
			if (result === 2) return true;
			if (result === 1) return false;
		}
		return true;
	});
}
export const PROVINCIAL_LGU_ID = 'provincial-intake';
