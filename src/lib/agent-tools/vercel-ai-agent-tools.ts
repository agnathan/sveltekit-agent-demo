import { tool } from 'ai';
import { z } from 'zod';
import { DocumentRetrievalAndVisionStack } from './document-stack.js';
import type { AgentToolsLogger } from './logger.js';
import type { AgentToolsConfig, BoundingBox, HighlightBox, TextItem } from './types.js';

const calculatorInputSchema = z.object({
	expression: z.string().describe('A math expression to evaluate, e.g. "(2 + 3) * 4"')
});

const unitConverterInputSchema = z.object({
	value: z.number().describe('The numeric value to convert'),
	from: z
		.enum(['miles', 'km', 'lbs', 'kg', 'fahrenheit', 'celsius'])
		.describe('The source unit'),
	to: z.enum(['miles', 'km', 'lbs', 'kg', 'fahrenheit', 'celsius']).describe('The target unit')
});

/**
 * Builds Vercel AI SDK `tool()` instances bound to a {@link DocumentRetrievalAndVisionStack}.
 */
export class VercelAiAgentTools {
	readonly pineconeQueryTool;
	readonly answerFromImagesTool;
	readonly calculatorTool;
	readonly unitConverterTool;

	constructor(
		private readonly stack: DocumentRetrievalAndVisionStack,
		private readonly logger: AgentToolsLogger
	) {
		this.pineconeQueryTool = tool({
			description: 'Query Pinecone for relevant PDF page and image matches and return image URLs.',
			inputSchema: z.object({
				query: z.string().describe('The user question to embed and search in Pinecone.')
			}),
			execute: async ({ query }) => {
				const started = Date.now();
				const topK = this.stack.topK;
				this.logger.info('Tool start: pineconeQuery', { query, topK });
				const result = await this.stack.queryPinecone(query, topK);
				if (this.stack.verboseRetrievalLogging) {
					console.error('[pineconeQuery full result]', JSON.stringify(result, null, 2));
				}
				this.logger.info('Tool end: pineconeQuery', {
					elapsedMs: Date.now() - started,
					matches: result.matches.length,
					imageUrls: result.imageUrls.length
				});
				return result;
			}
		});

		this.answerFromImagesTool = tool({
			description:
				'Answer a document question by querying Pinecone and then using Google Vertex vision. This keeps large retrieval payloads out of the model loop for faster responses.',
			inputSchema: z.object({
				question: z.string().describe('The user question to answer.')
			}),
			execute: async ({ question }) => {
				const started = Date.now();
				try {
					this.logger.info('Tool start: answerFromImages', {
						questionChars: question.length
					});
					const result = await this.stack.answerFromImages(question);
					this.logger.info('Tool end: answerFromImages', {
						elapsedMs: Date.now() - started,
						usedImageUrls: result.usedImageUrls.length,
						answerChars: result.answer.length
					});
					return result;
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					this.logger.info('Tool error: answerFromImages', { message, elapsedMs: Date.now() - started });
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

		this.calculatorTool = tool({
			description:
				'Evaluate a mathematical expression and return the result. Supports +, -, *, /, parentheses, and exponents (**).',
			inputSchema: calculatorInputSchema,
			execute: async ({ expression }) => {
				try {
					const sanitized = expression.replace(/[^0-9+\-*/().^ ]/g, '');
					const withPow = sanitized.replace(/\^/g, '**');
					const result = new Function(`return (${withPow})`)();
					return { expression, result: Number(result) };
				} catch {
					return { expression, error: 'Could not evaluate the expression.' };
				}
			}
		});

		this.unitConverterTool = tool({
			description: 'Convert a value between common units (miles/km, lbs/kg, °F/°C).',
			inputSchema: unitConverterInputSchema,
			execute: async ({ value, from, to }) => {
				const conversions: Record<string, (v: number) => number> = {
					'miles->km': (v) => v * 1.60934,
					'km->miles': (v) => v / 1.60934,
					'lbs->kg': (v) => v * 0.453592,
					'kg->lbs': (v) => v / 0.453592,
					'fahrenheit->celsius': (v) => ((v - 32) * 5) / 9,
					'celsius->fahrenheit': (v) => (v * 9) / 5 + 32
				};

				const key = `${from}->${to}`;
				const fn = conversions[key];

				if (!fn) {
					return { error: `Cannot convert from ${from} to ${to}.` };
				}

				return {
					original: `${value} ${from}`,
					converted: `${parseFloat(fn(value).toFixed(4))} ${to}`
				};
			}
		});
	}
}

/** Convenience: validated config + stack + tools in one call. */
export function createVercelAiAgentTools(
	config: AgentToolsConfig,
	logger: AgentToolsLogger
): VercelAiAgentTools {
	const stack = new DocumentRetrievalAndVisionStack(config, logger);
	return new VercelAiAgentTools(stack, logger);
}
