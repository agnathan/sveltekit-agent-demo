import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './renderMarkdown.js';

describe('renderMarkdown', () => {
	it('returns empty string for whitespace-only input', () => {
		expect(renderMarkdown('   \n\t  ')).toBe('');
	});

	it('renders inline markdown to sanitized HTML', () => {
		const html = renderMarkdown('Hello **world**');
		expect(html).toContain('Hello');
		expect(html).toContain('world');
		expect(html).toContain('<strong>');
	});
});
