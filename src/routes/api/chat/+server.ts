/**
 * SvelteKit API route that streams agent responses.
 *
 * POST /api/chat
 *
 * The client sends the conversation as an array of UIMessage objects.
 * Uses `streamText` with a multi-step stop condition and returns
 * `toUIMessageStreamResponse` for @ai-sdk/svelte Chat.
 */
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai';
import type { RequestHandler } from '@sveltejs/kit';
import { agentModel, agentSystem, agentTools } from '$lib/agent';

export const POST: RequestHandler = async ({ request }) => {
	let messages: UIMessage[] = [];
	try {
		const body = await request.json();
		messages = Array.isArray(body.messages) ? body.messages : [];
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
		tools: agentTools,
		ignoreIncompleteToolCalls: true
	});

	const result = streamText({
		model: agentModel,
		system: agentSystem,
		messages: modelMessages,
		tools: agentTools,
		stopWhen: stepCountIs(8),
		abortSignal: abortController.signal
	});

	return result.toUIMessageStreamResponse({
		originalMessages: messages,
		sendReasoning: true
	});
};
