import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBoundary, boundaryContains } from '../src/lib/lgu.ts';

const square = [
	[120, 14],
	[121, 14],
	[121, 15],
	[120, 15],
	[120, 14]
];
test('LGU geometry handles polygons, holes, multipolygons and boundary points', () => {
	const simple = parseBoundary({
		type: 'Feature',
		properties: { name: 'test' },
		geometry: { type: 'Polygon', coordinates: [square] }
	});
	assert.equal(boundaryContains(simple, 14.5, 120.5), true);
	assert.deepEqual(
		parseBoundary({
			type: 'FeatureCollection',
			features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [square] } }]
		}),
		simple
	);
	assert.equal(boundaryContains(simple, 16, 120.5), false);
	assert.equal(boundaryContains(simple, 14, 120.5), true);
	const holes = parseBoundary({
		type: 'Polygon',
		coordinates: [
			square,
			[
				[120.2, 14.2],
				[120.8, 14.2],
				[120.8, 14.8],
				[120.2, 14.8],
				[120.2, 14.2]
			]
		]
	});
	assert.equal(boundaryContains(holes, 14.5, 120.5), false);
	assert.equal(boundaryContains(holes, 14.1, 120.1), true);
	const multi = parseBoundary({
		type: 'MultiPolygon',
		coordinates: [
			[square],
			[
				[
					[122, 14],
					[123, 14],
					[123, 15],
					[122, 15],
					[122, 14]
				]
			]
		]
	});
	assert.equal(boundaryContains(multi, 14.5, 122.5), true);
	assert.equal(boundaryContains(multi, 14.5, 121.5), false);
});
test('LGU geometry rejects malformed, out-of-range, unclosed and degenerate boundaries', () => {
	for (const input of [
		undefined,
		{},
		{ type: 'Point', coordinates: [120, 14] },
		{ type: 'Polygon', coordinates: [] },
		{ type: 'Polygon', coordinates: [square.slice(0, 4)] },
		{
			type: 'Polygon',
			coordinates: [
				[
					[0, 91],
					[1, 91],
					[1, 92],
					[0, 91]
				]
			]
		},
		{
			type: 'Polygon',
			coordinates: [
				[
					[0, 0],
					[1, 1],
					[2, 2],
					[0, 0]
				]
			]
		},
		{
			type: 'Polygon',
			coordinates: [
				[
					[0, 0],
					[NaN, 1],
					[1, 1],
					[0, 0]
				]
			]
		}
	])
		assert.throws(() => parseBoundary(input));
	assert.equal(parseBoundary(null), null);
});
