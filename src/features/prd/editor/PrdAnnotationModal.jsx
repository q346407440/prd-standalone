import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_IGNORE_TAGS, createRegionDraft, relabelRegions } from './prd-annotations.js';

const HANDLE_NAMES = ['nw', 'ne', 'sw', 'se'];
const COLUMN_LABELS = {
  interaction: '交互',
  logic: '逻辑',
};
const CHANGE_TYPE_OPTIONS = [
  {
    value: 'new_feature',
    label: '全新功能',
    hint: '适用于整页、整模块或完整功能链路都是全新建设的场景。',
  },
  {
    value: 'page_addition',
    label: '原页新增',
    hint: '适用于在现有页面或现有模块上新增按钮、字段、入口或局部流程。',
  },
  {
    value: 'iterate',
    label: '功能迭代',
    hint: '适用于已有功能做调整、补充或增强，页面可能有变化，也可能只改逻辑。',
  },
  {
    value: 'existing',
    label: '沿用现状',
    hint: '适用于本次该区域不做改动，继续保持当前交互和逻辑。',
  },
];

function clampRect(rect, maxWidth, maxHeight) {
  const x = Math.max(0, Math.min(maxWidth - 1, rect.x));
  const y = Math.max(0, Math.min(maxHeight - 1, rect.y));
  const w = Math.max(1, Math.min(maxWidth - x, rect.w));
  const h = Math.max(1, Math.min(maxHeight - y, rect.h));
  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
  };
}

function rectFromPoints(a, b, maxWidth, maxHeight) {
  const left = Math.max(0, Math.min(a.x, b.x));
  const top = Math.max(0, Math.min(a.y, b.y));
  const right = Math.min(maxWidth, Math.max(a.x, b.x));
  const bottom = Math.min(maxHeight, Math.max(a.y, b.y));
  return clampRect({
    x: left,
    y: top,
    w: Math.max(1, right - left),
    h: Math.max(1, bottom - top),
  }, maxWidth, maxHeight);
}

function updateRectByHandle(rect, handle, point, maxWidth, maxHeight) {
  const left = rect.x;
  const right = rect.x + rect.w;
  const top = rect.y;
  const bottom = rect.y + rect.h;
  const next = { left, right, top, bottom };
  if (handle.includes('n')) next.top = point.y;
  if (handle.includes('s')) next.bottom = point.y;
  if (handle.includes('w')) next.left = point.x;
  if (handle.includes('e')) next.right = point.x;
  const normalized = rectFromPoints(
    { x: next.left, y: next.top },
    { x: next.right, y: next.bottom },
    maxWidth,
    maxHeight,
  );
  return normalized;
}

function toNaturalPoint(event, stageRect, naturalWidth, naturalHeight) {
  const x = ((event.clientX - stageRect.left) / stageRect.width) * naturalWidth;
  const y = ((event.clientY - stageRect.top) / stageRect.height) * naturalHeight;
  return {
    x: Math.max(0, Math.min(naturalWidth, x)),
    y: Math.max(0, Math.min(naturalHeight, y)),
  };
}

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName;
  return target.isContentEditable
    || tagName === 'INPUT'
    || tagName === 'TEXTAREA'
    || tagName === 'SELECT'
    || tagName === 'BUTTON';
}

function UsageForm({ usage, onChange }) {
  return (
    <section className="prd-annotation-modal__usage-card">
      <div className="prd-annotation-modal__usage-head">
        <div className="prd-annotation-modal__usage-head-main">
          <strong className="prd-annotation-modal__usage-title">图片属性</strong>
          <span className="prd-annotation-modal__usage-info" tabIndex={0} aria-label="查看图片属性说明">
            ?
            <span className="prd-annotation-modal__usage-tooltip">
              开启后，这张图会被标记为迭代前参考图，便于后续生成时对比本次方案改了什么。
            </span>
          </span>
        </div>
        <span className="prd-annotation-modal__usage-tip">作用于整张图</span>
      </div>
      <div className="prd-annotation-modal__setting-row">
        <span className="prd-annotation-modal__setting-label">图稿阶段</span>
        <button
          type="button"
          className={`prd-annotation-modal__switch ${usage?.isBeforeIteration ? 'is-on' : ''}`}
          onClick={() => onChange({ isBeforeIteration: !usage?.isBeforeIteration })}
          aria-pressed={Boolean(usage?.isBeforeIteration)}
        >
          <span className="prd-annotation-modal__switch-track">
            <span className="prd-annotation-modal__switch-thumb" />
          </span>
          <span className="prd-annotation-modal__switch-text">
            {usage?.isBeforeIteration ? '作为迭代前示意图' : '作为当前方案图'}
          </span>
        </button>
      </div>
    </section>
  );
}

