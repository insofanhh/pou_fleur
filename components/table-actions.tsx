"use client";
import type { ComponentPropsWithoutRef } from "react";
import type { LucideIcon } from "lucide-react";

export function TableActions({
  className = "",
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return <div {...props} className={"table-actions " + className} />;
}

// One icon-and-label treatment for record actions, including native form submits.
export function TableAction({
  icon: Icon,
  children,
  className = "",
  type = "button",
  title,
  ...props
}: ComponentPropsWithoutRef<"button"> & { icon: LucideIcon }) {
  return (
    <button
      {...props}
      type={type}
      title={title || (typeof children === "string" ? children : undefined)}
      className={"text-button table-action " + className}
    >
      <Icon size={15} aria-hidden="true" focusable="false" />
      {children}
    </button>
  );
}
