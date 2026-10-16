import type { ReactNode } from "react";

export type DsBadgeColor = "critical" | "neutral" | "info";
export type DsBadgeVariant = "dot" | "count" | "label" | "outline";

type Props = {
  color?: DsBadgeColor;
  variant?: DsBadgeVariant;
  /** Shown for count / label / outline. Count auto-caps at 99+. */
  children?: ReactNode;
  className?: string;
  title?: string;
};

function formatCount(value: ReactNode): ReactNode {
  if (typeof value === "number") {
    return value > 99 ? "99+" : String(value);
  }
  return value;
}

/** Design System TU Badge (Figma 17:4367). */
export function DsBadge({
  color = "critical",
  variant = "label",
  children,
  className = "",
  title,
}: Props) {
  const isDot = variant === "dot";
  const isOutline = variant === "outline";
  const isCount = variant === "count";
  const classes = [
    "ds-badge",
    `ds-badge--${color}`,
    isDot ? "ds-badge--dot" : "",
    isCount ? "ds-badge--count" : "",
    isOutline ? "ds-badge--outline" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} title={title} aria-hidden={isDot || undefined}>
      {isDot ? null : formatCount(children)}
    </span>
  );
}
