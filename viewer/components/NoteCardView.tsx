'use client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import type { Card } from '@/lib/types'

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    img: [...(defaultSchema.attributes?.img ?? []), 'src', 'alt', 'title', 'width', 'height'],
  },
}

// fa:// 卡片链接在只读分享里渲染为不可点文字
function urlTransform(url: string): string {
  if (url.startsWith('fa://') || url.startsWith('fa:')) return '#'
  return url
}

export default function NoteCardView({ card, shareId }: { card: Card; shareId: string }) {
  // 进 markdown 前把 fa-img://<name> 换成 /api/image?...（相对 URL，能过 rehype-sanitize；
  // 不依赖 urlTransform 与 sanitize 的执行时序——sanitize 会剥掉非 http(s) 协议的 src）
  const content = card.content.replace(
    /fa-img:\/\/([^)\s"'<>]+)/g,
    (_m, name) => `/api/image?id=${encodeURIComponent(shareId)}&name=${name}`,
  )
  return (
    <div className="note-card" style={{ left: card.x, top: card.y, width: card.width, ...(card.height ? { height: card.height } : {}) }}>
      {card.title && <div className="card-header"><h3 className="card-title">{card.title}</h3></div>}
      <div className={`card-content markdown-body${card.title ? '' : ' no-title'}`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
          urlTransform={urlTransform}
          components={{ a: ({ href, children }) => (href && (href.startsWith('fa://') || href === '#')) ? <span>{children}</span> : <a href={href} target="_blank" rel="noreferrer">{children}</a> }}
        >{content}</ReactMarkdown>
      </div>
    </div>
  )
}
