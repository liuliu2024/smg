import { readFile } from 'node:fs/promises';
import path from 'node:path';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    return new Response(await readFile(path.join(process.cwd(), 'public/index.html')), {headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
  } catch { return new Response('Portal is not built yet', {status:503}); }
}
