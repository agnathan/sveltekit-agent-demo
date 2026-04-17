/**
 * SvelteKit adapter: maps `$env/dynamic/private` into {@link AgentToolsConfig} and exposes
 * Vercel AI SDK tools. Portable logic lives in `./agent-tools/`.
 */
import { env } from '$env/dynamic/private';
import {
	createVercelAiAgentTools,
	ConsoleAgentToolsLogger,
	normalizeGoogleVertexLocation,
	RemoteDebugAgentToolsLogger
} from './agent-tools/index.js';
import type { AgentToolsConfig } from './agent-tools/types.js';

const DEFAULT_PINECONE_INDEX = 'pdf-image-upsert';
const DEFAULT_PINECONE_NAMESPACE = 'AAA_UPSERT_TEST';
const DEFAULT_TOP_K = 3;
const DEFAULT_VISION_MODEL = 'gemini-2.5-flash';

const DEBUG_INGEST_URL = 'http://127.0.0.1:7719/ingest/28e9ccf7-9636-4b69-be79-2ec6ddab30c2';
const DEBUG_SESSION_ID = '9b4c8a';

function buildConfig(): AgentToolsConfig {
	const topKRaw = env.PINECONE_TOP_K;
	const topK = topKRaw != null && String(topKRaw).trim() !== '' ? Number(topKRaw) : DEFAULT_TOP_K;

	return {
		pineconeApiKey: env.PINECONE_API_KEY?.trim() ?? '',
		googleProjectId: env.GOOGLE_PROJECT_ID?.trim() ?? '',
		googleLocation: normalizeGoogleVertexLocation(
			env.GOOGLE_LOCATION?.trim() || env.GOOGLE_LOCATION_REGION?.trim()
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

const feedbackEnabled = config.feedbackEnabled !== false;
const baseLogger = new ConsoleAgentToolsLogger({ feedbackEnabled });
const logger = new RemoteDebugAgentToolsLogger(baseLogger, DEBUG_INGEST_URL, DEBUG_SESSION_ID);

const vercelTools = createVercelAiAgentTools(config, logger);

export const pineconeQueryTool = vercelTools.pineconeQueryTool;
export const answerFromImagesTool = vercelTools.answerFromImagesTool;
export const calculatorTool = vercelTools.calculatorTool;
export const unitConverterTool = vercelTools.unitConverterTool;
