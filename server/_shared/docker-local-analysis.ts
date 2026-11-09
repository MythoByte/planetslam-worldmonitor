import { PLANETSLAM_LOCAL_ANALYSIS_ROUTES } from '../../src/shared/planetslam-local-panels';
// @ts-expect-error — JS module, no declaration file
import { validateApiKey } from '../../api/_api-key.js';

/** Operator opt-in only; client branding and headers cannot enable server capabilities. */
export function isDockerLocalAnalysisRoute(request: Request): boolean {
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  return process.env.LOCAL_API_MODE === 'docker'
    && process.env.PLANETSLAM_LOCAL_ANALYSIS === 'true'
    && Boolean(process.env.OPENROUTER_API_KEY || process.env.OLLAMA_API_URL)
    && PLANETSLAM_LOCAL_ANALYSIS_ROUTES[new URL(request.url).pathname] === method;
}

export async function isDockerLocalAnalysisSession(request: Request): Promise<boolean> {
  if (!isDockerLocalAnalysisRoute(request)) return false;
  const key = await validateApiKey(request);
  return key.valid && !key.required && key.kind === 'session';
}
