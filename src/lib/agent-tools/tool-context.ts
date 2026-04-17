import type { DocumentRetrievalAndVisionStack } from './document-stack.js';
import type { AgentToolsLogger } from './logger.js';

export type AgentToolContext = {
	stack: DocumentRetrievalAndVisionStack;
	logger: AgentToolsLogger;
};
