import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// A minimal shadcn/ui-style Button — hand-written to this project's own
// needs rather than scaffolded via shadcn's CLI (which needs network
// access to their component registry; PHASE A instructions §2 keep the
// dependency footprint to what's actually used). Real semantic
// `<button>`/`<a>` elements, a visible focus ring (globals.css), and
// disabled-state styling — the accessibility baseline instructions §24
// asks for.
const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-xl font-display text-sm font-semibold transition focus-visible:outline-none hover:-translate-y-px active:translate-y-0 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-gradient-to-b from-[#6e211b] to-brand text-white shadow-[0_8px_18px_-10px_rgba(92,26,22,.85)] hover:from-brand hover:to-brand-dark hover:shadow-[0_12px_24px_-10px_rgba(92,26,22,.9)]",
        secondary: "bg-white text-slate-900 border border-slate-200 shadow-sm hover:border-copper hover:text-copper hover:shadow-md",
        ghost: "text-slate-700 hover:bg-slate-100",
        destructive: "bg-red-600 text-white hover:bg-red-700",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = "button", ...props },
  ref,
) {
  return <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
