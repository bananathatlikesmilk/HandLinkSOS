import { privateJson } from '#lib/server/api.ts';
import { listTrusted } from '#lib/server/trusted.ts';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = (event) => privateJson(listTrusted(event));
