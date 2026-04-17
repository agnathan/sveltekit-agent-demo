export type AgentToolsDebugPayload = {
	runId: string;
	hypothesisId: string;
	location: string;
	message: string;
	data: Record<string, unknown>;
};

/** Pluggable logging for agent tools (swap in Datadog, pino, etc. in other projects). */
export interface AgentToolsLogger {
	info(message: string, data?: Record<string, unknown>): void;
	debug?(payload: AgentToolsDebugPayload): void;
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

	debug(_payload: AgentToolsDebugPayload): void {
		/* default: no remote ingest */
	}
}

/** Forwards debug events to a local ingest endpoint (optional dev tooling). */
export class RemoteDebugAgentToolsLogger implements AgentToolsLogger {
	constructor(
		private readonly inner: AgentToolsLogger,
		private readonly ingestUrl: string,
		private readonly sessionId: string
	) {}

	info(message: string, data?: Record<string, unknown>): void {
		this.inner.info(message, data);
	}

	debug(payload: AgentToolsDebugPayload): void {
		fetch(this.ingestUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Debug-Session-Id': this.sessionId
			},
			body: JSON.stringify({
				sessionId: this.sessionId,
				runId: payload.runId,
				hypothesisId: payload.hypothesisId,
				location: payload.location,
				message: payload.message,
				data: payload.data,
				timestamp: Date.now()
			})
		}).catch(() => {});
	}
}
