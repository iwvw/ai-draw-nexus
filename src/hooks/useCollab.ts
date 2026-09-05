import { useEffect, useRef } from 'react'

interface UseCollabOptions<TMessage> {
  projectId: string
  onMessage: (data: TMessage) => void
}

const MAX_RECONNECT_MS = 30_000

export function useCollab<TMessage = unknown>({ projectId, onMessage }: UseCollabOptions<TMessage>) {
  const websocket = useRef<WebSocket | null>(null)
  const onMessageRef = useRef(onMessage)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptsRef = useRef(0)
  const disposedRef = useRef(false)

  useEffect(() => {
    onMessageRef.current = onMessage
  }, [onMessage])

  useEffect(() => {
    if (!projectId) {
      return
    }

    disposedRef.current = false
    attemptsRef.current = 0

    let ws: WebSocket | null = null

    const connect = () => {
      if (disposedRef.current) return

      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const url = new URL('/api/collab', location.href)
      url.protocol = protocol

      if (import.meta.env.DEV && location.port && location.port !== '8787') {
        url.hostname = location.hostname
        url.port = '8787'
      }

      url.searchParams.set('projectId', projectId)

      ws = new WebSocket(url.toString())
      websocket.current = ws

      ws.onopen = () => {
        attemptsRef.current = 0
      }

      ws.onmessage = event => {
        try {
          const data = JSON.parse(event.data) as TMessage
          onMessageRef.current(data)
        } catch (error) {
          console.warn('协作消息解析失败', error)
        }
      }

      ws.onerror = (err) => {
        console.warn('协作连接错误', err)
      }

      ws.onclose = () => {
        if (websocket.current === ws) {
          websocket.current = null
        }
        // 指数退避重连，避免断网/服务端重启后协作永久失效。
        if (disposedRef.current) return
        const delay = Math.min(1000 * 2 ** attemptsRef.current, MAX_RECONNECT_MS)
        attemptsRef.current += 1
        reconnectTimerRef.current = setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      disposedRef.current = true
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (websocket.current === ws) {
        websocket.current = null
      }
      ws?.close()
    }
  }, [projectId])

  const sendMessage = (data: unknown) => {
    if (websocket.current?.readyState === WebSocket.OPEN) {
      websocket.current.send(JSON.stringify(data))
    }
  }

  return { sendMessage }
}
