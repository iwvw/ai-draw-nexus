import { corsHeaders, handleCors } from './_shared/cors'

export const config = {
  runtime: 'edge',
}

function isWechatArticle(url: string): boolean {
  return url.includes('mp.weixin.qq.com')
}

export const onRequest = async (context: any) => {
  const request = context.request as Request
  // Handle CORS preflight
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { url } = await request.json() as { url: string }

    if (!url || typeof url !== 'string') {
      return new Response(JSON.stringify({ error: '请提供有效的URL' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      return new Response(JSON.stringify({ error: 'URL格式无效' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const isWechat = isWechatArticle(url)

    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    }

    if (isWechat) {
      headers['Referer'] = 'https://mp.weixin.qq.com/'
    }

    const response = await fetch(url, { headers, redirect: 'follow' })

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `无法获取页面内容: ${response.status}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const html = await response.text()

    // Simple extraction without linkedom/readability (Edge runtime compatible)
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title = titleMatch ? titleMatch[1].trim() : parsedUrl.hostname

    // Extract main content - simple approach
    // Remove scripts and styles
    let content = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    // Limit content length
    if (content.length > 10000) {
      content = content.substring(0, 10000) + '...'
    }

    const siteName = isWechat ? '微信公众号' : parsedUrl.hostname
    const fullMarkdown = `# ${title}\n\n> 来源: [${siteName}](${url})\n\n${content}`

    return new Response(JSON.stringify({
      success: true,
      data: {
        title: title,
        content: fullMarkdown,
        excerpt: content.substring(0, 200),
        siteName: siteName,
        url: url,
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Parse URL error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : '解析失败' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}
