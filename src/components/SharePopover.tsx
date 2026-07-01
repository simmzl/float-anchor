interface Props {
  url: string
  onCopy: () => void
  onOpen: () => void
  onUnshare: () => void
  onClose: () => void
}

export default function SharePopover({ url, onCopy, onOpen, onUnshare, onClose }: Props) {
  return (
    <div className="share-popover-backdrop" onMouseDown={onClose}>
      <div className="share-popover" onMouseDown={(e) => e.stopPropagation()}>
        <div className="share-popover-title">分享链接</div>
        <div className="share-popover-url" title={url}>{url}</div>
        <div className="share-popover-actions">
          <button onClick={onCopy}>复制链接</button>
          <button onClick={onOpen}>在浏览器打开</button>
          <button className="danger" onClick={onUnshare}>取消分享</button>
        </div>
        <div className="share-popover-hint">任何拿到此链接的人都能只读查看该画布。</div>
      </div>
    </div>
  )
}
