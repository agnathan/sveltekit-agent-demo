/** Pluggable logging for agent tools (swap in Datadog, pino, etc. in other projects). */
export interface AgentToolsLogger {
	info(message: string, data?: Record<string, unknown>): void;
}

export type ConsoleAgentToolsLoggerOptions = {
	feedbackEnabled?: boolean;
};

export class ConsoleAgentToolsLogger implements AgentToolsLogger {
	constructor(private readonly options: ConsoleAgentToolsLoggerOptions = {}) {}

	info(message: string, data?: Record<string, unknown>): void {
		if (this.options.feedbackEnabled === false) return;
		const ts = new Date().toISOString();
		if (data && Object.keys(data).length > 0) {
			console.error(`[agent-feedback ${ts}] ${message}`, data);
			return;
		}
		console.error(`[agent-feedback ${ts}] ${message}`);
	}
}
