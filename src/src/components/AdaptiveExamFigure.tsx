import React, { useEffect, useRef, useState } from 'react';

type AdaptiveExamFigureProps = {
  src: string;
  alt?: string;
  caption?: string;
  className?: string;
  imgClassName?: string;
  /** 容器内字号（px），用于换算行高，决定配图最大高度 */
  fontPx?: number;
  /** 最大高度占多少行文字；默认 6 行 */
  maxLines?: number;
  /** 宽高比 < 该值视为窄图（按宽度自适应居中） */
  narrowRatio?: number;
};

type NaturalSize = { w: number; h: number } | null;

/**
 * 按原图宽高比与容器宽度自适应：
 * - 宽图（w >= h）：按容器宽度缩放，高度随比例
 * - 窄图（w < h）：高度不超过 N 行文字，宽度按比例，居中显示
 * - 超高窄图：按高度上限截断，宽度等比缩小
 */
export function AdaptiveExamFigure({
  src,
  alt,
  caption,
  className = 'exam-paper-figure',
  imgClassName = 'exam-paper-figure-img',
  fontPx,
  maxLines = 6,
  narrowRatio = 1,
}: AdaptiveExamFigureProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [natural, setNatural] = useState<NaturalSize>(null);
  const [containerW, setContainerW] = useState(0);

  useEffect(() => {
    if (!src) return;
    const img = new window.Image();
    img.onload = () => setNatural({ w: img.width, h: img.height });
    img.onerror = () => setNatural(null);
    img.src = src;
  }, [src]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fontSize = fontPx ?? getDefaultFontPx(containerRef.current);
  const maxH = fontSize * maxLines;

  let style: React.CSSProperties = { maxWidth: '100%' };
  let isNarrow = false;

  if (natural && natural.w > 0 && natural.h > 0) {
    const ratio = natural.w / natural.h;
    isNarrow = ratio < narrowRatio;
    if (isNarrow) {
      const heightLimited = Math.min(natural.h, maxH);
      const widthByHeight = heightLimited * ratio;
      const finalWidth = Math.min(widthByHeight, containerW || widthByHeight);
      const finalHeight = finalWidth / ratio;
      style = {
        width: `${finalWidth}px`,
        height: `${finalHeight}px`,
        maxWidth: '100%',
      };
    } else {
      const widthLimited = Math.min(natural.w, containerW || natural.w);
      const heightByWidth = widthLimited / ratio;
      style = {
        width: `${widthLimited}px`,
        height: `${heightByWidth}px`,
        maxWidth: '100%',
      };
    }
  } else {
    style = { maxWidth: '100%', maxHeight: `${maxH}px` };
  }

  return (
    <figure ref={containerRef} className={className} style={{ textAlign: isNarrow ? 'center' : undefined }}>
      <img
        src={src}
        alt={alt || '插图'}
        className={imgClassName}
        loading="lazy"
        style={style}
      />
      {caption ? <figcaption className="exam-paper-figure-cap">{caption}</figcaption> : null}
    </figure>
  );
}

function getDefaultFontPx(el: HTMLElement | null): number {
  if (!el || typeof window === 'undefined') return 14;
  try {
    const fs = window.getComputedStyle(el).fontSize;
    const n = parseFloat(fs);
    return Number.isFinite(n) && n > 0 ? n : 14;
  } catch {
    return 14;
  }
}
