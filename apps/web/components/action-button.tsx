import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type ActionButtonVariant = 'primary' | 'secondary' | 'danger';
type ActionButtonSize = 'default' | 'compact';

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ActionButtonVariant;
  size?: ActionButtonSize;
  icon?: ReactNode;
}

const variantClass: Record<ActionButtonVariant, string> = {
  primary:
    'border-navy bg-navy text-white hover:border-blue hover:bg-blue hover:text-navy dark:hover:bg-blue-soft dark:hover:text-white',
  secondary: 'border-navy bg-white hover:border-blue hover:bg-blue-soft',
  danger: 'border-navy bg-white text-danger hover:border-danger hover:bg-danger hover:text-white',
};

const sizeClass: Record<ActionButtonSize, string> = {
  default: 'min-h-9 px-3 font-bold',
  compact: 'min-h-8 px-2 text-[10px] hover:translate-x-0.5',
};

export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(function ActionButton(
  { variant = 'secondary', size = 'default', icon, className = '', children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border transition-[color,background-color,border-color,transform] duration-150 disabled:cursor-not-allowed disabled:opacity-55 ${variantClass[variant]} ${sizeClass[size]} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
});
