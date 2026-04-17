import { generateText } from 'ai';
import { createVertex } from '@ai-sdk/google-vertex';
import type { AgentToolsLogger } from './logger.js';
import { RelevantTextHighlighter, StructuredVisionAnswerParser } from './parsers.js';
import type { BoundingBox, HighlightBox, TextItem } from './types.js';

export type VisionPageContext = {
	pageNumber: number | null;
	pageText: string;
	imageUrl: string | null;
	boundingBox: BoundingBox | null;
	textItems: TextItem[];
	metadata: Record<string, unknown>;
};

export type VisionAnswerResult = {
	answer: string;
	usedImageUrls: string[];
	highlightBoxes: HighlightBox[];
	sources: Array<{
		pageNumber: number | null;
		imageUrl: string | null;
		boundingBox: BoundingBox | null;
		textItems: TextItem[];
		metadata: Record<string, unknown>;
	}>;
};

export class VertexVisionAnswerService {
	private readonly answerParser = new StructuredVisionAnswerParser();
	private readonly highlighter = new RelevantTextHighlighter();

	constructor(
		private readonly projectId: string,
		private readonly location: string,
		private readonly model: string,
		private readonly logger: AgentToolsLogger
	) {}

	async answer(question: string, imageUrls: string[], pageContexts: VisionPageContext[]): Promise<VisionAnswerResult> {
		this.logger.info('Preparing Vertex vision answer call', {
			imageUrlCount: imageUrls.length,
			contextCount: pageContexts.length
		});
		const vertex = createVertex({ project: this.projectId, location: this.location });
		const fetchedImages: Array<{ url: string; buffer: ArrayBuffer }> = [];
		for (const url of imageUrls) {
			this.logger.info('Fetching image for vision', { url });
			const res = await fetch(url);
			if (!res.ok) continue;
			fetchedImages.push({ url, buffer: await res.arrayBuffer() });
		}

		if (fetchedImages.length === 0) {
			this.logger.info('No images fetched successfully');
			return {
				answer: 'No images could be fetched from the Pinecone results.',
				usedImageUrls: [],
				highlightBoxes: [],
				sources: pageContexts.map((c) => ({
					pageNumber: c.pageNumber,
					imageUrl: c.imageUrl,
					boundingBox: c.boundingBox,
					textItems: c.textItems,
					metadata: c.metadata
				}))
			};
		}

		const imageParts = fetchedImages.map((entry) => ({ type: 'image' as const, image: entry.buffer }));

		const allTextItems = pageContexts.flatMap((c) => c.textItems.filter((item) => item.text && item.boundingBox));
		const textItemsList = allTextItems.map((item, i) => `[${i}] "${item.text}"`).join('\n');

		const contextText =
			pageContexts.length > 0
				? `\n\nRetrieved page text:\n${pageContexts
						.map((c) => {
							const bboxText = c.boundingBox
								? ` | Bounding box: [${c.boundingBox.xMin}, ${c.boundingBox.xMax}, ${c.boundingBox.yMin}, ${c.boundingBox.yMax}]`
								: '';
							const imageText = c.imageUrl ? ` | Image: ${c.imageUrl}` : '';
							return `[Page ${c.pageNumber ?? '?'}] ${c.pageText}${bboxText}${imageText}`;
						})
						.join('\n\n')}`
				: '';

		const textItemsContext =
			allTextItems.length > 0 ? `\n\nAvailable text items on the page:\n${textItemsList}` : '';

		const { text } = await generateText({
			model: vertex(this.model),
			messages: [
				{
					role: 'user',
					content: [
						{
							type: 'text',
							text:
								'You are a document QA assistant. Use the images and page text to answer the question.\n' +
								'Cite page numbers when possible.\n\n' +
								'IMPORTANT: Respond with a JSON block in this exact format:\n' +
								'```json\n' +
								'{\n' +
								'  "answer": "Your answer text here, with page citations.",\n' +
								'  "relevantTexts": ["exact text 1", "exact text 2"]\n' +
								'}\n' +
								'```\n' +
								'The "relevantTexts" array must contain the EXACT text strings from the document ' +
								'that directly contain or support the answer. Copy them verbatim from the text items list.' +
								contextText +
								textItemsContext +
								`\n\nQuestion: ${question}`
						},
						...imageParts
					]
				}
			]
		});

		const { answer, relevantTexts } = this.answerParser.parseStructuredAnswer(text);
		const highlightBoxes = this.highlighter.findHighlightBoxes(relevantTexts, pageContexts);
		this.logger.info('Vision model answer generated', {
			usedImages: fetchedImages.length,
			relevantTexts: relevantTexts.length,
			highlightBoxes: highlightBoxes.length
		});

		return {
			answer,
			usedImageUrls: fetchedImages.map((entry) => entry.url),
			highlightBoxes,
			sources: pageContexts.map((c) => ({
				pageNumber: c.pageNumber,
				imageUrl: c.imageUrl,
				boundingBox: c.boundingBox,
				textItems: c.textItems,
				metadata: c.metadata
			}))
		};
	}
}
