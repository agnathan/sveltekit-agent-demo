/**
 * SvelteKit API route that streams agent responses.
 *
 * POST /api/chat
 *
 * The client sends the conversation as an array of UIMessage objects.
 * Optional JSON fields: `useMapsForMessage` (boolean) selects Vertex `googleMaps`-only
 * tools vs default chat tools; `mapsLatLng` / `retrievalLatLng` set Maps retrieval bias.
 * Uses `streamText` with a multi-step stop condition and returns
 * `toUIMessageStreamResponse` for @ai-sdk/svelte Chat.
 */
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai';
import type { RequestHandler } from '@sveltejs/kit';
import {
	agentChatTools,
	agentMapsTools,
	agentModel,
	agentSystemChat,
	agentSystemMapsOnly,
	agentToolsForHistory
} from '$lib/agent';

function mapsRetrievalProviderOptions(raw: unknown):
	| { vertex: { retrievalConfig: { latLng: { latitude: number; longitude: number } } } }
	| undefined {
	if (!raw || typeof raw !== 'object') return undefined;
	const o = raw as Record<string, unknown>;
	if (typeof o.latitude !== 'number' || typeof o.longitude !== 'number') return undefined;
	return {
		vertex: {
			retrievalConfig: {
				latLng: { latitude: o.latitude, longitude: o.longitude }
			}
		}
	};
}

function readUseMapsForMessage(raw: unknown): boolean {
	if (raw === true) return true;
	if (raw === 'true') return true;
	return false;
}

export const POST: RequestHandler = async ({ request }) => {
	let messages: UIMessage[] = [];
	let useMapsForMessage = false;
	let providerOptions:
		| { vertex: { retrievalConfig: { latLng: { latitude: number; longitude: number } } } }
		| undefined;
	try {
		const body: unknown = await request.json();
		if (body && typeof body === 'object') {
			const b = body as Record<string, unknown>;
			messages = Array.isArray(b.messages) ? (b.messages as UIMessage[]) : [];
			useMapsForMessage = readUseMapsForMessage(b.useMapsForMessage);
			providerOptions = mapsRetrievalProviderOptions(b.mapsLatLng ?? b.retrievalLatLng);
		}
	} catch {
		return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const abortController = new AbortController();
	request.signal.addEventListener('abort', () => {
		abortController.abort();
	});

	const modelMessages = await convertToModelMessages(messages, {
		tools: agentToolsForHistory,
		ignoreIncompleteToolCalls: true
	});

	const streamTools = useMapsForMessage ? agentMapsTools : agentChatTools;
	const system = useMapsForMessage ? agentSystemMapsOnly : agentSystemChat;

	const result = streamText({
		model: agentModel,
		system,
		messages: modelMessages,
		tools: streamTools,
		...(providerOptions ? { providerOptions } : {}),
		stopWhen: stepCountIs(8),
		abortSignal: abortController.signal
	});

	return result.toUIMessageStreamResponse({
		originalMessages: messages,
		sendReasoning: true
	});
};
