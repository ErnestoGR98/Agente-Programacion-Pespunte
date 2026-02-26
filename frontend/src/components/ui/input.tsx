import * as React from "react"

import { cn } from "@/lib/utils"

const SKIP_UPPERCASE = new Set(["number", "file", "email", "password", "hidden"])

function Input({ className, type, onChange, "data-no-uppercase": noUppercase, ...props }: React.ComponentProps<"input"> & { "data-no-uppercase"?: boolean }) {
  const shouldUppercase = !noUppercase && !SKIP_UPPERCASE.has(type ?? "")

  const handleChange: React.ChangeEventHandler<HTMLInputElement> | undefined =
    shouldUppercase
      ? (e) => {
          e.target.value = e.target.value.toUpperCase()
          onChange?.(e)
        }
      : onChange

  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        shouldUppercase && "uppercase",
        className
      )}
      onChange={handleChange}
      {...props}
    />
  )
}

export { Input }
