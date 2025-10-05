Title: Convert to React 19 Ref Pattern
Description: Updates component to use React 19 ref pattern by removing withRef/forwardRef HOCs and using React.ComponentProps as inline type
Body:

### Instructions

1. Replace React.HTMLAttributes with React.ComponentProps<'div'> for div elements, or `React.ComponentProps<typeof BaseComponent>` for other elements
2. Replace withRef/forwardRef HOC with function component
3. Replace arrow function with function component only if possible. Remove displayName if any
4. Keep existing prop destructuring pattern
5. Remove ref parameter since it's part of props

### Example

Before:

```tsx
export const Component = withRef<typeof BaseComponent>(
  ({ children, className, ...props }, ref) => {
    return (
      <BaseComponent ref={ref} className={cn(className)} {...props}>
        {children}
      </BaseComponent>
    );
  }
);
```

After:

```tsx
export function Component({
  children,
  className,
  ...props
}: React.ComponentProps<typeof BaseComponent>) {
  return (
    <BaseComponent className={cn('some class', className)} {...props}>
      {children}
    </BaseComponent>
  );
}
```
