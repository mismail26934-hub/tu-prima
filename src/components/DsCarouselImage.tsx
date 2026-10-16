"use client";

import { useState } from "react";
import { DsPageController } from "@/components/DsPageController";

export type DsCarouselImageRatio = "4:1" | "8:3" | "8:6";

export type DsCarouselImageSlide = {
  id: string;
  src?: string;
  alt?: string;
  label?: string;
};

type Props = {
  slides: DsCarouselImageSlide[];
  ratio?: DsCarouselImageRatio;
  size?: "lg" | "sm";
  className?: string;
  emptyLabel?: string;
  controller?: boolean;
};

function ratioClass(ratio: DsCarouselImageRatio): string {
  if (ratio === "8:3") return "ds-carousel-image-slide--83";
  if (ratio === "8:6") return "ds-carousel-image-slide--86";
  return "ds-carousel-image-slide--41";
}

/** Design System TU Carousel Image (Figma 24:5617). */
export function DsCarouselImage({
  slides,
  ratio = "4:1",
  size = "lg",
  className = "",
  emptyLabel = "Banner Placeholder",
  controller = true,
}: Props) {
  const [index, setIndex] = useState(0);
  const count = slides.length;

  function go(next: number) {
    if (count <= 0) return;
    setIndex(((next % count) + count) % count);
  }

  return (
    <div
      className={`ds-carousel-image${size === "sm" ? " ds-carousel-image--sm" : ""}${className ? ` ${className}` : ""}`}
    >
      <div className="ds-carousel-image-track">
        {slides.map((slide, i) => (
          <div
            key={slide.id}
            className={`ds-carousel-image-slide ${ratioClass(ratio)}${i === index ? " is-active" : ""}`}
            aria-hidden={i !== index}
          >
            {slide.src ? (
              <img src={slide.src} alt={slide.alt || slide.label || ""} />
            ) : (
              <div className="ds-carousel-image-placeholder">
                {slide.label || emptyLabel}
                <span aria-hidden="true"> · {ratio}</span>
              </div>
            )}
          </div>
        ))}
        {count === 0 ? (
          <div className={`ds-carousel-image-slide ${ratioClass(ratio)}`}>
            <div className="ds-carousel-image-placeholder">
              {emptyLabel} · {ratio}
            </div>
          </div>
        ) : null}
      </div>
      {controller && count > 0 ? (
        <DsPageController
          count={count}
          index={index}
          size={size}
          onPrev={() => go(index - 1)}
          onNext={() => go(index + 1)}
          onSelect={go}
        />
      ) : null}
    </div>
  );
}
