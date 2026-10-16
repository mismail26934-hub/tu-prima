"use client";

import { useState, type ReactNode } from "react";
import { DsPageController } from "@/components/DsPageController";

export type DsCarouselCardWidth = 328 | 286 | 240;

export type DsCarouselCardItem = {
  id: string;
  content?: ReactNode;
  label?: string;
};

type Props = {
  items: DsCarouselCardItem[];
  cardWidth?: DsCarouselCardWidth;
  size?: "lg" | "sm";
  className?: string;
  controller?: boolean;
  emptyLabel?: string;
};

/** Design System TU Carousel Card (Figma 24:4892). */
export function DsCarouselCard({
  items,
  cardWidth = 328,
  size = "lg",
  className = "",
  controller = true,
  emptyLabel = "Content area",
}: Props) {
  const [index, setIndex] = useState(0);
  const count = items.length;
  const widthClass =
    cardWidth === 240
      ? "ds-carousel-card-item--240"
      : cardWidth === 286
        ? "ds-carousel-card-item--286"
        : "ds-carousel-card-item--328";

  function go(next: number) {
    if (count <= 0) return;
    setIndex(((next % count) + count) % count);
  }

  return (
    <div
      className={`ds-carousel-card${size === "sm" ? " ds-carousel-card--sm" : ""}${className ? ` ${className}` : ""}`}
    >
      <div className="ds-carousel-card-track">
        {items.map((item) => (
          <div
            key={item.id}
            className={`ds-carousel-card-item ${widthClass}`}
          >
            {item.content ?? item.label ?? emptyLabel}
          </div>
        ))}
        {count === 0 ? (
          <div className={`ds-carousel-card-item ${widthClass}`}>
            {emptyLabel}
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
