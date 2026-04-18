/**
 * Shared chat agent: {@link ToolLoopAgent} (Vercel AI SDK agents) for multi-step tool use.
 *
 * Vertex does not support mixing function tools (`VisualDocumentResearchAgent`, etc.) with the
 * provider-defined `googleMaps` tool in one request. The API passes
 * `options.useMapsForMessage` on each stream call; `prepareCall` registers either
 * chat tools or `googleMaps` only for that turn.
 *
 * `documentToolLoopAgent.tools` is the union of both (for UI message validation and
 * `convertToModelMessages`), matching the previous `agentToolsForHistory` pattern.
 */

import type { SharedV3ProviderOptions } from '@ai-sdk/provider';
import { ToolLoopAgent, stepCountIs, type InferAgentUIMessage, type ToolSet } from 'ai';
import { createVertex } from '@ai-sdk/google-vertex';
import { env } from '$env/dynamic/private';
import { z } from 'zod';
import { chatTools } from './tools.js';

function normalizeLocation(raw: string | undefined): string {
	const loc = (raw || '').trim();
	if (!loc || loc === 'global') return 'global';
	return loc;
}

const VERTEX_PROJECT =
	env.GOOGLE_PROJECT_ID?.trim() || env.GOOGLE_VERTEX_PROJECT?.trim() || '';
if (!VERTEX_PROJECT) {
	throw new Error(
		'Missing required environment variable: GOOGLE_PROJECT_ID or GOOGLE_VERTEX_PROJECT'
	);
}

const MODEL = process.env.AGENT_MODEL?.trim() || 'gemini-3.1-pro-preview';

const LOCATION = normalizeLocation(
	env.GOOGLE_LOCATION || env.GOOGLE_VERTEX_LOCATION || env.GOOGLE_LOCATION_REGION
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

/** Provider tool only — must not be combined with `agentChatTools` in one model call. */
export const agentMapsTools = { googleMaps } satisfies ToolSet;

/**
 * Union of all tools that may appear in chat history (validation + `convertToModelMessages`).
 */
export const agentToolsForHistory = {
	...chatTools,
	googleMaps
} satisfies ToolSet;

/** Default / document + math + units turn. */
export const agentSystemChat = `You are a helpful assistant with access to tools.
For document Q&A, call VisualDocumentResearchAgent with the user's question.
Do not call retrieval tools separately for document Q&A.
You can evaluate math expressions and convert units when needed.
Always explain tool results in natural language and include a short sources list with page numbers, image URLs, and bounding boxes (if available) when using document tools.

Before you use a tool or give your final answer, think step-by-step inside <thinking>...</thinking> tags so the user can follow your reasoning. Keep thinking concise.`;

/** When the client enables "Use Google Maps grounding" — only \`googleMaps\` is registered this turn. */
export const agentSystemMapsOnly = `You are a helpful assistant. For this turn you only have the Vertex googleMaps tool for real-world places, businesses, landmarks, addresses, walking distance, and "what is near X". Use googleMaps when grounding in Google Maps data improves the answer.
You cannot search documents or PDFs in this mode. If the user asks about uploaded documents, explain that they should send the question again with "Use Google Maps grounding" turned off.
Always summarize grounded results and cite place titles and Maps links when present.

Before you use a tool or give your final answer, think step-by-step inside <thinking>...</thinking> tags so the user can follow your reasoning. Keep thinking concise.`;

function mapsRetrievalProviderOptions(
	raw: unknown
):
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

/**
 * Gemini (Vertex) provider options: optionally stream tool-call JSON (`partialArgs`) for the UI.
 * Per `@ai-sdk/google`'s Vertex schema, `streamFunctionCallArguments` is only supported for
 * Gemini 3+ on Vertex — enabling it on e.g. `gemini-2.5-flash` yields INVALID_ARGUMENT from the API.
 * Merged with optional Maps retrieval bias on the `vertex` key.
 * @see https://ai-sdk.dev/providers/ai-sdk-providers/google-vertex
 */
function supportsVertexStreamFunctionCallArguments(modelId: string): boolean {
	return modelId.includes('gemini-3');
}

function streamTextProviderOptions(mapsLatLng: unknown, modelId: string) {
	const retrieval = mapsRetrievalProviderOptions(mapsLatLng);
	if (!supportsVertexStreamFunctionCallArguments(modelId)) {
		if (!retrieval) return {};
		return { vertex: retrieval.vertex };
	}
	const streamFc = { streamFunctionCallArguments: true as const };
	return {
		google: streamFc,
		vertex: retrieval?.vertex ? { ...retrieval.vertex, ...streamFc } : streamFc
	};
}

const documentAgentCallOptionsSchema = z.object({
	useMapsForMessage: z.boolean().optional(),
	mapsLatLng: z
		.object({
			latitude: z.number(),
			longitude: z.number()
		})
		.optional()
});

/** Per-request options for {@link documentToolLoopAgent} (maps mode + optional Vertex retrieval bias). */
export type DocumentAgentCallOptions = z.infer<typeof documentAgentCallOptionsSchema>;

/**
 * Multi-step agent (tool loop). The API uses `prepareCall` so each turn uses either
 * function tools or `googleMaps`, not both — required by Vertex.
 */
export const documentToolLoopAgent = new ToolLoopAgent<DocumentAgentCallOptions, ToolSet>({
	id: 'document-chat',
	model: agentModel,
	tools: agentToolsForHistory,
	instructions: agentSystemChat,
	stopWhen: stepCountIs(10),
	callOptionsSchema: documentAgentCallOptionsSchema,
	prepareCall: (opts) => {
		// ToolLoopAgent replaces the full merged call args with this return value — must
		// spread `opts` so `model`, `prompt`, `stopWhen`, etc. are not dropped.
		const call = opts.options;
		const useMaps = call?.useMapsForMessage === true;
		const providerOptions = streamTextProviderOptions(call?.mapsLatLng, MODEL) as SharedV3ProviderOptions;
		if (useMaps) {
			return {
				...opts,
				tools: { googleMaps },
				instructions: agentSystemMapsOnly,
				providerOptions
			};
		}
		return {
			...opts,
			tools: agentChatTools,
			instructions: agentSystemChat,
			providerOptions
		};
	}
});

export type DocumentAgentUIMessage = InferAgentUIMessage<typeof documentToolLoopAgent>;
