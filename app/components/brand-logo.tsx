"use client";

import Image from "next/image";
import { type ReactNode } from "react";

interface BrandLogoProps {
  className?: string;
  /** Use on first paint (e.g. navbar) to avoid layout shift. */
  priority?: boolean;
}

/** Brand mark from `public/logo.png` — nav, footer, etc. */
export function BrandLogo({ className = "h-7 w-7", priority }: BrandLogoProps): ReactNode {
  return (
    <Image
      src="/logo.png"
      alt=""
      width={28}
      height={28}
      className={`object-contain ${className}`.trim()}
      priority={priority}
      sizes="28px"
    />
  );
}
