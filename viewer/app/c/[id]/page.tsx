'use client'
import { useEffect, useState } from 'react'
import type { Canvas } from '@/lib/types'
import CanvasRenderer from '@/components/CanvasRenderer'

export default function SharePage({ params }: { params: { id: string } }) {
  const [state, setState] = useState<{ canvas?: Canvas; error?: string; loading: boolean }>({ loading: true })
  useEffect(() => {
    fetch(`/api/canvas?id=${encodeURIComponent(params.id)}`)
      .then(async (r) => {
        if (r.status === 404) return setState({ loading: false, error: '链接无效或已取消分享' })
        if (!r.ok) return setState({ loading: false, error: '加载失败，请稍后重试' })
        const { canvas } = await r.json()
        setState({ loading: false, canvas })
      })
      .catch(() => setState({ loading: false, error: '加载失败' }))
  }, [params.id])

  if (state.loading) return <div className="viewer-center">加载中…</div>
  if (state.error) return <div className="viewer-center">{state.error}</div>
  return <CanvasRenderer canvas={state.canvas!} shareId={params.id} />
}
