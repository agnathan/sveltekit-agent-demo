import DOMPurify from 'isomorphic-dompurify';
import { marked } from 'marked';

marked.setOptions({
	gfm: true,
	breaks: false
});

/**
 * Turn assistant markdown (including GFM tables) into sanitized HTML for `{@html ...}`.
 */
export function renderMarkdown(markdown: string): string {
	const trimmed = markdown.trim();
	if (!trimmed) return '';

	const raw = marked.parse(trimmed, { async: false }) as string;
	return DOMPurify.sanitize(raw);
}
