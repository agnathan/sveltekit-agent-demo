/**
 * SvelteKit adapter: maps `$env/dynamic/private` into {@link AgentToolsConfig} and exposes
 * Vercel AI SDK tools. Portable logic lives in `./agent-tools/`.
 */
import { env } from '$env/dynamic/private';
import {
	createAllAgentTools,
	createChatAgentTools,
	ConsoleAgentToolsLogger,
	DocumentRetrievalAndVisionStack,
	GoogleCredentialsEnvNormalizer,
	normalizeGoogleVertexLocation
} from './agent-tools/index.js';
import type { AgentToolsConfig } from './agent-tools/types.js';

const DEFAULT_PINECONE_INDEX = 'pdf-image-upsert';
const DEFAULT_PINECONE_NAMESPACE = 'AAA_UPSERT_TEST';
const DEFAULT_TOP_K = 3;
const DEFAULT_VISION_MODEL = 'gemini-2.5-flash';

function buildConfig(): AgentToolsConfig {
	const topKRaw = env.PINECONE_TOP_K;
	const topK = topKRaw != null && String(topKRaw).trim() !== '' ? Number(topKRaw) : DEFAULT_TOP_K;

	return {
		pineconeApiKey: env.PINECONE_API_KEY?.trim() ?? '',
		googleProjectId:
			env.GOOGLE_PROJECT_ID?.trim() || env.GOOGLE_VERTEX_PROJECT?.trim() || '',
		googleLocation: normalizeGoogleVertexLocation(
			env.GOOGLE_LOCATION?.trim() ||
				env.GOOGLE_LOCATION_REGION?.trim() ||
				env.GOOGLE_VERTEX_LOCATION?.trim()
		),
		pineconeIndexName:
			env.PINECONE_INDEX_NAME?.trim() || env.PINECONE_INDEX?.trim() || DEFAULT_PINECONE_INDEX,
		pineconeNamespace: env.PINECONE_NAMESPACE?.trim() || DEFAULT_PINECONE_NAMESPACE,
		topK,
		visionModel: env.GEMINI_MODEL?.trim() || DEFAULT_VISION_MODEL,
		googleApplicationCredentials: env.GOOGLE_APPLICATION_CREDENTIALS,
		credentialsResolveCwd: process.cwd(),
		feedbackEnabled: (env.AGENT_FEEDBACK ?? 'true').trim().toLowerCase() !== 'false',
		verboseRetrievalLogging: (env.AGENT_VERBOSE_RETRIEVAL ?? '').trim().toLowerCase() === 'true'
	};
}

const config = buildConfig();

new GoogleCredentialsEnvNormalizer().resolve(
	config.credentialsResolveCwd ?? process.cwd(),
	config.googleApplicationCredentials
);

const feedbackEnabled = config.feedbackEnabled !== false;
const logger = new ConsoleAgentToolsLogger({ feedbackEnabled });

const stack = new DocumentRetrievalAndVisionStack(config, logger);
const context = {
	stack,
	logger
};
const allTools = createAllAgentTools(context);

export const pineconeQueryTool = allTools.pineconeQuery;
export const visualDocumentResearchAgentTool = allTools.VisualDocumentResearchAgent;
export const calculatorTool = allTools.calculator;
export const unitConverterTool = allTools.unitConverter;
export const chatTools = createChatAgentTools(context);
