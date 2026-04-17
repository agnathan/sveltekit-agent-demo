import type { BoundingBox, HighlightBox, TextItem } from './types.js';

export class DocumentMetadataParser {
	toNumber(value: unknown): number | null {
		if (typeof value === 'number' && Number.isFinite(value)) return value;
		if (typeof value === 'string') {
			const parsed = Number(value);
			if (Number.isFinite(parsed)) return parsed;
		}
		return null;
	}

	asBoundingBox(value: unknown): BoundingBox | null {
		if (!value) return null;

		if (typeof value === 'string') {
			try {
				return this.asBoundingBox(JSON.parse(value));
			} catch {
				return null;
			}
		}

		if (Array.isArray(value)) {
			if (value.length === 4) {
				const [xMin, xMax, yMin, yMax] = value.map((v) => this.toNumber(v));
				if (xMin != null && xMax != null && yMin != null && yMax != null) {
					return { xMin, xMax, yMin, yMax };
				}
			}
			for (const item of value) {
				const candidate = this.asBoundingBox(item);
				if (candidate) return candidate;
			}
			return null;
		}

		if (typeof value === 'object') {
			const obj = value as Record<string, unknown>;
			const xMin = this.toNumber(obj.xMin ?? obj.xmin ?? obj.left);
			const xMax = this.toNumber(obj.xMax ?? obj.xmax ?? obj.right);
			const yMin = this.toNumber(obj.yMin ?? obj.ymin ?? obj.top);
			const yMax = this.toNumber(obj.yMax ?? obj.ymax ?? obj.bottom);
			if (xMin != null && xMax != null && yMin != null && yMax != null) {
				return { xMin, xMax, yMin, yMax };
			}

			const x = this.toNumber(obj.x);
			const y = this.toNumber(obj.y);
			const w = this.toNumber(obj.w ?? obj.width);
			const h = this.toNumber(obj.h ?? obj.height);
			if (x != null && y != null && w != null && h != null && w > 0 && h > 0) {
				return { xMin: x, xMax: x + w, yMin: y, yMax: y + h };
			}
		}

		return null;
	}

	extractBoundingBox(meta: Record<string, unknown>): BoundingBox | null {
		const candidates: unknown[] = [
			meta.boundingBox,
			meta.bounding_box,
			meta.bbox,
			meta.box,
			meta.boundingBoxes,
			meta.bounding_boxes,
			meta.bboxes,
			meta.coordinates
		];
		for (const candidate of candidates) {
			const parsed = this.asBoundingBox(candidate);
			if (parsed) return parsed;
		}
		return this.asBoundingBox(meta);
	}

	extractTextItems(meta: Record<string, unknown>): TextItem[] {
		let raw = meta.textItems;

		if (typeof raw === 'string') {
			try {
				raw = JSON.parse(raw);
			} catch {
				return [];
			}
		}
		if (!Array.isArray(raw)) return [];

		return raw
			.map((item) => {
				if (!item || typeof item !== 'object') return null;
				const record = item as Record<string, unknown>;
				const text = (
					typeof record.text === 'string' ? record.text : typeof record.str === 'string' ? record.str : ''
				).trim();
				const boundingBox = this.asBoundingBox(
					record.boundingBox ?? record.bounding_box ?? record.bbox ?? record.box ?? record.coordinates ?? record
				);
				if (!text && !boundingBox) return null;
				return {
					text,
					boundingBox
				} satisfies TextItem;
			})
			.filter((item): item is TextItem => item !== null);
	}
}

export class RelevantTextHighlighter {
	findHighlightBoxes(
		relevantTexts: string[],
		pageContexts: Array<{
			pageNumber: number | null;
			textItems: TextItem[];
			imageUrl: string | null;
		}>
	): HighlightBox[] {
		const highlights: HighlightBox[] = [];
		const normalise = (s: string) => s.toLowerCase().replace(/[\s,]+/g, '');
		const normalised = relevantTexts.map(normalise).filter((t) => t.length > 0);

		for (const ctx of pageContexts) {
			for (const item of ctx.textItems) {
				if (!item.boundingBox || !item.text) continue;
				const normItem = normalise(item.text);
				if (normItem.length < 2) continue;

				const isExactMatch = normalised.some((nrt) => normItem === nrt);
				const isSubstringMatch =
					!isExactMatch && normItem.length >= 4 && normalised.some((nrt) => nrt.includes(normItem));

				if (isExactMatch || isSubstringMatch) {
					const box = item.boundingBox;
					highlights.push({
						x: box.xMin,
						y: box.yMin,
						w: box.xMax - box.xMin,
						h: box.yMax - box.yMin,
						text: item.text,
						pageNumber: ctx.pageNumber
					});
				}
			}
		}
		return highlights;
	}
}

export class StructuredVisionAnswerParser {
	parseStructuredAnswer(raw: string): { answer: string; relevantTexts: string[] } {
		const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*"answer"[\s\S]*\})/);
		if (jsonMatch) {
			try {
				const parsed = JSON.parse(jsonMatch[1]);
				return {
					answer: typeof parsed.answer === 'string' ? parsed.answer : raw,
					relevantTexts: Array.isArray(parsed.relevantTexts)
						? parsed.relevantTexts.filter((t: unknown) => typeof t === 'string' && t.trim())
						: []
				};
			} catch {
				/* fall through */
			}
		}
		return { answer: raw, relevantTexts: [] };
	}
}
