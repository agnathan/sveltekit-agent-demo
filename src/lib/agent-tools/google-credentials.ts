import path from 'node:path';

export function normalizeGoogleVertexLocation(raw: string | undefined): string {
	const loc = (raw || '').trim();
	if (!loc || loc === 'global') return 'us-central1';
	return loc;
}

/**
 * Resolves relative `GOOGLE_APPLICATION_CREDENTIALS` once against a working directory.
 */
export class GoogleCredentialsEnvNormalizer {
	private resolved = false;

	resolve(cwd: string, rawPath: string | undefined): void {
		if (this.resolved) return;
		if (rawPath && !path.isAbsolute(rawPath)) {
			process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(cwd, rawPath);
		}
		this.resolved = true;
	}
}
