export function AsyncDiagramSurface({
  className,
  hasContent,
  loading,
  loadingText,
  emptyText,
  interactive = false,
  onClick,
  children,
}) {
  return (
    <div
      className={className}
      style={{ cursor: interactive ? 'zoom-in' : 'default' }}
      onClick={interactive ? onClick : undefined}
    >
      {children}
      {loading && !hasContent && (
        <div className="prd-diagram-surface__overlay">
          <div className="prd-diagram-surface__empty">{loadingText}</div>
        </div>
      )}
      {!loading && !hasContent && (
        <div className="prd-diagram-surface__overlay">
          <div className="prd-diagram-surface__empty">{emptyText}</div>
        </div>
      )}
      {loading && hasContent && (
        <div className="prd-diagram-surface__badge">更新中…</div>
      )}
    </div>
  );
}
