import { createServiceClient } from './supabase.ts';
import { errorResponse, handleOptions, jsonResponse } from './http.ts';

const SLUG_RE = /^[a-z0-9-]{1,63}$/;

export async function handlePublicRead(
  req: Request,
  rpc: 'public_context' | 'public_catalog'
): Promise<Response> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return handleOptions(origin);
  if (req.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Method not allowed', 405, false, origin);
  }

  const slug = new URL(req.url).searchParams.get('slug')?.trim() ?? '';
  if (!SLUG_RE.test(slug)) {
    return errorResponse('INVALID_INPUT', 'Invalid slug', 400, false, origin);
  }

  try {
    const sb = createServiceClient();
    const { data, error } = await sb.rpc(rpc, { p_slug: slug });
    if (error) throw error;

    const payload = data as Record<string, unknown>;
    if (
      'error' in payload &&
      (payload.error as { code?: string })?.code === 'PUBLIC_RESOURCE_NOT_FOUND'
    ) {
      return errorResponse(
        'PUBLIC_RESOURCE_NOT_FOUND',
        'Resource not found',
        404,
        false,
        origin
      );
    }

    return jsonResponse(payload, 200, origin);
  } catch (err) {
    console.error(`${rpc} error`, err);
    return errorResponse('INTERNAL_ERROR', 'Internal error', 500, false, origin);
  }
}
