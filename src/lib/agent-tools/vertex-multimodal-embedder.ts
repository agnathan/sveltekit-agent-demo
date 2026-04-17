import { PredictionServiceClient, helpers } from '@google-cloud/aiplatform';
import type { AgentToolsLogger } from './logger.js';

const DEFAULT_MULTIMODAL_MODEL_ID = 'multimodalembedding@001';

export class VertexMultimodalTextEmbedder {
	private readonly client: PredictionServiceClient;
	private readonly endpointPath: string;

	constructor(
		projectId: string,
		location: string,
		private readonly logger: AgentToolsLogger,
		modelId: string = DEFAULT_MULTIMODAL_MODEL_ID
	) {
		this.client = new PredictionServiceClient({ apiEndpoint: `${location}-aiplatform.googleapis.com` });
		this.endpointPath = `projects/${projectId}/locations/${location}/publishers/google/models/${modelId}`;
	}

	async embed(text: string): Promise<number[]> {
		this.logger.info('Embedding query text with Vertex multimodal model', { chars: text.length });
		const instanceValue = helpers.toValue({ text });
		if (!instanceValue) throw new Error('Failed to convert text instance to protobuf value');

		const [response] = await this.client.predict({
			endpoint: this.endpointPath,
			instances: [instanceValue]
		});

		const values = response.predictions?.[0]?.structValue?.fields?.textEmbedding?.listValue?.values;
		if (!values?.length) throw new Error('Vertex AI returned empty text embedding');
		this.logger.info('Embedding complete', { dimensions: values.length });
		return values.map((v) => (v as { numberValue?: number }).numberValue ?? 0);
	}
}
