<!--
  Main chat page.

  Uses the Chat class from @ai-sdk/svelte, which automatically
  streams messages from the /api/chat endpoint. The Chat class
  manages conversation state, sends messages, and processes the
  streamed UI message format produced by streamText → toUIMessageStreamResponse.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { Chat } from '@ai-sdk/svelte';
	import type { DocumentAgentUIMessage } from '$lib/agent';
	import { renderMarkdown } from '$lib/renderMarkdown';

	const chat = new Chat<DocumentAgentUIMessage>({ messages: [] });

	let theme = $state<'light' | 'dark'>('light');

	onMount(() => {
		const t = document.documentElement.dataset.theme;
		if (t === 'light' || t === 'dark') theme = t;
	});

	function toggleTheme() {
		theme = theme === 'dark' ? 'light' : 'dark';
		document.documentElement.dataset.theme = theme;
		localStorage.setItem('theme', theme);
	}

	// Local state for the text input
	let inputValue = $state('');
	/** When true, POST body includes `useMapsForMessage` so the server uses only Vertex `googleMaps` (no mixed tools). */
	let useMapsForThisMessage = $state(false);

	function handleSubmit(e: Event) {
		e.preventDefault();
		const text = inputValue.trim();
		if (!text) return;

		chat.sendMessage(
			{ text },
			{ body: { useMapsForMessage: useMapsForThisMessage } }
		);
		inputValue = '';
	}

	// Example prompts users can click to try the agent's tools
	const examples = [
		"What's the weather in Tokyo?",
		'Calculate (12 + 8) * 3.5',
		'Convert 100 miles to kilometers',
		"What's the weather in London and Paris? Which is warmer?"
	];

	type HighlightBox = {
		x: number;
		y: number;
		w: number;
		h: number;
		text: string;
		pageNumber: number | null;
	};

	type HighlightPage = {
		imageUrl: string;
		boxes: HighlightBox[];
		pageWidth: number;
		pageHeight: number;
	};

	const PDF_PAGE_WIDTH = 792;
	const PDF_PAGE_HEIGHT = 612;

	function extractHighlightPages(result: Record<string, unknown>): HighlightPage[] {
		const boxes = result.highlightBoxes as HighlightBox[] | undefined;
		const imageUrls = result.usedImageUrls as string[] | undefined;
		if (!boxes?.length || !imageUrls?.length) return [];

		const pageWidth = (result.pageWidth as number) || PDF_PAGE_WIDTH;
		const pageHeight = (result.pageHeight as number) || PDF_PAGE_HEIGHT;

		const sources = (result.sources ?? []) as Array<{
			pageNumber: number | null;
			imageUrl: string | null;
		}>;
		const pageToImage = new Map<number, string>();
		for (const s of sources) {
			if (s.pageNumber != null && s.imageUrl) pageToImage.set(s.pageNumber, s.imageUrl);
		}

		const grouped = new Map<string, HighlightBox[]>();
		for (const box of boxes) {
			const img =
				(box.pageNumber != null ? pageToImage.get(box.pageNumber) : null) ?? imageUrls[0];
			let arr = grouped.get(img);
			if (!arr) {
				arr = [];
				grouped.set(img, arr);
			}
			arr.push(box);
		}

		return Array.from(grouped.entries()).map(([imageUrl, pageBoxes]) => ({
			imageUrl,
			boxes: pageBoxes,
			pageWidth,
			pageHeight
		}));
	}

	type AnswerToolResult = {
		highlightPages: HighlightPage[];
		pageImageMap: Map<number, string>;
		defaultImageUrl: string | null;
	};

	function normalizePageNumber(value: unknown): number | null {
		if (value == null) return null;
		if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
		if (typeof value === 'string') {
			const n = Number(value.trim());
			return Number.isFinite(n) ? Math.trunc(n) : null;
		}
		return null;
	}

	/** PDF page index from storage paths like .../image_pages/2.png */
	function pageNumberFromImageUrl(url: string): number | null {
		const m = url.match(/image_pages\/(\d+)\.(?:png|jpe?g|webp)/i);
		if (!m) return null;
		const n = Number(m[1]);
		return Number.isFinite(n) ? n : null;
	}

	function buildPageImageMap(result: Record<string, unknown>): Map<number, string> {
		const pageImageMap = new Map<number, string>();
		const imageUrls = (result.usedImageUrls as string[] | undefined) ?? [];
		const sources = (result.sources ?? []) as Array<{
			pageNumber: number | null | string;
			imageUrl: string | null;
		}>;

		function registerUrl(url: string | null | undefined) {
			if (!url) return;
			const fromPath = pageNumberFromImageUrl(url);
			if (fromPath != null) pageImageMap.set(fromPath, url);
		}

		for (const url of imageUrls) registerUrl(url);
		for (const s of sources) registerUrl(s.imageUrl);

		// Metadata pageNumber when path did not encode the page (or non-standard URLs)
		for (const s of sources) {
			const n = normalizePageNumber(s.pageNumber);
			if (n != null && s.imageUrl && !pageImageMap.has(n)) {
				pageImageMap.set(n, s.imageUrl);
			}
		}

		// Last resort only: Pinecone order is not PDF order, so avoid index→page mapping
		// unless we could not infer any page from URLs or metadata.
		if (pageImageMap.size === 0) {
			for (let i = 0; i < imageUrls.length; i++) {
				pageImageMap.set(i + 1, imageUrls[i]);
			}
		}

		return pageImageMap;
	}

	function getAnswerToolData(parts: Array<Record<string, unknown>>): AnswerToolResult {
		for (const part of parts) {
			const resultRecord = (() => {
				if (
					(part.type === 'tool-VisualDocumentResearchAgent' ||
						part.type === 'tool-answerFromImages') &&
					part.state === 'output-available' &&
					part.output &&
					typeof part.output === 'object'
				) {
					const out = part.output as Record<string, unknown>;
					if (typeof out.error === 'string' && out.error) return null;
					return out;
				}
				if (
					part.type === 'tool-invocation' &&
					part.state === 'result' &&
					part.toolInvocation &&
					typeof part.toolInvocation === 'object'
				) {
					const inv = part.toolInvocation as { toolName?: string; result?: unknown };
					if (
						inv.toolName !== 'VisualDocumentResearchAgent' &&
						inv.toolName !== 'answerFromImages'
					)
						return null;
					if (!inv.result || typeof inv.result !== 'object')
						return null;
					const out = inv.result as Record<string, unknown>;
					if (typeof out.error === 'string' && out.error) return null;
					return out;
				}
				return null;
			})();

			if (resultRecord) {
				const highlightPages = extractHighlightPages(resultRecord);
				const pageImageMap = buildPageImageMap(resultRecord);
				const defaultImageUrl = (resultRecord.usedImageUrls as string[] | undefined)?.[0] ?? null;
				return { highlightPages, pageImageMap, defaultImageUrl };
			}
		}
		return { highlightPages: [], pageImageMap: new Map(), defaultImageUrl: null };
	}

	/** Match `<thinking>...</thinking>` with flexible whitespace / case (model output varies). */
	const THINKING_TAG_RE = /<\s*thinking\s*>([\s\S]*?)<\s*\/\s*thinking\s*>/gi;

	function extractTaggedThinking(text: string): { prose: string; blocks: string[] } {
		const blocks: string[] = [];
		const prose = text.replace(THINKING_TAG_RE, (_, inner: string) => {
			const t = inner.trim();
			if (t) blocks.push(t);
			return '';
		});
		return { prose: prose.trim(), blocks };
	}

	/** Remove any remaining thinking blocks so they never appear twice in the main body. */
	function proseWithoutThinkingTags(text: string): string {
		return text.replace(THINKING_TAG_RE, '').trim();
	}

	type UnifiedToolPart = {
		name: string;
		state: string;
		isPending: boolean;
		isSuccess: boolean;
		isError: boolean;
		args: unknown;
		result: unknown;
		errorText: string | null;
	};

	function getToolRender(part: unknown): UnifiedToolPart | null {
		if (!part || typeof part !== 'object') return null;
		const p = part as Record<string, unknown>;
		const type = p.type;
		const state = typeof p.state === 'string' ? p.state : '';

		if (type === 'tool-invocation' && p.toolInvocation && typeof p.toolInvocation === 'object') {
			const inv = p.toolInvocation as { toolName?: string; args?: unknown; result?: unknown };
			const legacyState = state;
			return {
				name: inv.toolName ?? 'tool',
				state: legacyState,
				isPending: legacyState === 'call' || legacyState === 'partial-call',
				isSuccess: legacyState === 'result',
				isError: false,
				args: inv.args,
				result: inv.result,
				errorText: null
			};
		}

		if (type === 'dynamic-tool') {
			const name = typeof p.toolName === 'string' ? p.toolName : 'tool';
			return {
				name,
				state,
				isPending: state === 'input-streaming' || state === 'input-available',
				isSuccess: state === 'output-available',
				isError: state === 'output-error',
				args: p.input,
				result: p.output,
				errorText: typeof p.errorText === 'string' ? p.errorText : null
			};
		}

		if (typeof type === 'string' && type.startsWith('tool-')) {
			const name = type.slice('tool-'.length);
			return {
				name,
				state,
				isPending: state === 'input-streaming' || state === 'input-available',
				isSuccess: state === 'output-available',
				isError: state === 'output-error',
				args: p.input,
				result: p.output,
				errorText: typeof p.errorText === 'string' ? p.errorText : null
			};
		}

		return null;
	}

	/** User-facing label for tool ids (UIMessage `tool-*` names). */
	function toolDisplayName(toolId: string): string {
		switch (toolId) {
			case 'VisualDocumentResearchAgent':
			case 'answerFromImages':
				return 'Visual Document Research Agent';
			default:
				return toolId;
		}
	}

	/** Human-readable preview of partially streamed tool arguments (`input-streaming`). */
	function partialToolArgsPreview(toolName: string, args: unknown): string {
		if (args !== null && typeof args === 'object') {
			const o = args as Record<string, unknown>;
			if (
				(toolName === 'VisualDocumentResearchAgent' || toolName === 'answerFromImages') &&
				typeof o.question === 'string'
			) {
				const q = o.question.trim();
				return q.length > 140 ? `${q.slice(0, 140)}…` : q;
			}
			if (toolName === 'calculator') {
				const expr = o.expression ?? o.expr;
				if (typeof expr === 'string') return expr;
			}
			if (toolName === 'unitConverter') {
				const bits = [o.value, o.fromUnit, o.toUnit].filter(
					(x) => typeof x === 'number' || (typeof x === 'string' && x.length > 0)
				);
				if (bits.length) return bits.map(String).join(' ');
			}
			if (toolName === 'googleMaps') {
				const q = o.query ?? o.input ?? o.address;
				if (typeof q === 'string') return q.length > 140 ? `${q.slice(0, 140)}…` : q;
			}
		}
		try {
			const s = JSON.stringify(args ?? {});
			return s.length > 160 ? `${s.slice(0, 160)}…` : s;
		} catch {
			return '';
		}
	}

	function toolResultEmbeddedError(result: unknown): string | null {
		if (!result || typeof result !== 'object') return null;
		const e = (result as Record<string, unknown>).error;
		return typeof e === 'string' && e.length > 0 ? e : null;
	}

	function pageImageUrl(pageLabel: string, pageImageMap: Map<number, string>): string | null {
		// Prefer the last number so "Page 1-2" links to page 2's image when available.
		const nums = [...pageLabel.matchAll(/\d+/g)].map((m) => Number(m[0]));
		if (nums.length === 0) return null;
		const n = nums[nums.length - 1];
		return pageImageMap.get(n) ?? null;
	}

	type ParsedSource = {
		pageLabel: string | null;
		url: string | null;
		raw: string;
		displayText: string;
	};

	function parseAssistantTextWithSources(
		text: string
	): { bodyText: string; sources: ParsedSource[] } {
		const lines = text.split(/\r?\n/);
		const sourceHeaderRegex = /^\s*sources?\s*:\s*(.*)$/i;
		const sourceStartIndex = lines.findIndex((line) => sourceHeaderRegex.test(line));

		if (sourceStartIndex === -1) {
			return { bodyText: text, sources: [] };
		}

		const headerMatch = lines[sourceStartIndex].match(sourceHeaderRegex);
		const bodyText = lines
			.slice(0, sourceStartIndex)
			.join('\n')
			.trimEnd();

		const sourceLines = [headerMatch?.[1] ?? '', ...lines.slice(sourceStartIndex + 1)];

		const sources: ParsedSource[] = sourceLines
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => line.replace(/^[-*]\s+/, '').replace(/^\d+[.)]\s+/, '').trim())
			.filter(Boolean)
			.map((line) => {
				const pageMatch = line.match(
					/^(page|pages|p\.|pg\.)\s*([\d]+(?:\s*-\s*[\d]+)?)\s*[:\-,]\s*(.*)$/i
				);
				const pageLabel = pageMatch ? `Page ${pageMatch[2].replace(/\s+/g, '')}` : null;
				const content = pageMatch ? pageMatch[3].trim() : line;
				const urlMatch = content.match(/https?:\/\/[^\s)]+/i);
				const url = urlMatch ? urlMatch[0].replace(/[.,;:!?]+$/, '') : null;
				const displayText = /^image\s+https?:\/\/\S+/i.test(content)
					? 'Open page image'
					: content;

				return {
					pageLabel,
					url,
					raw: content,
					displayText
				};
			});

		return { bodyText, sources };
	}
