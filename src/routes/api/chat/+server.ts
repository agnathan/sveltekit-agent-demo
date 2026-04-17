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

function debugLog(
	runId: string,
	hypothesisId: string,
	location: string,
	message: string,
	data: Record<string, unknown>
): void {
	// #region agent log
	fetch('http://127.0.0.1:7719/ingest/28e9ccf7-9636-4b69-be79-2ec6ddab30c2', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Debug-Session-Id': '9b4c8a'
		},
		body: JSON.stringify({
			sessionId: '9b4c8a',
			runId,
			hypothesisId,
			location,
			message,
			data,
			timestamp: Date.now()
		})
	}).catch(() => {});
	// #endregion
}

export const POST: RequestHandler = async ({ request }) => {
	const runId = `chat-${Date.now()}`;
	const started = Date.now();
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

	debugLog(runId, 'H5', 'api/chat/+server.ts:POST', 'Incoming chat request parsed', {
		messageCount: messages.length
	});

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
		abortSignal: abortController.signal,
		onStepFinish: (event) => {
			const eventRecord = event as Record<string, unknown>;
			const toolCalls = Array.isArray(eventRecord.toolCalls) ? eventRecord.toolCalls.length : 0;
			const toolResults = Array.isArray(eventRecord.toolResults) ? eventRecord.toolResults.length : 0;
			const toolCallNames = Array.isArray(eventRecord.toolCalls)
				? eventRecord.toolCalls
						.map((call) => {
							if (!call || typeof call !== 'object') return null;
							const callRecord = call as Record<string, unknown>;
							return typeof callRecord.toolName === 'string' ? callRecord.toolName : null;
						})
						.filter((name): name is string => !!name)
				: [];
			const textLen =
				typeof eventRecord.text === 'string'
					? eventRecord.text.length
					: typeof eventRecord.content === 'string'
						? eventRecord.content.length
						: null;
			debugLog(runId, 'H4', 'api/chat/+server.ts:onStepFinish', 'streamText step completed', {
				stepType: eventRecord.stepType ?? null,
				toolCalls,
				toolResults,
				toolCallNames,
				textLen,
				elapsedMs: Date.now() - started
			});
		},
		onFinish: (event) => {
			const usage = event.usage as Record<string, unknown> | undefined;
			debugLog(runId, 'H4', 'api/chat/+server.ts:streamText.onFinish', 'streamText finished', {
				elapsedMs: Date.now() - started,
				totalTokens: usage?.totalTokens ?? null,
				inputTokens: usage?.inputTokens ?? null,
				outputTokens: usage?.outputTokens ?? null,
				hasUsage: !!usage
			});
		}
	});

	return result.toUIMessageStreamResponse({
		originalMessages: messages,
		sendReasoning: true,
		onFinish: (event) => {
			debugLog(runId, 'H4', 'api/chat/+server.ts:toUIMessageStreamResponse.onFinish', 'UI message stream finished', {
				elapsedMs: Date.now() - started,
				isAborted: event.isAborted,
				finishReason: event.finishReason ?? null
			});
		}
	});
};
