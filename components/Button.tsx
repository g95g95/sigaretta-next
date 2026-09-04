"use client";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost";
  loading?: boolean;
  block?: boolean;
}

export default function Button({
  variant = "primary",
  loading = false,
  block = false,
  disabled,
  className,
  children,
  ...rest
}: Props) {
  const classes = ["btn", `btn-${variant}`];
  if (block) classes.push("btn-block");
  if (className) classes.push(className);

  return (
    <button
      type="button"
      {...rest}
      className={classes.join(" ")}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
