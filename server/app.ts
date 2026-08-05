import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { aiUsageMiddleware } from './middleware/ai-usage'
import { requireAuth, requireLoginIfLocked } from './middleware/auth'
import adminRouter from './routes/admin'
import authRouter from './routes/auth'
import chatRouter from './routes/chat'
import projectsRouter from './routes/projects'
import settingsRouter from './routes/settings'
import usageRouter from './routes/usage'
import versionsRouter from './routes/versions'
import { aiChatRouter, aiModelsRouter } from './routes/ai'
import { parseUrlRouter } from './routes/parse-url'
import { healthRouter } from './routes/health'

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
  app.route('/api/chat/history', chatRouter)
  app.route('/api/settings', settingsRouter)
  app.route('/api/usage', usageRouter)
  app.route('/api/admin', adminRouter)

  app.use('/*', serveStatic({ root: './dist' }))
  app.get('*', serveStatic({ root: './dist', path: 'index.html' }))

  return app
}
