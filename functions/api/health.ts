import { corsHeaders, handleCors } from './_shared/cors'

export const config = {
  runtime: 'edge',
}

export default async function handler(request: Request) {
  // Handle CORS preflight
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse

  return new Response(JSON.stringify({ status: 'ok' }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
