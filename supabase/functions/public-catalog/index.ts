import { handlePublicRead } from '../_shared/handler.ts';

Deno.serve((req) => handlePublicRead(req, 'public_catalog'));
