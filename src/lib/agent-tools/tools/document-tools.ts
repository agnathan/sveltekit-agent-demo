import { tool } from 'ai';
import { z } from 'zod';
import type { BoundingBox, HighlightBox, TextItem } from '../types.js';
import type { AgentToolContext } from '../tool-context.js';

export function createDocumentTools({ stack, logger }: AgentToolContext) {
	const pineconeQuery = tool({
		description: 'Query Pinecone for relevant PDF page and image matches and return image URLs.',
		inputSchema: z.object({
			query: z.string().describe('The user question to embed and search in Pinecone.')
		}),
		execute: async ({ query }) => {
			const started = Date.now();
			const topK = stack.topK;
			logger.info('Tool start: pineconeQuery', { query, topK });
			const result = await stack.queryPinecone(query, topK);
			if (stack.verboseRetrievalLogging) {
				console.error('[pineconeQuery full result]', JSON.stringify(result, null, 2));
			}
			logger.info('Tool end: pineconeQuery', {
				elapsedMs: Date.now() - started,
				matches: result.matches.length,
				imageUrls: result.imageUrls.length
			});
			return result;
		}
	});

	const visualDocumentResearchAgent = tool({
		description:
			'Answer a document question by querying Pinecone and then using Google Vertex vision. This keeps large retrieval payloads out of the model loop for faster responses.',
		inputSchema: z.object({
			question: z.string().describe('The user question to answer.')
		}),
		execute: async ({ question }) => {
			const started = Date.now();
			try {
				logger.info('Tool start: VisualDocumentResearchAgent', {
					questionChars: question.length
				});
				const result = await stack.answerFromImages(question);
				logger.info('Tool end: VisualDocumentResearchAgent', {
					elapsedMs: Date.now() - started,
					usedImageUrls: result.usedImageUrls.length,
					answerChars: result.answer.length
				});
				return result;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				logger.info('Tool error: VisualDocumentResearchAgent', { message, elapsedMs: Date.now() - started });
				return {
					error: message,
					answer: '',
					usedImageUrls: [] as string[],
					highlightBoxes: [] as HighlightBox[],
					sources: [] as Array<{
						pageNumber: number | null;
						imageUrl: string | null;
						boundingBox: BoundingBox | null;
						textItems: TextItem[];
						metadata: Record<string, unknown>;
					}>
				};
			}
		}
	});

	return {
		pineconeQuery,
		VisualDocumentResearchAgent: visualDocumentResearchAgent
	};
}
