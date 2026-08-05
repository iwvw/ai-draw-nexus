import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { aiUsageMiddleware } from './middleware/ai-usage'
import { requireAuth, requireLoginIfLocked } from './middleware/auth'
import adminRouter from './routes/admin'
import apiRouter from './routes/api'
import authRouter from './routes/auth'
import chatRouter from './routes/chat'
import projectsRouter from './routes/projects'
import settingsRouter from './routes/settings'
import usageRouter from './routes/usage'
import versionsRouter from './routes/versions'
import { aiChatRouter, aiModelsRouter } from './routes/ai'
import { parseUrlRouter } from './routes/parse-url'
import { healthRouter } from './routes/health'
import { buildAiSystemPrompt } from './ai/system-prompt'

function requestBaseUrl(c: { req: { header: (name: string) => string | undefined } }): string {
  const proto = c.req.header('x-forwarded-proto') || 'http'
  const host = c.req.header('host')
  return host ? `${proto}://${host}` : ''
}

export function createApp() {
  const app = new Hono()

  app.use('*', logger())
  app.use('/api/*', cors())
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: 25 * 1024 * 1024,
      onError: (c) => c.text('请求体过大', 413),
    }),
  )

  app.use('/api/chat', requireAuth)
  app.use('/api/chat', aiUsageMiddleware)
  app.route('/api/chat', aiChatRouter)
  app.use('/api/models', requireAuth)
  app.route('/api/models', aiModelsRouter)
  app.use('/api/parse-url', requireAuth)
  app.route('/api/parse-url', parseUrlRouter)
  app.route('/api/health', healthRouter)

  app.route('/api/auth', authRouter)
  app.use('/api/*', requireLoginIfLocked)

  app.route('/api/projects', projectsRouter)
  app.route('/api/versions', versionsRouter)
  app.route('/api/v1', apiRouter)
  app.route('/api/chat/history', chatRouter)
  app.route('/api/settings', settingsRouter)
  app.route('/api/usage', usageRouter)
  app.route('/api/admin', adminRouter)

  // 公开：供外部 AI 工具自动获取系统提示词（纯文本，不含任何令牌）。
  app.get('/ai-prompt.txt', (c) => {
    const base = requestBaseUrl(c) || process.env.PUBLIC_BASE_URL || ''
    const text = buildAiSystemPrompt(base)
    c.header('content-type', 'text/plain; charset=utf-8')
    c.header('cache-control', 'no-store')
    return c.body(text)
  })

  app.use('/*', serveStatic({ root: './dist' }))
  app.get('*', serveStatic({ root: './dist', path: 'index.html' }))

  return app
}
