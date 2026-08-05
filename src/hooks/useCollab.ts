import { useEffect, useRef } from 'react'

interface UseCollabOptions<TMessage> {
  projectId: string
  onMessage: (data: TMessage) => void
}

export function useCollab<TMessage = unknown>({ projectId, onMessage }: UseCollabOptions<TMessage>) {
  const websocket = useRef<WebSocket | null>(null)
  const onMessageRef = useRef(onMessage)

  useEffect(() => {
    onMessageRef.current = onMessage
  }, [onMessage])

  useEffect(() => {
    if (!projectId) {
      return
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = new URL('/api/collab', location.href)
    url.protocol = protocol

    if (import.meta.env.DEV && location.port && location.port !== '8787') {
      url.hostname = location.hostname
      url.port = '8787'
    }

    url.searchParams.set('projectId', projectId)

    const ws = new WebSocket(url.toString())

    ws.onmessage = event => {
      try {
        const data = JSON.parse(event.data) as TMessage
        onMessageRef.current(data)
      } catch (error) {
        console.warn('协作消息解析失败', error)
      }
    }

    ws.onclose = () => {
      if (websocket.current === ws) {
        websocket.current = null
      }
    }

    ws.onerror = () => {}

    websocket.current = ws

    return () => {
      if (websocket.current === ws) {
        websocket.current = null
      }
      ws.close()
    }
  }, [projectId])

  const sendMessage = (data: unknown) => {
    if (websocket.current?.readyState === WebSocket.OPEN) {
      websocket.current.send(JSON.stringify(data))
    }
  }

  return { sendMessage }
}
