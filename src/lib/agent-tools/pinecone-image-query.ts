import { Pinecone } from '@pinecone-database/pinecone';
import type { AgentToolsLogger } from './logger.js';
import type { DocumentMetadataParser } from './parsers.js';
import type { PineconeMatch, PineconeQueryResult } from './types.js';
import type { VertexMultimodalTextEmbedder } from './vertex-multimodal-embedder.js';

export class PineconeImageQueryService {
	constructor(
		private readonly apiKey: string,
		private readonly indexName: string,
		private readonly namespace: string,
		private readonly embedder: VertexMultimodalTextEmbedder,
		private readonly metadataParser: DocumentMetadataParser,
		private readonly logger: AgentToolsLogger
	) {}

	async query(query: string, topK: number): Promise<PineconeQueryResult> {
		this.logger.info('Running Pinecone query', { topK, index: this.indexName, namespace: this.namespace });
		const vector = await this.embedder.embed(query);
		const pc = new Pinecone({ apiKey: this.apiKey });
		const index = pc.index(this.indexName).namespace(this.namespace);
		const response = await index.query({ vector, topK, includeMetadata: true });
		const matches = response.matches ?? [];

		const normalized: PineconeMatch[] = matches.map((m) => {
			const meta = (m.metadata ?? {}) as {
				imageUrl?: string;
				pageText?: string;
				textPreview?: string;
				pageNumber?: number;
			} & Record<string, unknown>;
			const textItems = this.metadataParser.extractTextItems(meta);
			const topLevelBoundingBox = this.metadataParser.extractBoundingBox(meta);
			const firstTextItemBoundingBox = textItems.find((item) => item.boundingBox)?.boundingBox ?? null;

			return {
				pageNumber: meta.pageNumber ?? null,
				imageUrl: meta.imageUrl ?? null,
				pageText: (meta.pageText ?? meta.textPreview ?? '').trim(),
				boundingBox: topLevelBoundingBox ?? firstTextItemBoundingBox,
				textItems,
				metadata: meta,
				score: m.score ?? null
			};
		});

		return {
			query,
			indexName: this.indexName,
			namespace: this.namespace,
			matches: normalized,
			imageUrls: normalized.map((m) => m.imageUrl).filter((url): url is string => !!url),
			pageContexts: normalized
				.filter((m) => !!m.pageText)
				.map((m) => ({
					pageNumber: m.pageNumber,
					pageText: m.pageText,
					imageUrl: m.imageUrl,
					boundingBox: m.boundingBox,
					textItems: m.textItems,
					metadata: m.metadata
				}))
		};
	}
}
