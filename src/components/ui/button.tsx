import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0' +
    ' active:translate-y-px disabled:translate-y-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground border border-primary-border hover:brightness-95',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm border-destructive-border hover:brightness-95',
        outline:
          'border border-border bg-card text-foreground shadow-xs hover:bg-muted',
        secondary:
          'border bg-secondary text-secondary-foreground border-secondary-border hover:bg-secondary/70',
        ghost: 'border border-transparent hover:bg-muted',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        // @replit changed sizes
        default: 'min-h-9 px-4 py-2',
        sm: 'min-h-8 rounded-md px-3 text-xs',
        lg: 'min-h-10 rounded-md px-8',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
