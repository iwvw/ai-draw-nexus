import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, Mail, Lock, User as UserIcon, ArrowRight } from 'lucide-react'
import { Button, Input, Card } from '@/components/ui'
import { useAuthStore } from '@/stores/authStore'

export function AuthPage() {
  const [isLogin, setIsLogin] = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const navigate = useNavigate()
  const setAuth = useAuthStore(state => state.setAuth)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register'
    const payload = isLogin ? { username, password } : { username, password, name }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const data = await res.json()

      if (res.ok) {
        setAuth(data.user, data.token)
        navigate('/')
      } else {
        setError(data.error || '认证失败，请检查您的凭据')
      }
    } catch (err) {
      setError('无法连接到服务器，请稍后再试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 sm:p-6 lg:p-8">
      {/* Background decoration */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-[10%] -top-[10%] h-[40%] w-[40%] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute -right-[10%] -bottom-[10%] h-[40%] w-[40%] rounded-full bg-primary/5 blur-[120px]" />
      </div>

      <Card className="w-full max-w-md overflow-hidden border-border bg-surface/40 p-8 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in duration-500">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-surface shadow-lg shadow-primary/20">
            <Sparkles className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">
            {isLogin ? '欢迎回来' : '开启您的创作'}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {isLogin ? '登录以管理您的云端项目' : '注册账号，随时随地同步作品'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {!isLogin && (
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                姓名
              </label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="您的姓名"
                  className="pl-10"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none">用户名</label>
            <div className="relative">
              <UserIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="请输入用户名"
                className="pl-10"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none">密码</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="password"
                placeholder="••••••••"
                className="pl-10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive animate-in slide-in-from-top-2">
              {error}
            </div>
          )}

          <Button 
            type="submit" 
            className="w-full h-11 text-base font-semibold transition-all hover:translate-y-[-1px] active:translate-y-0"
            disabled={loading}
          >
            {loading ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-surface border-t-transparent" />
            ) : (
              <>
                {isLogin ? '登录' : '创建账号'}
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </form>

        <div className="mt-8 text-center text-sm">
          <span className="text-muted-foreground">
            {isLogin ? '还没有账号？' : '已经有账号了？'}
          </span>
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="ml-1 font-semibold text-primary hover:underline underline-offset-4 focus:outline-none"
          >
            {isLogin ? '点击注册' : '点击登录'}
          </button>
        </div>
      </Card>
    </div>
  )
}
