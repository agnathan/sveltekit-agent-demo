import type { ToolSet } from 'ai';
import type { AgentToolContext } from './tool-context.js';
import { createDocumentTools } from './tools/document-tools.js';
import { createUtilityTools } from './tools/utility-tools.js';

export function createAllAgentTools(ctx: AgentToolContext) {
	const documentTools = createDocumentTools(ctx);
	const utilityTools = createUtilityTools();

	return {
		...documentTools,
		...utilityTools
	};
}

export function createChatAgentTools(ctx: AgentToolContext): ToolSet {
	const allTools = createAllAgentTools(ctx);

	return {
		VisualDocumentResearchAgent: allTools.VisualDocumentResearchAgent,
		calculator: allTools.calculator,
		unitConverter: allTools.unitConverter
	} satisfies ToolSet;
}
