/** Shared types for document retrieval and vision QA tools (framework-agnostic). */

export type BoundingBox = {
	xMin: number;
	xMax: number;
	yMin: number;
	yMax: number;
};

export type TextItem = {
	text: string;
	boundingBox: BoundingBox | null;
};

export type HighlightBox = {
	x: number;
	y: number;
	w: number;
	h: number;
	text: string;
	pageNumber: number | null;
};

export type PineconeMatch = {
	pageNumber: number | null;
	imageUrl: string | null;
	pageText: string;
	boundingBox: BoundingBox | null;
	textItems: TextItem[];
	metadata: Record<string, unknown>;
	score: number | null;
};

export type PineconeQueryResult = {
	query: string;
	indexName: string;
	namespace: string;
	matches: PineconeMatch[];
	imageUrls: string[];
	pageContexts: Array<{
		pageNumber: number | null;
		pageText: string;
		imageUrl: string | null;
		boundingBox: BoundingBox | null;
		textItems: TextItem[];
		metadata: Record<string, unknown>;
	}>;
};

/** Runtime configuration for Pinecone + Vertex-backed agent tools (no framework imports). */
export type AgentToolsConfig = {
	pineconeApiKey: string;
	googleProjectId: string;
	/** Vertex region, e.g. `us-central1` (already normalized if you use `normalizeGoogleVertexLocation`). */
	googleLocation: string;
	pineconeIndexName: string;
	pineconeNamespace: string;
	topK: number;
	visionModel: string;
	/** When set and not absolute, resolved against `credentialsResolveCwd` on first stack init. */
	googleApplicationCredentials?: string | undefined;
	/** Defaults to `process.cwd()` when resolving relative credential paths. */
	credentialsResolveCwd?: string;
	multimodalEmbeddingModelId?: string;
	/** Log informational / feedback lines (default true). */
	feedbackEnabled?: boolean;
	/** When true, log full Pinecone JSON to stderr (default false). */
	verboseRetrievalLogging?: boolean;
};