function RegionForm({
  region,
  onChange,
  onDelete,
  className,
}) {
  if (!region) {
    return (
      <div className={['prd-annotation-modal__form', className].filter(Boolean).join(' ')}>
        <div className="prd-annotation-modal__empty">先在图片上框选一个区域，或从上方区域标签中选择。</div>
      </div>
    );
  }

  const toggleGenerateColumn = (column) => {
    const current = new Set(region.generateColumns || []);
    if (current.has(column)) current.delete(column);
    else current.add(column);
    const next = [...current];
    onChange({ generateColumns: next.length ? next : ['interaction'] });
  };

  const toggleIgnoreTag = (tag) => {
    const current = new Set(region.ignoreTags || []);
    if (current.has(tag)) current.delete(tag);
    else current.add(tag);
    onChange({ ignoreTags: [...current] });
  };

  const generationColumns = region.generateColumns || [];

  return (
    <div className={['prd-annotation-modal__form', className].filter(Boolean).join(' ')}>
      <section className="prd-annotation-modal__form-card">
        <div className="prd-annotation-modal__region-header">
          <span className="prd-annotation-modal__region-index">{region.label}</span>
          <button type="button" className="prd-annotation-modal__delete-btn" onClick={onDelete} aria-label="删除区域">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>
        </div>

        <div className="prd-annotation-modal__inline-row">
          <div className="prd-annotation-modal__setting-row">
            <span className="prd-annotation-modal__setting-label">参与生成</span>
            <button
              type="button"
              className={`prd-annotation-modal__switch ${region.inScope ? 'is-on' : ''}`}
              onClick={() => onChange({ inScope: !region.inScope })}
              aria-pressed={region.inScope}
            >
              <span className="prd-annotation-modal__switch-track">
                <span className="prd-annotation-modal__switch-thumb" />
              </span>
              <span className="prd-annotation-modal__switch-text">
                {region.inScope ? '纳入生成' : '已排除'}
              </span>
            </button>
          </div>

          <div className="prd-annotation-modal__setting-row">
            <span className="prd-annotation-modal__setting-label">生成列</span>
            <div className="prd-annotation-modal__seg-group prd-annotation-modal__seg-group--two">
              {['interaction', 'logic'].map((column) => {
                const active = generationColumns.includes(column);
                return (
                  <button
                    key={column}
                    type="button"
                    className={`prd-annotation-modal__check-btn ${active ? 'is-checked' : ''}`}
                    onClick={() => toggleGenerateColumn(column)}
                    aria-pressed={active}
                  >
                    <span className="prd-annotation-modal__check-icon">{active ? '✓' : ''}</span>
                    {COLUMN_LABELS[column]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="prd-annotation-modal__setting-row">
            <span className="prd-annotation-modal__setting-label">变更类型</span>
            <div className="prd-annotation-modal__seg-group prd-annotation-modal__seg-group--four">
              {CHANGE_TYPE_OPTIONS.map(({ value, label, hint }) => (
                <button
                  key={value}
                  type="button"
                  className={`prd-annotation-modal__seg-btn ${region.changeType === value ? 'is-active' : ''}`}
                  onClick={() => onChange({ changeType: value })}
                  data-tooltip={hint}
                  aria-label={`${label}：${hint}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <details className="prd-annotation-modal__advanced prd-annotation-modal__advanced--secondary">
        <summary>更多设置（非必填）</summary>
        <div className="prd-annotation-modal__field">
          <label>区域 ID</label>
          <div className="prd-annotation-modal__readonly-value">{region.regionId}</div>
        </div>
        <div className="prd-annotation-modal__field">
          <label>忽略项</label>
          <div className="prd-annotation-modal__tag-grid">
            {DEFAULT_IGNORE_TAGS.map((tag) => (
              <label key={tag}>
                <input
                  type="checkbox"
                  checked={region.ignoreTags.includes(tag)}
                  onChange={() => toggleIgnoreTag(tag)}
                />
                {tag}
              </label>
            ))}
          </div>
        </div>
        <div className="prd-annotation-modal__field">
          <label>补充备注</label>
          <textarea value={region.note} onChange={(e) => onChange({ note: e.target.value })} rows={4} />
        </div>
      </details>
    </div>
  );
}

export function PrdAnnotationModal({
  open,
  usage,
  imageSrc,
  regions,
  settings,
  onClose,
  onSave,
}) {
  const stageRef = useRef(null);
  const [draftUsage, setDraftUsage] = useState(() => ({ ...usage, isBeforeIteration: Boolean(usage?.isBeforeIteration) }));
  const [draftRegions, setDraftRegions] = useState(() => relabelRegions(regions || []));
  const [selectedRegionId, setSelectedRegionId] = useState(() => relabelRegions(regions || [])[0]?.regionId ?? null);
  const [imageInfo, setImageInfo] = useState({ naturalWidth: 0, naturalHeight: 0 });
  const [spacePressed, setSpacePressed] = useState(false);
  const [panning, setPanning] = useState(false);
  const dragStateRef = useRef(null);
  const spacePressedRef = useRef(false);

  function beginPan(event) {
    const stage = stageRef.current;
    if (!stage) return;
    event.preventDefault();
    dragStateRef.current = {
      mode: 'pan',
      anchorClientX: event.clientX,
      anchorClientY: event.clientY,
      originScrollLeft: stage.scrollLeft,
      originScrollTop: stage.scrollTop,
    };
    setPanning(true);
  }

  useEffect(() => {
    if (!open) return;
    setDraftUsage({ ...usage, isBeforeIteration: Boolean(usage?.isBeforeIteration) });
    const nextRegions = relabelRegions(regions || []);
    setDraftRegions(nextRegions);
    setSelectedRegionId((current) => (
      nextRegions.some((region) => region.regionId === current)
        ? current
        : nextRegions[0]?.regionId ?? null
    ));
  }, [open, regions, usage?.usageId]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const { body } = document;
    const prevOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = prevOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onMouseMove = (event) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      if (drag.mode === 'pan') {
        const stage = stageRef.current;
        if (!stage) return;
        stage.scrollLeft = drag.originScrollLeft - (event.clientX - drag.anchorClientX);
        stage.scrollTop = drag.originScrollTop - (event.clientY - drag.anchorClientY);
        return;
      }
      const stageRect = stageRef.current?.getBoundingClientRect();
      if (!stageRect || !imageInfo.naturalWidth || !imageInfo.naturalHeight) return;
      const point = toNaturalPoint(event, stageRect, imageInfo.naturalWidth, imageInfo.naturalHeight);
      setDraftRegions((prev) => prev.map((region) => {
        if (region.regionId !== drag.regionId) return region;
        if (drag.mode === 'draw') {
          return {
            ...region,
            bbox: rectFromPoints(drag.anchor, point, imageInfo.naturalWidth, imageInfo.naturalHeight),
          };
        }
        if (drag.mode === 'move') {
          return {
            ...region,
            bbox: clampRect({
              x: drag.originRect.x + (point.x - drag.anchor.x),
              y: drag.originRect.y + (point.y - drag.anchor.y),
              w: drag.originRect.w,
              h: drag.originRect.h,
            }, imageInfo.naturalWidth, imageInfo.naturalHeight),
          };
        }
        if (drag.mode === 'resize') {
          return {
            ...region,
            bbox: updateRectByHandle(
              drag.originRect,
              drag.handle,
              point,
              imageInfo.naturalWidth,
              imageInfo.naturalHeight,
            ),
          };
        }
        return region;
      }));
    };
    const onMouseUp = () => {
      dragStateRef.current = null;
      setPanning(false);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [imageInfo.naturalHeight, imageInfo.naturalWidth, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.code !== 'Space' || isTypingTarget(event.target)) return;
      event.preventDefault();
      spacePressedRef.current = true;
      setSpacePressed(true);
    };
    const onKeyUp = (event) => {
      if (event.code !== 'Space') return;
      spacePressedRef.current = false;
      setSpacePressed(false);
      if (dragStateRef.current?.mode === 'pan') {
        dragStateRef.current = null;
        setPanning(false);
      }
    };
    const onWindowBlur = () => {
      spacePressedRef.current = false;
      setSpacePressed(false);
      dragStateRef.current = null;
      setPanning(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onNativeWheel = (event) => {
      if (!spacePressedRef.current) return;
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const withinStage = (
        event.clientX >= rect.left
        && event.clientX <= rect.right
        && event.clientY >= rect.top
        && event.clientY <= rect.bottom
      );
      if (!withinStage) return;
      event.preventDefault();
      event.stopPropagation();
      stage.scrollLeft += event.deltaX;
      stage.scrollTop += event.deltaY;
    };
    window.addEventListener('wheel', onNativeWheel, { passive: false });
    return () => {
      window.removeEventListener('wheel', onNativeWheel);
    };
  }, [open]);

  const selectedRegion = useMemo(
    () => draftRegions.find((region) => region.regionId === selectedRegionId) || null,
    [draftRegions, selectedRegionId],
  );

  function handleStageMouseDown(event) {
    if (!stageRef.current) return;
    if (spacePressed) {
      beginPan(event);
      return;
    }
    if (!imageInfo.naturalWidth || !imageInfo.naturalHeight) return;
    if (event.target.closest('[data-region-box]')) return;
    const stageRect = stageRef.current.getBoundingClientRect();
    const point = toNaturalPoint(event, stageRect, imageInfo.naturalWidth, imageInfo.naturalHeight);
    const region = createRegionDraft(usage.usageId, draftRegions, settings);
    region.bbox = { x: Math.round(point.x), y: Math.round(point.y), w: 1, h: 1 };
    setDraftRegions((prev) => relabelRegions([...prev, region]));
    setSelectedRegionId(region.regionId);
    dragStateRef.current = {
      mode: 'draw',
      regionId: region.regionId,
      anchor: point,
    };
  }

  function handleRegionPatch(patch) {
    setDraftRegions((prev) => prev.map((region) => {
      if (region.regionId !== selectedRegionId) return region;
      const next = {
        ...region,
        ...patch,
        bbox: patch.bbox ? { ...region.bbox, ...patch.bbox } : region.bbox,
        outputHints: patch.outputHints
          ? {
            interaction: {
              ...(region.outputHints?.interaction || {}),
              ...(patch.outputHints.interaction || {}),
            },
            logic: {
              ...(region.outputHints?.logic || {}),
              ...(patch.outputHints.logic || {}),
            },
          }
          : region.outputHints,
      };
      if (!patch.outputHints && patch.title != null) {
        next.outputHints = {
          interaction: {
            ...(next.outputHints?.interaction || {}),
            groupTitle: next.outputHints?.interaction?.groupTitle || patch.title,
          },
          logic: {
            ...(next.outputHints?.logic || {}),
            groupTitle: next.outputHints?.logic?.groupTitle || patch.title,
          },
        };
      }
      return next;
    }));
  }

  function handleRegionDelete(regionId = selectedRegionId) {
    if (!regionId) return;
    setDraftRegions((prev) => {
      const index = prev.findIndex((region) => region.regionId === regionId);
      const remaining = relabelRegions(prev.filter((region) => region.regionId !== regionId));
      setSelectedRegionId((current) => {
        if (current !== regionId) return current;
        return remaining[index]?.regionId ?? remaining[index - 1]?.regionId ?? null;
      });
      return remaining;
    });
  }

  if (!open || !usage) return null;

  return createPortal(
    <div className="prd-annotation-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="prd-annotation-modal__dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="prd-annotation-modal__header">
          <div>
            <strong>图片标注</strong>
            <div className="prd-annotation-modal__sub">
              {usage.sectionTitle || '未命名章节'} · {usage.rowKey}
            </div>
          </div>
          <div className="prd-annotation-modal__header-actions">
            <button type="button" className="prd-action-btn" onClick={onClose}>取消</button>
            <button
              type="button"
              className="prd-action-btn"
              onClick={() => onSave(draftRegions, imageInfo, { isBeforeIteration: draftUsage.isBeforeIteration })}
            >
              保存标注
            </button>
          </div>
        </div>

        <div className="prd-annotation-modal__body">
          <div className="prd-annotation-modal__stage-wrap">
            <div className="prd-annotation-modal__hint">在图片空白处拖拽即可新增区域，拖动已有区域可移动，拖拽角点可缩放；按住空格后可拖动或双指滚动平移长图。</div>
            <div
              ref={stageRef}
              className={[
                'prd-annotation-modal__stage',
                spacePressed ? 'is-pan-ready' : '',
                panning ? 'is-panning' : '',
              ].filter(Boolean).join(' ')}
              onMouseDown={handleStageMouseDown}
            >
              <img
                src={imageSrc}
                alt="标注图片"
                className="prd-annotation-modal__image"
                onLoad={(e) => {
                  setImageInfo({
                    naturalWidth: e.currentTarget.naturalWidth,
                    naturalHeight: e.currentTarget.naturalHeight,
                    mimeType: 'image/png',
                  });
                }}
              />
              {draftRegions.map((region) => {
                const left = `${(region.bbox.x / imageInfo.naturalWidth) * 100}%`;
                const top = `${(region.bbox.y / imageInfo.naturalHeight) * 100}%`;
                const width = `${(region.bbox.w / imageInfo.naturalWidth) * 100}%`;
                const height = `${(region.bbox.h / imageInfo.naturalHeight) * 100}%`;
                return (
                  <div
                    key={region.regionId}
                    data-region-box
                    className={[
                      'prd-annotation-modal__region',
                      region.regionId === selectedRegionId ? 'is-selected' : '',
                    ].filter(Boolean).join(' ')}
                    style={{ left, top, width, height }}
                    onMouseDown={(event) => {
                      if (spacePressed) {
                        event.stopPropagation();
                        beginPan(event);
                        return;
                      }
                      event.stopPropagation();
                      const stageRect = stageRef.current?.getBoundingClientRect();
                      if (!stageRect) return;
                      const point = toNaturalPoint(event, stageRect, imageInfo.naturalWidth, imageInfo.naturalHeight);
                      setSelectedRegionId(region.regionId);
                      dragStateRef.current = {
                        mode: 'move',
                        regionId: region.regionId,
                        anchor: point,
                        originRect: region.bbox,
                      };
                    }}
                  >
                    <span className="prd-annotation-modal__region-label">{region.label || region.title}</span>
                    {HANDLE_NAMES.map((handle) => (
                      <span
                        key={handle}
                        className={`prd-annotation-modal__handle prd-annotation-modal__handle--${handle}`}
                        onMouseDown={(event) => {
                          if (spacePressed) {
                            event.stopPropagation();
                            beginPan(event);
                            return;
                          }
                          event.stopPropagation();
                          const stageRect = stageRef.current?.getBoundingClientRect();
                          if (!stageRect) return;
                          const point = toNaturalPoint(event, stageRect, imageInfo.naturalWidth, imageInfo.naturalHeight);
                          setSelectedRegionId(region.regionId);
                          dragStateRef.current = {
                            mode: 'resize',
                            regionId: region.regionId,
                            anchor: point,
                            handle,
                            originRect: region.bbox,
                          };
                        }}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          <aside className="prd-annotation-modal__sidebar">
            <UsageForm
              usage={draftUsage}
              onChange={(patch) => setDraftUsage((prev) => ({ ...prev, ...patch }))}
            />
            <div className="prd-annotation-modal__region-strip">
              <div className="prd-annotation-modal__region-strip-head">
                <strong className="prd-annotation-modal__region-strip-title">区域 / 功能点</strong>
                <span className="prd-annotation-modal__region-count">{draftRegions.length} 个区域</span>
              </div>
              <div
                className={[
                  'prd-annotation-modal__region-tabs',
                  draftRegions.length ? 'prd-annotation-modal__region-tabs--has-items' : '',
                ].filter(Boolean).join(' ')}
              >
                {draftRegions.map((region) => (
                  <div
                    key={region.regionId}
                    className={[
                      'prd-annotation-modal__region-tab',
                      region.regionId === selectedRegionId ? 'is-active' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <button
                      type="button"
                      className="prd-annotation-modal__region-tab-main"
                      onClick={() => setSelectedRegionId(region.regionId)}
                    >
                      <span className="prd-annotation-modal__region-tab-label">{region.label}</span>
                    </button>
                    <button
                      type="button"
                      className="prd-annotation-modal__region-tab-delete"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleRegionDelete(region.regionId);
                      }}
                      aria-label={`删除区域 ${region.label}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <RegionForm
              className={selectedRegion ? '' : 'prd-annotation-modal__form--empty'}
              region={selectedRegion}
              onChange={handleRegionPatch}
              onDelete={() => handleRegionDelete(selectedRegionId)}
            />
          </aside>
        </div>
      </div>
    </div>,
    document.body,
  );
}
