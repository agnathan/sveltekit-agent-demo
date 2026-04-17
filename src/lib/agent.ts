/**
 * Shared chat agent configuration for `streamText` in the API route.
 *
 * Exports model, system prompt, and tools — no ToolLoopAgent wrapper.
 */

import type { ToolSet } from 'ai';
import { createVertex } from '@ai-sdk/google-vertex';
import { answerFromImagesTool, calculatorTool, unitConverterTool } from './tools.js';

import { GOOGLE_PROJECT_ID, GOOGLE_LOCATION } from '$env/static/private';

function normalizeLocation(raw: string | undefined): string {
	const loc = (raw || '').trim();
	if (!loc || loc === 'global') return 'us-central1';
	return loc;
}

if (!GOOGLE_PROJECT_ID) {
	throw new Error('Missing required environment variable: GOOGLE_PROJECT_ID');
}

const MODEL = process.env.AGENT_MODEL?.trim() || 'gemini-2.5-flash';
const LOCATION = normalizeLocation(GOOGLE_LOCATION || process.env.GOOGLE_LOCATION_REGION);

const vertex = createVertex({
	project: GOOGLE_PROJECT_ID,
	location: LOCATION
});

/** Vertex model used for the multi-step chat agent. */
export const agentModel = vertex(MODEL);

/**
 * System instructions for the chat agent.
 * Includes optional tagged thinking for UI parsing on the client.
 */
export const agentSystem = `You are a helpful assistant with access to tools.
For document Q&A, call answerFromImages with the user's question.
Do not call retrieval tools separately for document Q&A.
You can also evaluate math expressions and convert units when needed.
Always explain tool results in natural language and include a short sources list with page numbers, image URLs, and bounding boxes (if available) when using document tools.

Before you use a tool or give your final answer, think step-by-step inside <thinking>...</thinking> tags so the user can follow your reasoning. Keep thinking concise.`;

/** Tools registered on the chat agent (passed to \`streamText\` and \`convertToModelMessages\`). */
export const agentTools = {
	answerFromImages: answerFromImagesTool,
	calculator: calculatorTool,
	unitConverter: unitConverterTool
} satisfies ToolSet;
