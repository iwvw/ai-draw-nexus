import { Hono } from 'hono'

function isWechatArticle(url: string): boolean {
  return url.includes('mp.weixin.qq.com')
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local')
  ) {
    return true
  }

  if (
    host === '::1' ||
    (host.includes(':') && (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')))
  ) {
    return true
  }

  const match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!match) return false

  const a = Number(match[1])
  const b = Number(match[2])

  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

function validateFetchableUrl(parsedUrl: URL): string | null {
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return '仅支持 http 和 https 链接'
  }
  if (parsedUrl.username || parsedUrl.password) {
    return '不支持包含账号密码的链接'
  }
  if (isPrivateHostname(parsedUrl.hostname)) {
    return '不支持访问私有网络链接'
  }
  return null
}

export const parseUrlRouter = new Hono()

parseUrlRouter.post('/', async (c) => {
  const { url } = await c.req.json().catch(() => ({})) as { url?: string }

  if (!url || typeof url !== 'string') {
    return c.json({ error: '请提供有效的URL' }, 400)
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return c.json({ error: 'URL格式无效' }, 400)
  }

  const urlError = validateFetchableUrl(parsedUrl)
  if (urlError) {
    return c.json({ error: urlError }, 400)
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

  const response = await fetch(parsedUrl.toString(), { headers, redirect: 'follow' })

  if (!response.ok) {
    return c.json({ error: `无法获取页面内容: ${response.status}` }, 502)
  }

  const html = await response.text()

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  const title = titleMatch ? titleMatch[1].trim() : parsedUrl.hostname

  let content = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (content.length > 10000) {
    content = content.substring(0, 10000) + '...'
  }

  const siteName = isWechat ? '微信公众号' : parsedUrl.hostname
  const fullMarkdown = `# ${title}\n\n> 来源: [${siteName}](${url})\n\n${content}`

  return c.json({
    success: true,
    data: {
      title: title,
      content: fullMarkdown,
      excerpt: content.substring(0, 200),
      siteName: siteName,
      url: url,
    },
  })
})
