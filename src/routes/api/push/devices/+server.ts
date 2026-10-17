import { privateJson, readInput } from '#lib/server/api.ts';
import { pushStatus, registerPushDevice, revokePushDevice } from '#lib/server/push-devices.ts';
import { deviceInput } from '#lib/server/validation.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => privateJson(pushStatus(event));
export const POST: RequestHandler = async (event) =>
	privateJson(registerPushDevice(event, await readInput(event, deviceInput)));
export const DELETE: RequestHandler = async (event) =>
	privateJson(revokePushDevice(event, await readInput(event, deviceInput)));
