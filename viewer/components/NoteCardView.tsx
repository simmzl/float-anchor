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

function urlTransform(shareId: string) {
  return (url: string): string => {
    const m = url.match(/^fa-img:\/\/(.+)/)
    if (m) return `/api/image?id=${encodeURIComponent(shareId)}&name=${m[1]}`
    if (url.startsWith('fa://') || url.startsWith('fa:')) return '#'
    return url
  }
}

export default function NoteCardView({ card, shareId }: { card: Card; shareId: string }) {
  return (
    <div className="note-card" style={{ left: card.x, top: card.y, width: card.width, ...(card.height ? { height: card.height } : {}) }}>
      {card.title && <div className="card-header"><h3 className="card-title">{card.title}</h3></div>}
      <div className={`card-content markdown-body${card.title ? '' : ' no-title'}`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
          urlTransform={urlTransform(shareId)}
          components={{ a: ({ href, children }) => (href && (href.startsWith('fa://') || href === '#')) ? <span>{children}</span> : <a href={href} target="_blank" rel="noreferrer">{children}</a> }}
        >{card.content}</ReactMarkdown>
      </div>
    </div>
  )
}