</script>

<svelte:head>
	<title>Barebones AI Agent</title>
</svelte:head>

<main>
	<header>
		<button
			type="button"
			class="theme-toggle"
			onclick={toggleTheme}
			aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
		>
			{theme === 'dark' ? 'Light' : 'Dark'}
		</button>
		<h1>Barebones AI Agent</h1>
	</header>

	<!-- Example prompts -->
	{#if chat.messages.length === 0}
		<section class="examples">
			<p>Try one of these:</p>
			<div class="example-grid">
				{#each examples as example (example)}
					<button
						type="button"
						onclick={() => {
							chat.sendMessage({ text: example });
						}}
					>
						{example}
					</button>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Message list -->
	<section class="messages">
	{#each chat.messages as message (message.id)}
		{@const answerData = getAnswerToolData(message.parts as Array<Record<string, unknown>>)}
		<div class="message {message.role}">
			<span class="role-badge">
				{message.role === 'user' ? 'You' : 'Agent'}
			</span>

			{#each message.parts as part, index (index)}
				{@const toolUi = getToolRender(part)}
				{#if part.type === 'text'}
					{#if message.role === 'assistant'}
						{@const think = extractTaggedThinking(part.text)}
						{@const assistantVisibleProse = proseWithoutThinkingTags(think.prose)}
						{#if think.blocks.length}
							<div class="tagged-thinking-part">
								<details class="tagged-thinking-details">
									<summary>View agent thinking ({think.blocks.length})</summary>
									{#each think.blocks as block, bi (`${block.slice(0, 48)}-${bi}`)}
										<pre class="thinking-block">{block}</pre>
									{/each}
								</details>
							</div>
						{/if}
						{@const parsedContent = parseAssistantTextWithSources(assistantVisibleProse)}
						{#if parsedContent.sources.length > 0}
							{#if parsedContent.bodyText}
								<div class="text-part markdown-body">
									{@html renderMarkdown(parsedContent.bodyText)}
								</div>
							{/if}
							<section class="sources-card" aria-label="Sources">
								<div class="sources-title-row">
									<span class="sources-icon" aria-hidden="true"></span>
									<span>Sources</span>
								</div>
								<div class="sources-list">
									{#each parsedContent.sources as source, sourceIndex (`${source.raw}-${sourceIndex}`)}
										{@const imgUrl = source.pageLabel
											? pageImageUrl(source.pageLabel, answerData.pageImageMap)
											: null}
										{@const sourceHref =
											source.url ??
											imgUrl ??
											(source.raw.toLowerCase().includes('bounding box')
												? answerData.defaultImageUrl
												: null)}
										<div class="source-item">
											{#if source.pageLabel}
												{#if imgUrl}
													<a
														class="source-page-badge source-page-link"
														href={imgUrl}
														target="_blank"
														rel="noopener noreferrer"
													>
														{source.pageLabel}
													</a>
												{:else}
													<span class="source-page-badge">{source.pageLabel}</span>
												{/if}
											{/if}
											<span class="source-item-accent" aria-hidden="true">&#8599;</span>
											{#if sourceHref}
												<a
													class="source-raw source-text-link"
													href={sourceHref}
													target="_blank"
													rel="noopener noreferrer"
												>
													{source.displayText.trim() ? source.displayText : sourceHref}
												</a>
											{:else}
												<span class="source-raw">{source.raw}</span>
											{/if}
										</div>
									{/each}
								</div>
							</section>
						{:else if assistantVisibleProse}
							<div class="text-part markdown-body">
								{@html renderMarkdown(assistantVisibleProse)}
							</div>
						{/if}
					{:else}
						<p class="text-part">{part.text}</p>
					{/if}
				{:else if part.type === 'reasoning' && message.role !== 'user'}
					<div class="reasoning-part">
						<details>
							<summary>Model reasoning</summary>
							<pre>{part.text}</pre>
						</details>
					</div>
				{:else if toolUi}
					{@const embeddedErr = toolResultEmbeddedError(toolUi.result)}
					{@const streamingPreview =
						toolUi.isPending && toolUi.state === 'input-streaming'
							? partialToolArgsPreview(toolUi.name, toolUi.args)
							: ''}
					<div
						class="tool-part"
						class:tool-part--pending={toolUi.isPending}
						class:tool-part--success={toolUi.isSuccess && !toolUi.isError && !embeddedErr}
						class:tool-part--warn={toolUi.isSuccess && !!embeddedErr}
						class:tool-part--error={toolUi.isError}
					>
						{#if streamingPreview}
							<p class="tool-args-live" aria-live="polite">
								<span class="tool-args-live-label">Draft args</span>
								<span class="tool-args-live-text">{streamingPreview}</span>
							</p>
						{/if}
						<div class="tool-status-row">
							{#if toolUi.isPending}
								<span class="tool-spinner" aria-hidden="true"></span>
								<span class="tool-status-label"
									>Running <span class="tool-display-name">{toolDisplayName(toolUi.name)}</span>…</span>
								<span class="badge pending">{toolUi.state}</span>
							{:else if toolUi.isError}
								<span class="tool-status-label tool-status-label--error"
									>Tool failed: <span class="tool-display-name">{toolDisplayName(toolUi.name)}</span></span>
							{:else if embeddedErr}
								<span class="tool-status-label tool-status-label--warn">Completed with error</span>
								<span class="badge pending">check result</span>
							{:else}
								<span class="tool-status-label tool-status-label--ok"
									><span class="tool-display-name">{toolDisplayName(toolUi.name)}</span> finished</span>
								<span class="badge done">done</span>
							{/if}
						</div>

						<details
							class="tool-nested-details"
							open={toolUi.state === 'input-streaming' || toolUi.state === 'input-available'}
						>
							<summary>Arguments</summary>
							<pre class="tool-json">{JSON.stringify(toolUi.args ?? {}, null, 2)}</pre>
						</details>

						{#if toolUi.isSuccess || toolUi.isError}
							<details class="tool-nested-details" open={toolUi.isError || !!embeddedErr}>
								<summary>{toolUi.isError ? 'Error detail' : 'Result'}</summary>
								{#if toolUi.isError && toolUi.errorText}
									<pre class="tool-json tool-json--error">{toolUi.errorText}</pre>
								{:else if embeddedErr}
									<pre class="tool-json tool-json--error">{embeddedErr}</pre>
									<pre class="tool-json">{JSON.stringify(toolUi.result, null, 2)}</pre>
								{:else}
									<pre class="tool-json">{JSON.stringify(toolUi.result, null, 2)}</pre>
								{/if}
							</details>
						{/if}
					</div>
				{/if}
			{/each}

			{#if message.role === 'assistant'}
				{#each answerData.highlightPages as page, pageIdx (`${page.imageUrl}-${pageIdx}`)}
						<div class="highlight-viewer">
							<div class="highlight-image-container">
								<img
									src={page.imageUrl}
									alt="PDF page with highlighted answer"
									class="highlight-image"
								/>
								<svg
									class="highlight-svg"
									viewBox="0 0 {page.pageWidth} {page.pageHeight}"
									preserveAspectRatio="none"
								>
									{#each page.boxes as box, i (`${box.x}-${box.y}-${i}`)}
										<rect
											x={box.x}
											y={page.pageHeight - box.y - box.h}
											width={box.w}
											height={box.h}
											class="highlight-rect"
										/>
									{/each}
								</svg>
							</div>
							<div class="highlight-legend">
								<span class="highlight-swatch"></span>
								<span>{page.boxes.length} region{page.boxes.length === 1 ? '' : 's'} highlighted</span>
							</div>
						</div>
					{/each}
				{/if}
			</div>
		{/each}

		<!-- Streaming indicator -->
		{#if chat.status === 'streaming'}
			<div class="streaming-indicator">Agent is thinking…</div>
		{/if}
	</section>

	<!-- Input form -->
	<form onsubmit={handleSubmit}>
		<div class="composer-row">
			<input
				type="text"
				bind:value={inputValue}
				placeholder="Ask about weather, math, or unit conversions…"
				disabled={chat.status === 'streaming'}
			/>
			<button type="submit" disabled={chat.status === 'streaming'}>
				Send
			</button>
		</div>
		<label class="maps-flag">
			<input
				type="checkbox"
				bind:checked={useMapsForThisMessage}
				disabled={chat.status === 'streaming'}
			/>
			Use Google Maps grounding for this message
		</label>
	</form>
</main>

<style>
	:global(html) {
		color-scheme: light;
		--bg: #fafafa;
		--surface: #ffffff;
		--text: #222222;
		--text-muted: #666666;
		--text-subtle: #888888;
		--border: #dddddd;
		--border-hover: #888888;
		--user-bubble: #e7f0ff;
		--assistant-bubble: #ffffff;
		--assistant-border: #eeeeee;
		--tool-accent: #c4b5fd;
		--code-bg: #f0ecff;
		--pre-bg: #f5f5f5;
		--pill-bg: #ffffff;
		--btn-primary-bg: #111111;
		--btn-primary-fg: #ffffff;
		--input-bg: #ffffff;
		--badge-pending-bg: #fef3c7;
		--badge-pending-fg: #92400e;
		--badge-done-bg: #d1fae5;
		--badge-done-fg: #065f46;
		--sources-card-bg: linear-gradient(
			145deg,
			rgba(90, 129, 255, 0.08),
			rgba(255, 255, 255, 0.92)
		);
		--sources-card-border: rgba(79, 112, 224, 0.28);
		--sources-title-bg: rgba(255, 255, 255, 0.7);
		--sources-title-fg: #2f4276;
		--sources-item-bg: rgba(255, 255, 255, 0.78);
		--sources-item-border: rgba(79, 112, 224, 0.2);
		--sources-item-hover-border: rgba(58, 92, 204, 0.48);
		--sources-link: #2345a8;
		--sources-link-hover: #112f7e;
		--sources-badge-bg: rgba(41, 92, 209, 0.14);
		--sources-badge-fg: #1d3f96;
		--sources-raw: #4b5678;
		--sources-accent-bg: rgba(79, 112, 224, 0.14);
		--sources-accent-fg: #2953bd;
	}

	:global(html[data-theme='dark']) {
		color-scheme: dark;
		--bg: #12121a;
		--surface: #1a1a24;
		--text: #e8e8ed;
		--text-muted: #a0a0b0;
		--text-subtle: #7a7a8a;
		--border: #2e2e3d;
		--border-hover: #6e6e82;
		--user-bubble: #1e3a5f;
		--assistant-bubble: #1a1a24;
		--assistant-border: #2e2e3d;
		--tool-accent: #8b7fd8;
		--code-bg: #2a2540;
		--pre-bg: #0f0f14;
		--pill-bg: #23232f;
		--btn-primary-bg: #e8e8ed;
		--btn-primary-fg: #12121a;
		--input-bg: #1a1a24;
		--badge-pending-bg: #422006;
		--badge-pending-fg: #fcd34d;
		--badge-done-bg: #064e3b;
		--badge-done-fg: #6ee7b7;
		--sources-card-bg: linear-gradient(
			150deg,
			rgba(82, 125, 255, 0.16),
			rgba(36, 44, 65, 0.85)
		);
		--sources-card-border: rgba(113, 143, 245, 0.36);
		--sources-title-bg: rgba(24, 30, 46, 0.64);
		--sources-title-fg: #d9e4ff;
		--sources-item-bg: rgba(21, 28, 43, 0.66);
		--sources-item-border: rgba(114, 145, 249, 0.28);
		--sources-item-hover-border: rgba(143, 170, 255, 0.62);
		--sources-link: #b4ccff;
		--sources-link-hover: #e5efff;
		--sources-badge-bg: rgba(149, 176, 255, 0.2);
		--sources-badge-fg: #e5efff;
		--sources-raw: #bbc7e7;
		--sources-accent-bg: rgba(149, 176, 255, 0.22);
		--sources-accent-fg: #d8e5ff;
	}

	:global(body) {
		margin: 0;
		font-family: system-ui, -apple-system, sans-serif;
		background: var(--bg);
		color: var(--text);
		transition: background-color 0.2s ease, color 0.2s ease;
	}

	main {
		max-width: min(1600px, calc(100vw - 1rem));
		margin: 0 auto;
		padding: 2rem clamp(0.75rem, 2vw, 1.5rem);
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		min-height: 100dvh;
		box-sizing: border-box;
	}

	header {
		position: relative;
		text-align: center;
		margin-bottom: 1.5rem;
		padding-top: 0.25rem;
	}
	@media (max-width: 520px) {
		.theme-toggle {
			position: static;
			display: inline-flex;
			margin-bottom: 0.75rem;
		}
	}
	.theme-toggle {
		position: absolute;
		top: 0;
		right: 0;
		padding: 0.35rem 0.65rem;
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		background: var(--surface);
		color: var(--text);
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
	}
	.theme-toggle:hover {
		border-color: var(--border-hover);
	}
	header h1 {
		margin: 0 0 0.25rem;
		font-size: 1.5rem;
	}
	/* Example prompt buttons */
	.examples {
		margin-bottom: 1.5rem;
	}
	.examples p {
		margin: 0 0 0.5rem;
		font-size: 0.85rem;
		color: var(--text-subtle);
	}
	.example-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.example-grid button {
		padding: 0.4rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--pill-bg);
		color: var(--text);
		font-size: 0.8rem;
		cursor: pointer;
		transition: border-color 0.15s;
	}
	.example-grid button:hover {
		border-color: var(--border-hover);
	}

	/* Messages: own scrollport so long threads (tables, PDF previews) never sit under the composer */
	.messages {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior-y: contain;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-bottom: 0.75rem;
		padding-bottom: 0.5rem;
	}
	.message {
		padding: 0.75rem 1rem;
		border-radius: 0.5rem;
	}
	.message.user {
		background: var(--user-bubble);
		align-self: flex-end;
		max-width: min(90%, 34rem);
	}
	.message.assistant {
		background: var(--assistant-bubble);
		border: 1px solid var(--assistant-border);
		align-self: flex-start;
		width: 100%;
		max-width: 100%;
		box-sizing: border-box;
	}
	.role-badge {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		color: var(--text-subtle);
	}
	.text-part {
		margin: 0.25rem 0 0;
		line-height: 1.5;
		white-space: pre-wrap;
	}
	/* Rendered markdown (GFM tables, lists, etc.) */
	.markdown-body {
		white-space: normal;
		overflow-x: auto;
		max-width: 100%;
	}
	.markdown-body :global(p) {
		margin: 0.35rem 0 0;
	}
	.markdown-body :global(p:first-child) {
		margin-top: 0;
	}
	.markdown-body :global(h1),
	.markdown-body :global(h2),
	.markdown-body :global(h3) {
		margin: 0.65rem 0 0.35rem;
		font-size: 1.05rem;
		line-height: 1.35;
	}
	.markdown-body :global(ul),
	.markdown-body :global(ol) {
		margin: 0.35rem 0;
		padding-left: 1.35rem;
	}
	.markdown-body :global(table) {
		border-collapse: collapse;
		font-size: 0.78rem;
		margin: 0.5rem 0;
		width: max-content;
		max-width: 100%;
	}
	.markdown-body :global(th),
	.markdown-body :global(td) {
		border: 1px solid var(--border);
		padding: 0.35rem 0.45rem;
		text-align: left;
		vertical-align: top;
		word-break: break-word;
	}
	.markdown-body :global(th) {
		background: var(--pre-bg);
		font-weight: 600;
	}
	.markdown-body :global(code) {
		background: var(--code-bg);
		padding: 0.12rem 0.28rem;
		border-radius: 3px;
		font-size: 0.85em;
	}
	.markdown-body :global(pre) {
		background: var(--pre-bg);
		padding: 0.55rem;
		border-radius: 6px;
		overflow-x: auto;
		font-size: 0.78rem;
		margin: 0.45rem 0;
	}
	.markdown-body :global(pre code) {
		background: transparent;
		padding: 0;
	}
	.markdown-body :global(a) {
		color: var(--sources-link);
		word-break: break-word;
	}
	.markdown-body :global(blockquote) {
		margin: 0.4rem 0;
		padding-left: 0.65rem;
		border-left: 3px solid var(--border);
		color: var(--text-muted);
	}
	.sources-card {
		margin-top: 0.65rem;
		padding: 0.7rem;
		border-radius: 0.9rem;
		background: var(--sources-card-bg);
		border: 1px solid var(--sources-card-border);
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 8px 20px rgba(9, 17, 44, 0.06);
	}
	.sources-title-row {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		width: fit-content;
		padding: 0.25rem 0.55rem;
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		background: var(--sources-title-bg);
		color: var(--sources-title-fg);
		border: 1px solid var(--sources-item-border);
	}
	.sources-icon {
		width: 0.72rem;
		height: 0.72rem;
		border-radius: 999px;
		background: radial-gradient(circle at 35% 35%, #ffffff, #6e91ff 72%);
		box-shadow: 0 0 0 1px rgba(52, 88, 196, 0.24);
	}
	.sources-list {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}
	.source-item {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding: 0.45rem 0.58rem;
		border-radius: 0.7rem;
		background: var(--sources-item-bg);
		border: 1px solid var(--sources-item-border);
		transition: border-color 0.15s ease, transform 0.15s ease, background-color 0.15s ease;
	}
	.source-item:hover {
		border-color: var(--sources-item-hover-border);
		transform: translateY(-1px);
	}
	.source-item-accent {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.2rem;
		height: 1.2rem;
		border-radius: 999px;
		background: var(--sources-accent-bg);
		color: var(--sources-accent-fg);
		font-size: 0.68rem;
		font-weight: 700;
		line-height: 1;
	}
	.source-page-badge {
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		padding: 0.2rem 0.5rem;
		border-radius: 999px;
		background: var(--sources-badge-bg);
		color: var(--sources-badge-fg);
		border: 1px solid var(--sources-item-border);
		white-space: nowrap;
	}
	a.source-page-link {
		text-decoration: none;
		cursor: pointer;
		transition: background-color 0.15s, border-color 0.15s, transform 0.1s;
	}
	a.source-page-link:hover {
		background: var(--sources-item-hover-border);
		color: #fff;
		border-color: var(--sources-item-hover-border);
		transform: translateY(-1px);
	}
	.source-link {
		color: var(--sources-link);
		text-decoration: none;
		font-size: 0.79rem;
		line-height: 1.35;
		word-break: break-word;
	}
	.source-link:hover {
		color: var(--sources-link-hover);
		text-decoration: underline;
		text-decoration-thickness: 1.5px;
		text-underline-offset: 2px;
	}
	.source-raw {
		color: var(--sources-raw);
		font-size: 0.79rem;
		line-height: 1.35;
		flex: 1 1 14rem;
		min-width: 0;
		overflow-wrap: anywhere;
		word-break: break-word;
	}
	a.source-text-link {
		color: var(--sources-link);
		font-size: 0.79rem;
		line-height: 1.35;
		text-decoration: none;
		display: inline;
		overflow-wrap: anywhere;
		word-break: break-word;
		hyphens: auto;
	}
	a.source-text-link:hover {
		color: var(--sources-link-hover);
		text-decoration: underline;
		text-decoration-thickness: 1.5px;
		text-underline-offset: 2px;
	}
	.reasoning-part {
		margin-top: 0.5rem;
		border-left: 3px solid var(--border);
		padding-left: 0.75rem;
	}
	.reasoning-part summary {
		cursor: pointer;
		font-size: 0.85rem;
		color: var(--text-muted);
	}
	.reasoning-part pre {
		background: var(--pre-bg);
		padding: 0.5rem;
		border-radius: 4px;
		overflow-x: auto;
		font-size: 0.75rem;
		color: var(--text);
		margin: 0.4rem 0 0;
		white-space: pre-wrap;
	}

	/* Tool invocation display */
	.tool-args-live {
		margin: 0 0 0.45rem;
		padding: 0.45rem 0.55rem;
		border-radius: 6px;
		background: var(--code-bg);
		border: 1px dashed var(--border);
		font-size: 0.8rem;
		line-height: 1.35;
	}
	.tool-args-live-label {
		display: block;
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
		margin-bottom: 0.2rem;
	}
	.tool-args-live-text {
		color: var(--text);
		word-break: break-word;
	}
	.tool-part {
		margin-top: 0.5rem;
		border-left: 3px solid var(--tool-accent);
		padding-left: 0.75rem;
	}
	.tool-part summary {
		cursor: pointer;
		font-size: 0.85rem;
	}
	.tool-display-name {
		font-weight: 600;
		color: var(--text);
	}
	.thinking-summary {
		color: var(--text-muted);
	}
	.thinking-tool-name {
		opacity: 0.8;
	}
	.tool-detail {
		margin-top: 0.3rem;
		font-size: 0.8rem;
	}
	.tool-detail pre {
		background: var(--pre-bg);
		padding: 0.5rem;
		border-radius: 4px;
		overflow-x: auto;
		font-size: 0.75rem;
		color: var(--text);
	}
	.badge {
		font-size: 0.65rem;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		margin-left: 0.3rem;
		vertical-align: middle;
	}
	.badge.pending {
		background: var(--badge-pending-bg);
		color: var(--badge-pending-fg);
	}
	.badge.done {
		background: var(--badge-done-bg);
		color: var(--badge-done-fg);
	}

	.tagged-thinking-part {
		margin: 0.35rem 0 0.5rem;
	}
	.tagged-thinking-details summary {
		cursor: pointer;
		font-size: 0.82rem;
		color: var(--text-muted);
		font-weight: 600;
	}
	.thinking-block {
		background: var(--code-bg);
		padding: 0.5rem;
		border-radius: 6px;
		font-size: 0.75rem;
		white-space: pre-wrap;
		margin: 0.35rem 0 0;
		border: 1px solid var(--border);
		color: var(--text-muted);
	}

	.tool-status-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.35rem 0.5rem;
		font-size: 0.85rem;
		color: var(--text-muted);
	}
	.tool-spinner {
		width: 14px;
		height: 14px;
		border: 2px solid var(--border);
		border-top-color: var(--sources-link);
		border-radius: 50%;
		animation: tool-spin 0.85s linear infinite;
		flex-shrink: 0;
	}
	@keyframes tool-spin {
		to {
			transform: rotate(360deg);
		}
	}
	.tool-status-label--ok {
		color: var(--badge-done-fg);
		font-weight: 600;
	}
	.tool-status-label--warn {
		color: var(--badge-pending-fg);
		font-weight: 600;
	}
	.tool-status-label--error {
		color: #b91c1c;
		font-weight: 600;
	}
	.tool-part--pending {
		border-left-color: #60a5fa;
	}
	.tool-part--success {
		border-left-color: #34d399;
	}
	.tool-part--warn {
		border-left-color: #f59e0b;
	}
	.tool-part--error {
		border-left-color: #f87171;
	}
	.tool-nested-details {
		margin-top: 0.4rem;
	}
	.tool-nested-details summary {
		cursor: pointer;
		font-size: 0.78rem;
		color: var(--text-subtle);
	}
	.tool-json {
		background: var(--pre-bg);
		padding: 0.45rem;
		border-radius: 4px;
		overflow-x: auto;
		font-size: 0.72rem;
		margin: 0.3rem 0 0;
		white-space: pre-wrap;
		color: var(--text);
	}
	.tool-json--error {
		color: #b91c1c;
		margin-bottom: 0.35rem;
	}

	/* Highlight overlay on PDF page images */
	.highlight-viewer {
		margin-top: 0.75rem;
		border-radius: 0.65rem;
		overflow: hidden;
		border: 1px solid var(--sources-card-border);
		background: var(--surface);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
	}
	.highlight-image-container {
		position: relative;
		line-height: 0;
	}
	.highlight-image {
		width: 100%;
		height: auto;
		display: block;
	}
	.highlight-svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
	.highlight-rect {
		fill: rgba(255, 200, 0, 0.32);
		stroke: rgba(230, 140, 0, 0.95);
		stroke-width: 2;
		rx: 3;
		ry: 3;
	}
	.highlight-legend {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 0.7rem;
		font-size: 0.75rem;
		color: var(--text-muted);
		background: var(--surface);
		border-top: 1px solid var(--border);
	}
	.highlight-swatch {
		display: inline-block;
		width: 12px;
		height: 12px;
		border-radius: 2px;
		background: rgba(255, 200, 0, 0.5);
		border: 1.5px solid rgba(230, 140, 0, 0.95);
	}

	.streaming-indicator {
		font-size: 0.8rem;
		color: var(--text-subtle);
		padding: 0.25rem 0;
		animation: pulse 1.5s ease-in-out infinite;
	}
	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}

	/* Input form — in document flow below the scrollable thread (no overlap) */
	form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		flex-shrink: 0;
		background: var(--bg);
		padding-top: 0.5rem;
		padding-bottom: max(0.25rem, env(safe-area-inset-bottom, 0px));
	}
	.composer-row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.maps-flag {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.82rem;
		color: var(--text-muted);
		cursor: pointer;
		user-select: none;
	}
	.maps-flag input {
		width: 1rem;
		height: 1rem;
		accent-color: var(--btn-primary-bg);
		cursor: pointer;
	}
	.maps-flag:has(input:disabled) {
		opacity: 0.6;
		cursor: default;
	}
	form .composer-row input[type='text'] {
		flex: 1;
		padding: 0.65rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		font-size: 0.9rem;
		outline: none;
		transition: border-color 0.15s;
		background: var(--input-bg);
		color: var(--text);
	}
	form .composer-row input[type='text']:focus {
		border-color: var(--border-hover);
	}
	form button {
		padding: 0.65rem 1.25rem;
		border: none;
		border-radius: 0.5rem;
		background: var(--btn-primary-bg);
		color: var(--btn-primary-fg);
		font-size: 0.9rem;
		cursor: pointer;
	}
	form button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
