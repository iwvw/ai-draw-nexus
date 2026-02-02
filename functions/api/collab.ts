import { corsHeaders, handleCors } from './_shared/cors'

export const config = {
  runtime: 'edge',
}

export default async function handler(request: Request) {
  // Handle CORS preflight
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse

  // WebSocket collaboration is not supported on Vercel
  // Vercel serverless functions don't support WebSocket connections
  return new Response(
    JSON.stringify({
      error: 'Collaboration feature is not available on Vercel deployment',
      message: 'WebSocket connections are not supported in Vercel serverless functions. Use Cloudflare deployment for collaboration features.',
    }),
    {
      status: 501,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  )
}
