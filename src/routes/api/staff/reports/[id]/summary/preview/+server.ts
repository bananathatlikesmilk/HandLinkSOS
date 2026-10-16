import { privateJson } from '#lib/server/api.ts';
import { previewAiSummary } from '#lib/server/ai-summaries.ts';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = (event) => privateJson(previewAiSummary(event, event.params.id));
