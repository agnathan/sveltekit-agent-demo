/**
 * Shared chat agent configuration for `streamText` in the API route.
 *
 * Exports model, system prompts, and tool sets — no ToolLoopAgent wrapper.
 *
 * Vertex does not support mixing function tools (`answerFromImages`, etc.) with
 * the provider-defined `googleMaps` tool in one request. The client sends
 * `useMapsForMessage` so each turn uses either `chatTools` or `{ googleMaps }`.
 */

import type { ToolSet } from 'ai';
import { createVertex } from '@ai-sdk/google-vertex';
import { env } from '$env/dynamic/private';
import { chatTools } from './tools.js';

function normalizeLocation(raw: string | undefined): string {
	const loc = (raw || '').trim();
	if (!loc || loc === 'global') return 'us-central1';
	return loc;
}

const VERTEX_PROJECT =
	env.GOOGLE_PROJECT_ID?.trim() || env.GOOGLE_VERTEX_PROJECT?.trim() || '';
if (!VERTEX_PROJECT) {
	throw new Error(
		'Missing required environment variable: GOOGLE_PROJECT_ID or GOOGLE_VERTEX_PROJECT'
	);
}

const MODEL = process.env.AGENT_MODEL?.trim() || 'gemini-2.5-flash';
const LOCATION = normalizeLocation(
	env.GOOGLE_LOCATION ||
		env.GOOGLE_VERTEX_LOCATION ||
		env.GOOGLE_LOCATION_REGION
);

const vertex = createVertex({
	project: VERTEX_PROJECT,
	location: LOCATION
});

/** Vertex model used for the multi-step chat agent. */
export const agentModel = vertex(MODEL);

/**
 * Native Vertex Google Maps grounding (same credential path as the model).
 * @see https://cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-with-google-maps
 */
const googleMaps = vertex.tools.googleMaps({});

/** Function tools only (document Q&A, calculator, units). */
export const agentChatTools = chatTools satisfies ToolSet;

/** Provider tool only — must not be combined with `agentChatTools` in one `streamText`. */
export const agentMapsTools = { googleMaps } satisfies ToolSet;

/**
 * Union of all tools that may appear in chat history, for `convertToModelMessages` only.
 * Not passed to `streamText` (that would re-trigger the Vertex mixed-tools limitation).
 */
export const agentToolsForHistory = {
	...chatTools,
	googleMaps
} satisfies ToolSet;

/** Default / document + math + units turn. */
export const agentSystemChat = `You are a helpful assistant with access to tools.
For document Q&A, call answerFromImages with the user's question.
Do not call retrieval tools separately for document Q&A.
You can evaluate math expressions and convert units when needed.
Always explain tool results in natural language and include a short sources list with page numbers, image URLs, and bounding boxes (if available) when using document tools.

Before you use a tool or give your final answer, think step-by-step inside <thinking>...</thinking> tags so the user can follow your reasoning. Keep thinking concise.`;

/** When the client enables "Use Google Maps grounding" — only \`googleMaps\` is registered this turn. */
export const agentSystemMapsOnly = `You are a helpful assistant. For this turn you only have the Vertex googleMaps tool for real-world places, businesses, landmarks, addresses, walking distance, and "what is near X". Use googleMaps when grounding in Google Maps data improves the answer.
You cannot search documents or PDFs in this mode. If the user asks about uploaded documents, explain that they should send the question again with "Use Google Maps grounding" turned off.
Always summarize grounded results and cite place titles and Maps links when present.

Before you use a tool or give your final answer, think step-by-step inside <thinking>...</thinking> tags so the user can follow your reasoning. Keep thinking concise.`;
