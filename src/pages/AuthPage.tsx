import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Banner, Button, Input, LayerCard } from '@cloudflare/kumo'
import { ArrowRightIcon, ShieldCheckIcon } from '@phosphor-icons/react'
import { useAuthStore } from '@/stores/authStore'

export function AuthPage() {
  const [isLogin, setIsLogin] = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const navigate = useNavigate()
  const setAuth = useAuthStore((state) => state.setAuth)
  const initialized = useAuthStore((state) => state.initialized)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)

    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register'
    const payload = { username, password }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || '认证失败，请检查账号信息')
        return
      }

      setAuth(data.user, data.token)

      navigate('/')
    } catch {
      setError('无法连接服务器，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center p-6">
      <LayerCard className="w-full max-w-md p-6">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-kumo-brand text-white">
                  <ShieldCheckIcon className="size-5" />
                </div>
                <h1 className="text-2xl font-semibold">{isLogin ? '登录' : '创建账号'}</h1>
                <p className="mt-1 text-sm text-kumo-subtle">
                  {isLogin
                    ? '登录后所有数据跟随账号保存到工作区数据库。'
                    : initialized
                      ? '创建账号即可加入工作区。'
                      : '第一个注册账号会自动成为工作区管理员。'}
                </p>
              </div>
              <Badge variant={isLogin ? 'neutral' : initialized ? 'blue' : 'purple'}>
                {isLogin ? '成员' : initialized ? '成员' : '初始化'}
              </Badge>
            </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <Input
            label="用户名"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="zhangsan"
            autoComplete="username"
            required
          />
          <Input
            label="密码"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="至少 6 个字符"
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            required
          />

          {error && <Banner variant="error" title="认证失败" description={error} size="sm" />}

          <Button className="w-full justify-center" variant="primary" type="submit" loading={loading}>
            {isLogin ? '登录' : '创建账号'}
            <ArrowRightIcon className="size-4" />
          </Button>
        </form>

        <div className="mt-5 border-t border-kumo-line pt-4 text-center text-sm">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="font-medium text-kumo-link hover:underline"
            onClick={() => {
              setIsLogin((value) => !value)
              setError(null)
            }}
          >
            {isLogin ? '没有账号？立即注册' : '已有账号？返回登录'}
          </Button>
        </div>
      </LayerCard>
    </div>
  )
}
