import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "danger" | "ghost";
}

const VARIANT_CLASSES: Record<NonNullable<ButtonProps["variant"]>, string> = {
  default: "border border-ps-border-strong bg-ps-elevated text-ps-text hover:border-ps-accent",
  primary: "border border-ps-accent bg-ps-accent text-ps-accent-contrast hover:opacity-90",
  danger: "border border-transparent bg-transparent text-ps-danger hover:underline",
  ghost: "border border-transparent bg-transparent text-ps-muted hover:text-ps-text",
};

export function Button({ variant = "default", className, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`rounded-ps px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT_CLASSES[variant]} ${className ?? ""}`}
      {...rest}
    />
  );
}
