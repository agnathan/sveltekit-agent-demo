import { GoogleCredentialsEnvNormalizer } from './google-credentials.js';
import type { AgentToolsLogger } from './logger.js';
import { DocumentMetadataParser } from './parsers.js';
import { PineconeImageQueryService } from './pinecone-image-query.js';
import type { AgentToolsConfig, PineconeQueryResult } from './types.js';
import type { VisionAnswerResult } from './vertex-vision-answer.js';
import { VertexVisionAnswerService } from './vertex-vision-answer.js';
import { VertexMultimodalTextEmbedder } from './vertex-multimodal-embedder.js';

/**
 * Lazily wires Pinecone retrieval + Vertex vision QA from a plain config object.
 */
export class DocumentRetrievalAndVisionStack {
	private readonly credNormalizer = new GoogleCredentialsEnvNormalizer();
	private readonly metadataParser = new DocumentMetadataParser();
	private pineconeService: PineconeImageQueryService | null = null;
	private visionService: VertexVisionAnswerService | null = null;

	constructor(
		private readonly config: AgentToolsConfig,
		private readonly logger: AgentToolsLogger
	) {}

	get topK(): number {
		return this.config.topK;
	}

	private ensureServices(): void {
		assertAgentToolsConfig(this.config);
		const cwd = this.config.credentialsResolveCwd ?? process.cwd();
		this.credNormalizer.resolve(cwd, this.config.googleApplicationCredentials);

		if (!this.pineconeService) {
			const embedder = new VertexMultimodalTextEmbedder(
				this.config.googleProjectId,
				this.config.googleLocation,
				this.logger,
				this.config.multimodalEmbeddingModelId
			);
			this.pineconeService = new PineconeImageQueryService(
				this.config.pineconeApiKey,
				this.config.pineconeIndexName,
				this.config.pineconeNamespace,
				embedder,
				this.metadataParser,
				this.logger
			);
		}
		if (!this.visionService) {
			this.visionService = new VertexVisionAnswerService(
				this.config.googleProjectId,
				this.config.googleLocation,
				this.config.visionModel,
				this.logger
			);
		}
	}

	async queryPinecone(query: string, topK?: number): Promise<PineconeQueryResult> {
		this.ensureServices();
		const k = topK ?? this.config.topK;
		return this.pineconeService!.query(query, k);
	}

	async answerFromImages(question: string): Promise<VisionAnswerResult> {
		this.ensureServices();
		const fullResult = await this.pineconeService!.query(question, this.config.topK);
		return this.visionService!.answer(question, fullResult.imageUrls, fullResult.pageContexts);
	}

	get verboseRetrievalLogging(): boolean {
		return this.config.verboseRetrievalLogging === true;
	}
}

/** Validates config; throws with actionable messages (call before constructing the stack). */
export function assertAgentToolsConfig(config: AgentToolsConfig): void {
	if (!config.pineconeApiKey?.trim()) throw new Error('Missing PINECONE_API_KEY');
	if (!config.googleProjectId?.trim()) throw new Error('Missing GOOGLE_PROJECT_ID');
	if (!Number.isFinite(config.topK) || config.topK <= 0) {
		throw new Error(`Invalid PINECONE_TOP_K: ${config.topK}`);
	}
}
