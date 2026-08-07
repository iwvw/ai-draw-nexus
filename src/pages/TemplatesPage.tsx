import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Dialog, Empty, Input, LayerCard, Select, Textarea } from '@cloudflare/kumo'
import {
  CheckIcon,
  CubeIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from '@phosphor-icons/react'
import { useAuthStore } from '@/stores/authStore'
import { useToast } from '@/hooks/useToast'
import { TemplateService } from '@/services/templateService'
import { engineBadgeVariant } from '@/constants'
import { formatDate } from '@/lib/utils'
import { ENGINES } from '@/constants'
import type { DiagramTemplate, EngineType, TemplateScope, TemplateType } from '@/types'

const SCOPE_LABEL: Record<string, string> = { system: '系统', workspace: '工作区', private: '我的' }
const TYPE_LABEL: Record<string, string> = { prompt: '提示词', skeleton: '骨架代码' }

interface FormState {
  id: string | null
  code: string
  name: string
  description: string
  type: TemplateType
  engineType: EngineType
  scope: TemplateScope
  content: string
}

const emptyForm: FormState = {
  id: null, code: '', name: '', description: '',
  type: 'prompt', engineType: 'drawio', scope: 'private', content: '',
}

export function TemplatesPage() {
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin'

  const [templates, setTemplates] = useState<DiagramTemplate[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [engineFilter, setEngineFilter] = useState<string>('')
  const [typeFilter, setTypeFilter] = useState<string>('')

  const { success: showSuccess, error: showError } = useToast()

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await TemplateService.list({
        engineType: engineFilter && engineFilter !== '__all' ? (engineFilter as EngineType) : undefined,
        type: typeFilter && typeFilter !== '__all' ? (typeFilter as TemplateType) : undefined,
      })
      setTemplates(data)
    } catch (err) {
      showError(err instanceof Error ? err.message : '模板加载失败')
    } finally {
      setIsLoading(false)
    }
  }, [engineFilter, typeFilter, showError])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setForm({ ...emptyForm, engineType: 'drawio' })
    setDialogOpen(true)
  }

  const openEdit = (t: DiagramTemplate) => {
    setForm({
      id: t.id, code: t.code, name: t.name, description: t.description,
      type: t.type, engineType: t.engineType, scope: t.scope, content: t.content,
    })
    setDialogOpen(true)
  }

  const canEdit = (t: DiagramTemplate) =>
    t.scope === 'private' || (t.scope === 'workspace' && isAdmin) || (t.scope === 'system' && isAdmin)

  const handleSave = async () => {
    if (!form.name.trim() || !form.content.trim()) {
      showError('名称和内容不能为空')
      return
    }
    setSubmitting(true)
    try {
      if (form.id) {
        await TemplateService.update(form.id, {
          name: form.name.trim(), description: form.description,
          type: form.type, content: form.content,
        })
        showSuccess('模板已更新')
      } else {
        await TemplateService.create({
          code: form.code.trim(), name: form.name.trim(), description: form.description,
          type: form.type, engineType: form.engineType, scope: form.scope, content: form.content,
        })
        showSuccess('模板已创建')
      }
      setDialogOpen(false)
      load()
    } catch (err) {
      showError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (t: DiagramTemplate) => {
    try {
      await TemplateService.delete(t.id)
      showSuccess('模板已删除')
      load()
    } catch (err) {
      showError(err instanceof Error ? err.message : '删除失败')
    }
  }

  return (
    <div className="px-5 py-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-kumo-default">模板</h1>
          <p className="mt-0.5 text-sm text-kumo-subtle">
            管理绘图模板，AI 生成时可引用编号（如在提示词写 <code>@T01</code>）。
          </p>
        </div>
        <Button variant="primary" icon={PlusIcon} onClick={openCreate}>
          新建模板
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={engineFilter} onValueChange={(v) => setEngineFilter(v ?? '')} className="w-36">
          <Select.Option value="__all">全部引擎</Select.Option>
          {ENGINES.map((e) => (
            <Select.Option key={e.value} value={e.value}>
              {e.label}
            </Select.Option>
          ))}
        </Select>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v ?? '')} className="w-36">
          <Select.Option value="__all">全部类型</Select.Option>
          <Select.Option value="prompt">提示词</Select.Option>
          <Select.Option value="skeleton">骨架代码</Select.Option>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex h-48 items-center justify-center text-kumo-subtle">加载中...</div>
      ) : templates.length === 0 ? (
        <LayerCard className="flex min-h-48 items-center justify-center p-8">
          <Empty
            icon={<CubeIcon className="size-8" />}
            title="还没有模板"
            description="创建模板，AI 生成时可快速复用。"
            contents={<Button variant="primary" icon={PlusIcon} onClick={openCreate}>新建模板</Button>}
          />
        </LayerCard>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <LayerCard key={t.id} className="flex flex-col gap-3">
              <LayerCard.Secondary className="justify-between">
                <span className="flex min-w-0 items-center gap-2">
                  <Badge variant="secondary">@{t.code}</Badge>
                  <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
                </span>
                <Badge variant={engineBadgeVariant(t.engineType)}>{t.engineType}</Badge>
              </LayerCard.Secondary>
              <LayerCard.Primary className="flex-1 flex-col items-start gap-2">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">{TYPE_LABEL[t.type]}</Badge>
                  <Badge variant="outline">{SCOPE_LABEL[t.scope]}</Badge>
                  <span className="ml-auto text-xs text-kumo-subtle">{formatDate(t.updatedAt)}</span>
                </div>
                <p className="line-clamp-3 text-sm text-kumo-subtle">{t.description || '（无描述）'}</p>
                {canEdit(t) && (
                  <div className="mt-1 flex gap-1">
                    <Button
                      aria-label="编辑"
                      shape="square" size="sm" variant="secondary" icon={PencilSimpleIcon}
                      onClick={() => openEdit(t)}
                    />
                    <Button
                      aria-label={confirmDeleteId === t.id ? '确认删除' : '删除'}
                      shape="square" size="sm"
                      variant={confirmDeleteId === t.id ? 'secondary-destructive' : 'secondary'}
                      icon={confirmDeleteId === t.id ? CheckIcon : TrashIcon}
                      onClick={() => {
                        if (confirmDeleteId === t.id) {
                          setConfirmDeleteId(null)
                          handleDelete(t)
                        } else {
                          setConfirmDeleteId(t.id)
                          setTimeout(() => setConfirmDeleteId((v) => (v === t.id ? null : v)), 3000)
                        }
                      }}
                    />
                  </div>
                )}
              </LayerCard.Primary>
            </LayerCard>
          ))}
        </div>
      )}

      <Dialog.Root open={dialogOpen} onOpenChange={(open) => !open && setDialogOpen(false)}>
        <Dialog size="lg" className="p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-semibold text-kumo-default">
                {form.id ? '编辑模板' : '新建模板'}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-kumo-subtle">
                编号是 AI 引用模板的标识，例如输入提示词 <code>@T02</code> 即可使用该模板。
              </Dialog.Description>
            </div>
            <Button aria-label="关闭" shape="square" size="sm" variant="ghost" icon={XIcon}
              onClick={() => setDialogOpen(false)} />
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Input label="编号" value={form.code} disabled={!!form.id} placeholder="如 T03" required
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
              <Input label="名称" value={form.name} placeholder="模板名称" required
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <Input label="描述" value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="说明该模板适用场景（可选）" />
            <div className="grid grid-cols-3 gap-3">
              <Select value={form.type} onValueChange={(v) => v && setForm((f) => ({ ...f, type: v as TemplateType }))}>
                <Select.Option value="prompt">提示词</Select.Option>
                <Select.Option value="skeleton">骨架代码</Select.Option>
              </Select>
              <Select value={form.engineType} onValueChange={(v) => v && setForm((f) => ({ ...f, engineType: v as EngineType }))}>
                {ENGINES.map((e) => (
                  <Select.Option key={e.value} value={e.value}>{e.label}</Select.Option>
                ))}
              </Select>
              <Select value={form.scope} disabled={!!form.id}
                onValueChange={(v) => v && setForm((f) => ({ ...f, scope: v as TemplateScope }))}>
                <Select.Option value="private">我的</Select.Option>
                {isAdmin && <Select.Option value="workspace">工作区</Select.Option>}
              </Select>
            </div>
            <Textarea label="模板内容" value={form.content} required rows={10}
              placeholder={form.type === 'skeleton' ? '粘贴图表骨架代码（drawio/mermaid/excalidraw）...' : '粘贴 AI 提示词要求...'}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} />
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button variant="primary" loading={submitting} onClick={handleSave}>保存</Button>
          </div>
        </Dialog>
      </Dialog.Root>
    </div>
  )
}